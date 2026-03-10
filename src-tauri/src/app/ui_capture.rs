use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use quick_xml::events::Event;
use std::io::Cursor;

const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

pub fn validate_png_bytes(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < PNG_SIGNATURE.len() {
        return Err("Screenshot data is empty".to_string());
    }
    if !bytes.starts_with(PNG_SIGNATURE) {
        return Err("Screenshot data is not a PNG".to_string());
    }

    let decoder = png::Decoder::new(Cursor::new(bytes));
    let mut reader = decoder
        .read_info()
        .map_err(|err| format!("Screenshot data is not a valid PNG: {err}"))?;
    let output_len = reader
        .output_buffer_size()
        .ok_or_else(|| "Screenshot data is not a valid PNG".to_string())?;
    let mut decoded = vec![0; output_len];
    reader
        .next_frame(&mut decoded)
        .map_err(|err| format!("Screenshot data is not a valid PNG: {err}"))?;
    Ok(())
}

pub fn png_bytes_to_data_url(bytes: &[u8]) -> Result<String, String> {
    validate_png_bytes(bytes)?;
    let encoded = STANDARD.encode(bytes);
    Ok(format!("data:image/png;base64,{encoded}"))
}

pub fn validate_ui_dump_xml(xml: &str) -> Result<(), String> {
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut depth = 0usize;
    let mut saw_root = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => {
                if depth == 0 {
                    if event.name().as_ref() != b"hierarchy" {
                        return Err("UI XML root element must be <hierarchy>".to_string());
                    }
                    saw_root = true;
                }
                depth += 1;
            }
            Ok(Event::Empty(event)) => {
                if depth == 0 {
                    if event.name().as_ref() != b"hierarchy" {
                        return Err("UI XML root element must be <hierarchy>".to_string());
                    }
                    return Err("UI XML root element cannot be empty".to_string());
                }
            }
            Ok(Event::End(_)) => {
                if depth == 0 {
                    return Err("UI XML has an unexpected closing tag".to_string());
                }
                depth -= 1;
            }
            Ok(Event::Decl(_))
            | Ok(Event::Text(_))
            | Ok(Event::Comment(_))
            | Ok(Event::CData(_))
            | Ok(Event::PI(_))
            | Ok(Event::DocType(_))
            | Ok(Event::GeneralRef(_)) => {}
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("UI XML is not valid: {err}")),
        }
        buf.clear();
    }

    if !saw_root {
        return Err("UI XML root element must be <hierarchy>".to_string());
    }
    if depth != 0 {
        return Err("UI XML is truncated".to_string());
    }

    Ok(())
}

pub fn normalize_ui_dump_xml(bytes: &[u8]) -> Result<String, String> {
    let raw = std::str::from_utf8(bytes).map_err(|err| format!("UI XML is not UTF-8: {err}"))?;
    let trimmed = raw.trim();
    let start = trimmed
        .find("<?xml")
        .or_else(|| trimmed.find("<hierarchy"))
        .ok_or_else(|| "UI XML payload not found".to_string())?;
    let xml_payload = &trimmed[start..];
    let xml_end = xml_payload
        .rfind("</hierarchy>")
        .map(|idx| idx + "</hierarchy>".len())
        .unwrap_or(xml_payload.len());
    let normalized = xml_payload[..xml_end].trim();
    validate_ui_dump_xml(normalized)?;
    Ok(normalized.to_string())
}

#[cfg(test)]
mod tests {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    use super::{
        normalize_ui_dump_xml, png_bytes_to_data_url, validate_png_bytes, validate_ui_dump_xml,
    };

    fn valid_png_bytes() -> Vec<u8> {
        STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==")
            .expect("valid png")
    }

    fn valid_ui_xml() -> &'static str {
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hierarchy rotation="0">
  <node index="0" text="" class="android.widget.FrameLayout" bounds="[0,0][1,1]" />
</hierarchy>"#
    }

    #[test]
    fn png_bytes_to_data_url_rejects_empty() {
        let err = png_bytes_to_data_url(&[]).expect_err("should reject empty input");
        assert!(err.contains("empty"));
    }

    #[test]
    fn png_bytes_to_data_url_rejects_non_png() {
        let err = png_bytes_to_data_url(b"not a png").expect_err("should reject non-png");
        assert!(err.contains("PNG"));
    }

    #[test]
    fn png_bytes_to_data_url_encodes_png_prefix() {
        let bytes = valid_png_bytes();
        let url = png_bytes_to_data_url(&bytes).expect("should encode png");
        assert!(url.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn png_bytes_to_data_url_rejects_truncated_png() {
        let mut bytes = valid_png_bytes();
        bytes.truncate(bytes.len() - 8);
        let err = png_bytes_to_data_url(&bytes).expect_err("should reject truncated png");
        assert!(err.contains("PNG"));
    }

    #[test]
    fn validate_png_bytes_accepts_valid_png() {
        validate_png_bytes(&valid_png_bytes()).expect("valid png");
    }

    #[test]
    fn validate_ui_dump_xml_accepts_complete_document() {
        validate_ui_dump_xml(valid_ui_xml()).expect("valid xml");
    }

    #[test]
    fn validate_ui_dump_xml_rejects_truncated_document() {
        let truncated = valid_ui_xml().trim_end_matches("</hierarchy>");
        let err = validate_ui_dump_xml(truncated).expect_err("should reject truncated xml");
        assert!(err.contains("truncated") || err.contains("valid"));
    }

    #[test]
    fn normalize_ui_dump_xml_extracts_payload_from_wrapped_output() {
        let wrapped = format!(
            "UI hierchary dumped to: /sdcard/window_dump.xml\n{}\nSuccess\n",
            valid_ui_xml()
        );
        let normalized = normalize_ui_dump_xml(wrapped.as_bytes()).expect("normalize xml");
        assert_eq!(normalized, valid_ui_xml());
    }

    #[test]
    fn normalize_ui_dump_xml_rejects_non_utf8_bytes() {
        let err = normalize_ui_dump_xml(b"\xff\xfe<bad>").expect_err("should reject non-utf8");
        assert!(err.contains("UTF-8"));
    }
}
