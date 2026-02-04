use base64::engine::general_purpose::STANDARD;
use base64::Engine;

const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

pub fn png_bytes_to_data_url(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() < PNG_SIGNATURE.len() {
        return Err("Screenshot data is empty".to_string());
    }
    if !bytes.starts_with(PNG_SIGNATURE) {
        return Err("Screenshot data is not a PNG".to_string());
    }

    let encoded = STANDARD.encode(bytes);
    Ok(format!("data:image/png;base64,{encoded}"))
}

#[cfg(test)]
mod tests {
    use super::png_bytes_to_data_url;

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
        let bytes = b"\x89PNG\r\n\x1a\nfake";
        let url = png_bytes_to_data_url(bytes).expect("should encode png");
        assert!(url.starts_with("data:image/png;base64,"));
    }
}
