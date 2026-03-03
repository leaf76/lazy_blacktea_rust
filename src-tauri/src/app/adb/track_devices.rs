use crate::app::adb::parse::parse_adb_devices;
use crate::app::models::DeviceSummary;

const DEVICES_HEADER: &str = "List of devices attached";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum TrackDevicesStreamMode {
    #[default]
    Unknown,
    Header,
    Framed,
}

#[derive(Debug, Default)]
pub struct TrackDevicesStreamParser {
    mode: TrackDevicesStreamMode,
    pending_bytes: Vec<u8>,
    pending_line: String,
    // Buffer for the current header-based snapshot (including the header line).
    header_buffer: String,
    saw_header: bool,
    // Prevent emitting the exact same snapshot repeatedly.
    last_emitted_hash: Option<u64>,
}

impl TrackDevicesStreamParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push_chunk(&mut self, chunk: &[u8]) -> Vec<Vec<DeviceSummary>> {
        if chunk.is_empty() {
            return Vec::new();
        }

        self.pending_bytes.extend_from_slice(chunk);
        if self.mode == TrackDevicesStreamMode::Unknown {
            self.detect_mode();
        }

        match self.mode {
            TrackDevicesStreamMode::Unknown => Vec::new(),
            TrackDevicesStreamMode::Framed => self.consume_framed_snapshots(),
            TrackDevicesStreamMode::Header => self.consume_header_snapshots(),
        }
    }

    // Compatibility helper for line-based tests/callers.
    pub fn push_line(&mut self, line: &str) -> Option<Vec<DeviceSummary>> {
        let mut line_with_newline = String::with_capacity(line.len() + 1);
        line_with_newline.push_str(line);
        line_with_newline.push('\n');
        self.push_chunk(line_with_newline.as_bytes())
            .into_iter()
            .next()
    }

    pub fn flush(&mut self) -> Vec<Vec<DeviceSummary>> {
        if self.mode == TrackDevicesStreamMode::Unknown {
            self.detect_mode();
            if self.mode == TrackDevicesStreamMode::Unknown && !self.pending_bytes.is_empty() {
                self.mode = TrackDevicesStreamMode::Header;
            }
        }

        let mut emitted = match self.mode {
            TrackDevicesStreamMode::Unknown => Vec::new(),
            TrackDevicesStreamMode::Framed => self.consume_framed_snapshots(),
            TrackDevicesStreamMode::Header => self.consume_header_snapshots(),
        };

        match self.mode {
            TrackDevicesStreamMode::Framed => {
                // Incomplete framed payloads are ignored when stream ends.
                self.pending_bytes.clear();
            }
            TrackDevicesStreamMode::Header => {
                if !self.pending_line.is_empty() {
                    let remaining = std::mem::take(&mut self.pending_line);
                    if let Some(snapshot) = self.push_header_line(remaining.trim_end_matches('\r'))
                    {
                        emitted.push(snapshot);
                    }
                }
                if let Some(snapshot) = self.flush_header_buffer() {
                    emitted.push(snapshot);
                }
            }
            TrackDevicesStreamMode::Unknown => {}
        }

        emitted
    }

    fn detect_mode(&mut self) {
        while matches!(self.pending_bytes.first(), Some(b'\n' | b'\r')) {
            self.pending_bytes.drain(..1);
        }

        if self.pending_bytes.len() < 4 {
            return;
        }

        if parse_frame_len(&self.pending_bytes[..4]).is_some() {
            self.mode = TrackDevicesStreamMode::Framed;
        } else {
            self.mode = TrackDevicesStreamMode::Header;
        }
    }

    fn consume_framed_snapshots(&mut self) -> Vec<Vec<DeviceSummary>> {
        let mut emitted = Vec::new();

        loop {
            if self.pending_bytes.len() < 4 {
                break;
            }

            let Some(frame_len) = parse_frame_len(&self.pending_bytes[..4]) else {
                // If stream is not framed after all, fallback to header parser.
                self.mode = TrackDevicesStreamMode::Header;
                emitted.extend(self.consume_header_snapshots());
                break;
            };

            if self.pending_bytes.len() < 4 + frame_len {
                break;
            }

            let payload = self.pending_bytes[4..(4 + frame_len)].to_vec();
            self.pending_bytes.drain(..(4 + frame_len));

            if let Some(snapshot) = self.emit_snapshot(
                String::from_utf8_lossy(&payload).trim_end_matches(['\r', '\n']),
                true,
            ) {
                emitted.push(snapshot);
            }
        }

        emitted
    }

    fn consume_header_snapshots(&mut self) -> Vec<Vec<DeviceSummary>> {
        if !self.pending_bytes.is_empty() {
            self.pending_line
                .push_str(String::from_utf8_lossy(&self.pending_bytes).as_ref());
            self.pending_bytes.clear();
        }

        let mut emitted = Vec::new();
        while let Some(index) = self.pending_line.find('\n') {
            let mut line = self.pending_line[..index].to_string();
            if line.ends_with('\r') {
                line.pop();
            }
            self.pending_line.drain(..=index);
            if let Some(snapshot) = self.push_header_line(&line) {
                emitted.push(snapshot);
            }
        }

        emitted
    }

    fn push_header_line(&mut self, line: &str) -> Option<Vec<DeviceSummary>> {
        let trimmed = line.trim_end_matches(['\r', '\n']);

        if trimmed.contains(DEVICES_HEADER) {
            let flushed = self.flush_header_buffer();
            self.header_buffer.clear();
            self.saw_header = true;
            self.header_buffer.push_str(DEVICES_HEADER);
            self.header_buffer.push('\n');
            return flushed;
        }

        if !self.saw_header {
            // Ignore preamble until we see the first header.
            return None;
        }

        if trimmed.is_empty() {
            // adb track-devices commonly separates snapshots with a blank line.
            return self.flush_header_buffer();
        }

        self.header_buffer.push_str(trimmed);
        self.header_buffer.push('\n');
        None
    }

    fn flush_header_buffer(&mut self) -> Option<Vec<DeviceSummary>> {
        if !self.saw_header {
            return None;
        }

        let snapshot = self.header_buffer.trim().to_string();
        self.emit_snapshot(&snapshot, false)
    }

    fn emit_snapshot(
        &mut self,
        snapshot: &str,
        allow_empty_payload: bool,
    ) -> Option<Vec<DeviceSummary>> {
        if snapshot.is_empty() && !allow_empty_payload {
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

fn parse_frame_len(prefix: &[u8]) -> Option<usize> {
    if prefix.len() != 4 || !prefix.iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    let len_hex = std::str::from_utf8(prefix).ok()?;
    usize::from_str_radix(len_hex, 16).ok()
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

    fn framed(payload: &str) -> Vec<u8> {
        format!("{:04x}{payload}", payload.len()).into_bytes()
    }

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

    #[test]
    fn emits_length_prefixed_single_snapshot() {
        let mut parser = TrackDevicesStreamParser::new();
        let payload = "0123456789ABCDEF\tdevice\n";
        let snapshots = parser.push_chunk(&framed(payload));
        assert_eq!(snapshots.len(), 1);
        let snapshot = &snapshots[0];
        assert_eq!(snapshot.len(), 1);
        assert_eq!(snapshot[0].serial, "0123456789ABCDEF");
        assert_eq!(snapshot[0].state, "device");
    }

    #[test]
    fn emits_length_prefixed_multi_line_snapshot() {
        let mut parser = TrackDevicesStreamParser::new();
        let payload = "A\tdevice\nB\toffline\n";
        let frame = framed(payload);
        let split_at = 7usize.min(frame.len());
        assert!(parser.push_chunk(&frame[..split_at]).is_empty());
        let snapshots = parser.push_chunk(&frame[split_at..]);
        assert_eq!(snapshots.len(), 1);
        let snapshot = &snapshots[0];
        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot[0].serial, "A");
        assert_eq!(snapshot[0].state, "device");
        assert_eq!(snapshot[1].serial, "B");
        assert_eq!(snapshot[1].state, "offline");
    }

    #[test]
    fn emits_length_prefixed_empty_snapshot() {
        let mut parser = TrackDevicesStreamParser::new();
        let snapshots = parser.push_chunk(b"0000");
        assert_eq!(snapshots.len(), 1);
        let snapshot = &snapshots[0];
        assert!(snapshot.is_empty());
    }

    #[test]
    fn does_not_emit_duplicate_length_prefixed_snapshots() {
        let mut parser = TrackDevicesStreamParser::new();
        let payload = "A\tdevice\n";
        let frame = framed(payload);
        let first = parser.push_chunk(&frame);
        assert_eq!(first.len(), 1);
        let first = &first[0];
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].serial, "A");
        assert_eq!(first[0].state, "device");
        assert!(parser.push_chunk(&frame).is_empty());
    }

    #[test]
    fn ignores_incomplete_framed_payload_on_flush() {
        let mut parser = TrackDevicesStreamParser::new();
        assert!(parser.push_chunk(b"0012A\tdev").is_empty());
        assert!(parser.flush().is_empty());
    }
}
