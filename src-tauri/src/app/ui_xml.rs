const CSS_SNIPPET: &str = "\
<style>\n\
body{\n\
  font-family: Arial, sans-serif;\n\
  line-height: 1.6;\n\
  color: #1f2a37;\n\
  background-color: #f7f7fb;\n\
  padding: 20px;\n\
}\n\
ul {\n\
  list-style-type: none;\n\
  padding-left:0;\n\
}\n\
ul li {\n\
  margin: 5px 0;\n\
  position: relative;\n\
  padding: 6px 8px 6px 14px;\n\
  border: 1px solid #d3d7e0;\n\
  background-color:#ffffff;\n\
  border-radius: 8px;\n\
}\n\
ul li ul {\n\
  margin-left: 20px;\n\
  padding-left: 20px;\n\
  border-left:1px dashed #8892a6;\n\
}\n\
ul li:before{\n\
  content: '\\2192';\n\
  position: absolute;\n\
  left:-10px;\n\
  color: #8892a6;\n\
}\n\
.attributes {\n\
  color: #1d4ed8;\n\
  font-style: italic;\n\
}\n\
.text {\n\
  color: #166534;\n\
}\n\
</style>\n";

#[derive(Default)]
struct FrameState {
    has_children: bool,
}

fn escape_html(input: &str) -> String {
    let mut escaped = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

pub fn render_device_ui_html(xml: &str) -> Result<String, String> {
    let mut output = String::with_capacity(xml.len().saturating_mul(2));
    output.push_str(CSS_SNIPPET);
    output.push_str("<ul>");

    let bytes = xml.as_bytes();
    let mut index: usize = 0;
    let mut stack: Vec<FrameState> = Vec::new();

    while index < bytes.len() {
        match bytes[index] {
            b'<' => {
                if index + 1 >= bytes.len() {
                    break;
                }
                match bytes[index + 1] {
                    b'/' => {
                        index += 2;
                        while index < bytes.len() && bytes[index] != b'>' {
                            index += 1;
                        }
                        if index < bytes.len() {
                            index += 1;
                        }
                        if let Some(frame) = stack.pop() {
                            if frame.has_children {
                                output.push_str("</ul>");
                            }
                            output.push_str("</li>");
                        }
                    }
                    b'!' => {
                        index += 2;
                        while index + 2 < bytes.len()
                            && !(bytes[index] == b'-'
                                && bytes[index + 1] == b'-'
                                && bytes[index + 2] == b'>')
                        {
                            index += 1;
                        }
                        index = (index + 3).min(bytes.len());
                    }
                    b'?' => {
                        index += 2;
                        while index + 1 < bytes.len()
                            && !(bytes[index] == b'?' && bytes[index + 1] == b'>')
                        {
                            index += 1;
                        }
                        index = (index + 2).min(bytes.len());
                    }
                    _ => {
                        let start = index + 1;
                        let mut cursor = start;
                        while cursor < bytes.len() {
                            let ch = bytes[cursor];
                            if ch == b'/' || ch == b'>' || ch.is_ascii_whitespace() {
                                break;
                            }
                            cursor += 1;
                        }
                        if cursor > bytes.len() {
                            return Err("Malformed XML tag".into());
                        }
                        let tag_name = &xml[start..cursor];
                        let mut attrs: Vec<(String, String)> = Vec::new();
                        let mut self_closing = false;
                        let mut attr_cursor = cursor;
                        while attr_cursor < bytes.len() {
                            while attr_cursor < bytes.len() && bytes[attr_cursor].is_ascii_whitespace() {
                                attr_cursor += 1;
                            }
                            if attr_cursor >= bytes.len() {
                                break;
                            }
                            let ch = bytes[attr_cursor];
                            if ch == b'>' {
                                attr_cursor += 1;
                                break;
                            }
                            if ch == b'/' {
                                self_closing = true;
                                attr_cursor += 1;
                                if attr_cursor < bytes.len() && bytes[attr_cursor] == b'>' {
                                    attr_cursor += 1;
                                }
                                break;
                            }

                            let name_start = attr_cursor;
                            while attr_cursor < bytes.len()
                                && bytes[attr_cursor] != b'='
                                && !bytes[attr_cursor].is_ascii_whitespace()
                            {
                                attr_cursor += 1;
                            }
                            if attr_cursor >= bytes.len() {
                                return Err("Malformed attribute".into());
                            }
                            let name_end = attr_cursor;
                            while attr_cursor < bytes.len() && bytes[attr_cursor].is_ascii_whitespace() {
                                attr_cursor += 1;
                            }
                            if attr_cursor >= bytes.len() || bytes[attr_cursor] != b'=' {
                                return Err("Malformed attribute assignment".into());
                            }
                            attr_cursor += 1;
                            while attr_cursor < bytes.len() && bytes[attr_cursor].is_ascii_whitespace() {
                                attr_cursor += 1;
                            }
                            if attr_cursor >= bytes.len() {
                                return Err("Missing attribute value".into());
                            }
                            let quote = bytes[attr_cursor];
                            if quote != b'"' && quote != b'\'' {
                                return Err("Attribute value must be quoted".into());
                            }
                            attr_cursor += 1;
                            let value_start = attr_cursor;
                            while attr_cursor < bytes.len() && bytes[attr_cursor] != quote {
                                attr_cursor += 1;
                            }
                            if attr_cursor >= bytes.len() {
                                return Err("Unterminated attribute value".into());
                            }
                            let value_end = attr_cursor;
                            attr_cursor += 1;
                            let name = &xml[name_start..name_end];
                            let value = &xml[value_start..value_end];
                            attrs.push((name.to_string(), value.to_string()));
                        }
                        index = attr_cursor;

                        if let Some(parent) = stack.last_mut() {
                            if !parent.has_children {
                                parent.has_children = true;
                                output.push_str("<ul>");
                            }
                        }
                        output.push_str("<li>");
                        output.push_str("<strong>");
                        output.push_str(&escape_html(tag_name));
                        output.push_str("</strong>");

                        if !attrs.is_empty() {
                            output.push_str(" <span class=\"attributes\">[");
                            for (index, (name, value)) in attrs.iter().enumerate() {
                                if index > 0 {
                                    output.push_str(", ");
                                }
                                output.push_str(&escape_html(name));
                                output.push_str("=\"");
                                output.push_str(&escape_html(value));
                                output.push('"');
                            }
                            output.push_str("]</span>");
                        }

                        if self_closing {
                            output.push_str("</li>");
                        } else {
                            stack.push(FrameState::default());
                        }
                    }
                }
            }
            _ => {
                index += 1;
            }
        }
    }

    while let Some(frame) = stack.pop() {
        if frame.has_children {
            output.push_str("</ul>");
        }
        output.push_str("</li>");
    }

    output.push_str("</ul>");
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_basic_xml() {
        let xml = "<root><node text=\"Hello\" /></root>";
        let html = render_device_ui_html(xml).expect("render");
        assert!(html.contains("root"));
        assert!(html.contains("node"));
        assert!(html.contains("text"));
        assert!(html.contains("Hello"));
    }
}
