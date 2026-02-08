use std::fmt::Write;

const HTML_PREFIX: &str = "\
<!doctype html>\n\
<html>\n\
<head>\n\
<meta charset=\"utf-8\" />\n\
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n\
<style>\n\
:root{\n\
  --ui-bg: #f7f7fb;\n\
  --ui-panel: #ffffff;\n\
  --ui-border: #d3d7e0;\n\
  --ui-text: #0f172a;\n\
  --ui-muted: #475569;\n\
  --ui-accent: #1d4ed8;\n\
  --ui-ok: #166534;\n\
  --ui-selected-bg: rgba(239, 68, 68, 0.12);\n\
  --ui-selected-border: rgba(239, 68, 68, 0.55);\n\
}\n\
html, body { height: 100%; }\n\
body{\n\
  margin: 0;\n\
  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Helvetica, Arial, sans-serif;\n\
  font-size: 12px;\n\
  line-height: 1.35;\n\
  color: var(--ui-text);\n\
  background: var(--ui-bg);\n\
  padding: 10px;\n\
}\n\
ul {\n\
  list-style-type: none;\n\
  padding-left: 0;\n\
  margin: 0;\n\
}\n\
li {\n\
  margin: 3px 0;\n\
  position: relative;\n\
}\n\
li > .ui-row {\n\
  display: flex;\n\
  align-items: baseline;\n\
  gap: 8px;\n\
  padding: 4px 8px 4px 14px;\n\
  border: 1px solid var(--ui-border);\n\
  background: var(--ui-panel);\n\
  border-radius: 8px;\n\
}\n\
li > ul {\n\
  margin-left: 14px;\n\
  padding-left: 14px;\n\
  border-left: 1px dashed rgba(136, 146, 166, 0.85);\n\
}\n\
li:before{\n\
  content: '\\2192';\n\
  position: absolute;\n\
  left: 0;\n\
  top: 5px;\n\
  color: rgba(136, 146, 166, 0.95);\n\
  font-size: 11px;\n\
}\n\
.ui-tag {\n\
  font-weight: 700;\n\
}\n\
.ui-class {\n\
  font-weight: 600;\n\
}\n\
.ui-id {\n\
  color: var(--ui-accent);\n\
}\n\
.ui-text {\n\
  color: var(--ui-ok);\n\
}\n\
.ui-desc {\n\
  color: var(--ui-muted);\n\
}\n\
.ui-bounds {\n\
  color: var(--ui-muted);\n\
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace;\n\
  font-size: 11px;\n\
}\n\
.ui-attrs {\n\
  color: var(--ui-accent);\n\
  font-style: italic;\n\
}\n\
li.is-selected:before {\n\
  color: rgba(239, 68, 68, 0.95);\n\
}\n\
li.is-selected > .ui-row {\n\
  border-color: var(--ui-selected-border);\n\
  background: var(--ui-selected-bg);\n\
  box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.2) inset;\n\
}\n\
</style>\n\
</head>\n\
<body>\n";

const HTML_SUFFIX: &str = "\n</body>\n</html>\n";

#[derive(Default)]
struct FrameState {
    has_children: bool,
}

fn find_attr<'a>(attrs: &'a [(String, String)], name: &str) -> Option<&'a str> {
    attrs
        .iter()
        .find(|(attr_name, _)| attr_name == name)
        .map(|(_, value)| value.as_str())
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
    output.push_str(HTML_PREFIX);
    output.push_str("<ul>");

    let bytes = xml.as_bytes();
    let mut index: usize = 0;
    let mut stack: Vec<FrameState> = Vec::new();
    let mut node_index: usize = 0;

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
                            while attr_cursor < bytes.len()
                                && bytes[attr_cursor].is_ascii_whitespace()
                            {
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
                            while attr_cursor < bytes.len()
                                && bytes[attr_cursor].is_ascii_whitespace()
                            {
                                attr_cursor += 1;
                            }
                            if attr_cursor >= bytes.len() || bytes[attr_cursor] != b'=' {
                                return Err("Malformed attribute assignment".into());
                            }
                            attr_cursor += 1;
                            while attr_cursor < bytes.len()
                                && bytes[attr_cursor].is_ascii_whitespace()
                            {
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
                        let mapped_node_index =
                            if tag_name == "node" && find_attr(&attrs, "bounds").is_some() {
                                let current = node_index;
                                node_index += 1;
                                Some(current)
                            } else {
                                None
                            };

                        output.push_str("<li");
                        if let Some(ui_index) = mapped_node_index {
                            let _ = write!(
                                output,
                                " id=\"ui-node-{ui_index}\" data-ui-node-index=\"{ui_index}\""
                            );
                        }
                        output.push('>');
                        output.push_str("<div class=\"ui-row\">");
                        output.push_str("<span class=\"ui-tag\">");
                        output.push_str(&escape_html(tag_name));
                        output.push_str("</span>");

                        if tag_name == "node" {
                            if let Some(class_name) = find_attr(&attrs, "class") {
                                if !class_name.is_empty() {
                                    output.push_str(" <span class=\"ui-class\">");
                                    output.push_str(&escape_html(class_name));
                                    output.push_str("</span>");
                                }
                            }

                            if let Some(resource_id) = find_attr(&attrs, "resource-id") {
                                if !resource_id.is_empty() {
                                    output.push_str(" <span class=\"ui-id\">#");
                                    output.push_str(&escape_html(resource_id));
                                    output.push_str("</span>");
                                }
                            }

                            if let Some(text) = find_attr(&attrs, "text") {
                                if !text.is_empty() {
                                    output.push_str(" <span class=\"ui-text\">\"");
                                    output.push_str(&escape_html(text));
                                    output.push_str("\"</span>");
                                }
                            }

                            if let Some(content_desc) = find_attr(&attrs, "content-desc") {
                                if !content_desc.is_empty() {
                                    output.push_str(" <span class=\"ui-desc\">@");
                                    output.push_str(&escape_html(content_desc));
                                    output.push_str("</span>");
                                }
                            }

                            if let Some(bounds) = find_attr(&attrs, "bounds") {
                                if !bounds.is_empty() {
                                    output.push_str(" <span class=\"ui-bounds\">");
                                    output.push_str(&escape_html(bounds));
                                    output.push_str("</span>");
                                }
                            }
                        } else if !attrs.is_empty() {
                            output.push_str(" <span class=\"ui-attrs\">[");
                            for (attr_index, (name, value)) in attrs.iter().enumerate() {
                                if attr_index > 0 {
                                    output.push_str(", ");
                                }
                                output.push_str(&escape_html(name));
                                output.push_str("=\"");
                                output.push_str(&escape_html(value));
                                output.push('"');
                            }
                            output.push_str("]</span>");
                        }

                        output.push_str("</div>");

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
    output.push_str(HTML_SUFFIX);
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
