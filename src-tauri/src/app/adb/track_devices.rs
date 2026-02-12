use crate::app::adb::parse::parse_adb_devices;
use crate::app::models::DeviceSummary;

const DEVICES_HEADER: &str = "List of devices attached";

#[derive(Debug, Default)]
pub struct TrackDevicesStreamParser {
    // Buffer for the current snapshot (including the header line).
    buffer: String,
    saw_header: bool,
    // Prevent emitting the exact same snapshot repeatedly if adb prints empty lines.
    last_emitted_hash: Option<u64>,
}

impl TrackDevicesStreamParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push_line(&mut self, line: &str) -> Option<Vec<DeviceSummary>> {
        let trimmed = line.trim_end_matches(['\r', '\n']);

        if trimmed.contains(DEVICES_HEADER) {
            // A new snapshot is starting; flush the previous one (if any).
            let flushed = self.flush();
            self.buffer.clear();
            self.saw_header = true;
            self.buffer.push_str(DEVICES_HEADER);
            self.buffer.push('\n');
            return flushed;
        }

        if !self.saw_header {
            // Ignore preamble until we see the first header.
            return None;
        }

        if trimmed.is_empty() {
            // adb track-devices commonly separates snapshots with a blank line.
            return self.flush();
        }

        self.buffer.push_str(trimmed);
        self.buffer.push('\n');
        None
    }

    pub fn flush(&mut self) -> Option<Vec<DeviceSummary>> {
        if !self.saw_header {
            return None;
        }

        let snapshot = self.buffer.trim();
        if snapshot.is_empty() {
            return None;
        }

        let hash = fxhash::hash64(snapshot);
        if self.last_emitted_hash == Some(hash) {
            return None;
        }
        self.last_emitted_hash = Some(hash);

        Some(parse_adb_devices(snapshot))
    }
}

mod fxhash {
    pub fn hash64(input: &str) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        input.hash(&mut hasher);
        hasher.finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emits_on_blank_line_separator() {
        let mut parser = TrackDevicesStreamParser::new();
        assert_eq!(parser.push_line("noise before header"), None);
        assert_eq!(parser.push_line("List of devices attached"), None);
        assert_eq!(
            parser.push_line("0123456789ABCDEF device model:Pixel_7 transport_id:1"),
            None
        );
        let snapshot = parser.push_line("").expect("expected snapshot");
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].serial, "0123456789ABCDEF");
        assert_eq!(snapshot[0].state, "device");
        assert_eq!(snapshot[0].model.as_deref(), Some("Pixel_7"));
    }

    #[test]
    fn emits_when_new_header_arrives() {
        let mut parser = TrackDevicesStreamParser::new();
        assert_eq!(parser.push_line("List of devices attached"), None);
        assert_eq!(parser.push_line("A device"), None);
        let first = parser
            .push_line("List of devices attached")
            .expect("expected flush when new header arrives");
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].serial, "A");
        assert_eq!(first[0].state, "device");
    }

    #[test]
    fn does_not_emit_duplicate_snapshots() {
        let mut parser = TrackDevicesStreamParser::new();
        assert_eq!(parser.push_line("List of devices attached"), None);
        assert_eq!(parser.push_line("A device"), None);
        let first = parser.push_line("").expect("expected first snapshot");
        assert_eq!(first.len(), 1);
        assert_eq!(parser.push_line(""), None);
        assert_eq!(parser.push_line(""), None);
    }

    #[test]
    fn emits_empty_snapshot_when_no_devices() {
        let mut parser = TrackDevicesStreamParser::new();
        assert_eq!(parser.push_line("List of devices attached"), None);
        let snapshot = parser.push_line("").expect("expected snapshot");
        assert!(snapshot.is_empty());
    }
}
