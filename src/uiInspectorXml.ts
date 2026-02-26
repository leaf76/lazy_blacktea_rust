export type UiInspectorXmlView = {
  raw: string;
  pretty: string;
  prettyAvailable: boolean;
};

const INDENT = "  ";

const normalizeLineEndings = (value: string) => value.replace(/\r\n/g, "\n");

const extractTagName = (token: string): string => {
  const match = token.match(/^<\/?([^\s/>]+)/);
  if (!match) {
    throw new Error("Invalid XML tag.");
  }
  return match[1];
};

const formatUiXmlPretty = (xml: string): string => {
  const normalized = normalizeLineEndings(xml).trim();
  if (!normalized) {
    return "";
  }

  const tokens = normalized.match(/<[^>]+>|[^<]+/g) ?? [];
  const lines: string[] = [];
  const stack: string[] = [];
  let depth = 0;

  for (const rawToken of tokens) {
    const token = rawToken.trim();
    if (!token) {
      continue;
    }

    if (token.startsWith("<?") || token.startsWith("<!")) {
      lines.push(`${INDENT.repeat(depth)}${token}`);
      continue;
    }

    if (token.startsWith("</")) {
      const tag = extractTagName(token);
      const lastTag = stack.pop();
      if (!lastTag || lastTag !== tag) {
        throw new Error("XML close tag does not match open tag.");
      }
      depth = Math.max(depth - 1, 0);
      lines.push(`${INDENT.repeat(depth)}${token}`);
      continue;
    }

    if (token.startsWith("<")) {
      const selfClosing = token.endsWith("/>");
      const opensTag = /^<([^\s/>]+)(\s[^>]*)?>$/.test(token) || selfClosing;
      if (!opensTag) {
        throw new Error("Invalid XML element.");
      }
      lines.push(`${INDENT.repeat(depth)}${token}`);
      if (!selfClosing) {
        stack.push(extractTagName(token));
        depth += 1;
      }
      continue;
    }

    lines.push(`${INDENT.repeat(depth)}${token}`);
  }

  if (stack.length > 0) {
    throw new Error("XML contains unclosed tags.");
  }

  return lines.join("\n");
};

export const buildUiInspectorXmlView = (xml: string): UiInspectorXmlView => {
  const raw = normalizeLineEndings(xml ?? "");
  if (!raw.trim()) {
    return { raw, pretty: raw, prettyAvailable: true };
  }

  try {
    return {
      raw,
      pretty: formatUiXmlPretty(raw),
      prettyAvailable: true,
    };
  } catch {
    return {
      raw,
      pretty: raw,
      prettyAvailable: false,
    };
  }
};

export const filterUiInspectorXmlLines = (xml: string, query: string): string => {
  const normalizedXml = normalizeLineEndings(xml ?? "");
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return normalizedXml;
  }
  return normalizedXml
    .split("\n")
    .filter((line) => line.toLowerCase().includes(normalizedQuery))
    .join("\n");
};
