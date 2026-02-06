use std::collections::HashMap;
use std::sync::{Arc, Condvar, Mutex};

pub struct GlobalSemaphore {
    limit: usize,
    used: Mutex<usize>,
    cv: Condvar,
}

impl GlobalSemaphore {
    pub fn new(limit: usize) -> Self {
        Self {
            limit: limit.max(1),
            used: Mutex::new(0),
            cv: Condvar::new(),
        }
    }

    pub fn acquire(self: &Arc<Self>) -> GlobalPermit {
        let mut used = self.used.lock().expect("semaphore lock poisoned");
        while *used >= self.limit {
            used = self.cv.wait(used).expect("semaphore lock poisoned");
        }
        *used += 1;
        GlobalPermit {
            semaphore: Arc::clone(self),
        }
    }

    fn release(&self) {
        let mut used = self.used.lock().expect("semaphore lock poisoned");
        *used = used.saturating_sub(1);
        self.cv.notify_one();
    }
}

pub struct GlobalPermit {
    semaphore: Arc<GlobalSemaphore>,
}

impl Drop for GlobalPermit {
    fn drop(&mut self) {
        self.semaphore.release();
    }
}

pub struct TaskScheduler {
    global: Arc<GlobalSemaphore>,
    device_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl TaskScheduler {
    pub fn new(global_limit: usize) -> Self {
        Self {
            global: Arc::new(GlobalSemaphore::new(global_limit)),
            device_locks: Mutex::new(HashMap::new()),
        }
    }

    pub fn acquire_global(&self) -> GlobalPermit {
        self.global.acquire()
    }

    pub fn device_lock(&self, serial: &str) -> Arc<Mutex<()>> {
        let mut guard = self.device_locks.lock().expect("device locks poisoned");
        guard
            .entry(serial.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread;
    use std::time::Duration;

    #[test]
    fn global_semaphore_limits_concurrency() {
        let scheduler = Arc::new(TaskScheduler::new(2));

        let running = Arc::new(AtomicUsize::new(0));
        let max_running = Arc::new(AtomicUsize::new(0));

        let mut handles = Vec::new();
        for _ in 0..8 {
            let scheduler = Arc::clone(&scheduler);
            let running = Arc::clone(&running);
            let max_running = Arc::clone(&max_running);
            handles.push(thread::spawn(move || {
                let _permit = scheduler.acquire_global();
                let current = running.fetch_add(1, Ordering::SeqCst) + 1;
                loop {
                    let prev = max_running.load(Ordering::SeqCst);
                    if current <= prev {
                        break;
                    }
                    if max_running
                        .compare_exchange(prev, current, Ordering::SeqCst, Ordering::SeqCst)
                        .is_ok()
                    {
                        break;
                    }
                }
                thread::sleep(Duration::from_millis(30));
                running.fetch_sub(1, Ordering::SeqCst);
            }));
        }

        for handle in handles {
            handle.join().expect("join");
        }

        assert!(max_running.load(Ordering::SeqCst) <= 2);
    }

    #[test]
    fn device_lock_serializes_same_device() {
        let scheduler = Arc::new(TaskScheduler::new(8));
        let serial = "device-1";

        let running = Arc::new(AtomicUsize::new(0));
        let max_running = Arc::new(AtomicUsize::new(0));

        let mut handles = Vec::new();
        for _ in 0..6 {
            let scheduler = Arc::clone(&scheduler);
            let running = Arc::clone(&running);
            let max_running = Arc::clone(&max_running);
            let serial = serial.to_string();
            handles.push(thread::spawn(move || {
                let _permit = scheduler.acquire_global();
                let lock = scheduler.device_lock(&serial);
                let _guard = lock.lock().expect("lock");
                let current = running.fetch_add(1, Ordering::SeqCst) + 1;
                max_running.fetch_max(current, Ordering::SeqCst);
                thread::sleep(Duration::from_millis(10));
                running.fetch_sub(1, Ordering::SeqCst);
            }));
        }

        for handle in handles {
            handle.join().expect("join");
        }

        assert_eq!(max_running.load(Ordering::SeqCst), 1);
    }
}

