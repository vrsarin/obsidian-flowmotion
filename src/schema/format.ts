import { parseDocument } from 'yaml';

/**
 * Canonical layout for a FlowMotion definition: 2-space indent, no line folding, `{ a: 1 }` padding.
 * Comments, blank lines between entries, quoting and flow-style items are kept.
 * JSON input stays JSON (2-space indent). Returns undefined when the text has syntax errors
 * (nothing is rewritten in that case) or is already formatted.
 */
export function formatSource(source: string): string | undefined {
  const text = source.trim();
  if (!text) return undefined;
  let out: string;
  if (/^[{[]/.test(text)) {
    try { out = `${JSON.stringify(JSON.parse(text), null, 2)}\n`; }
    catch { out = formatYaml(source) ?? ''; } // YAML flow style at the root, or broken JSON
  } else out = formatYaml(source) ?? '';
  return out && out !== source ? out : undefined;
}

function formatYaml(source: string): string | undefined {
  const doc = parseDocument(source, { strict: false, prettyErrors: false });
  if (doc.errors.length) return undefined;
  const out = doc.toString({ indent: 2, lineWidth: 0, flowCollectionPadding: true, minContentWidth: 0 });
  // Project style: `{ id: a }` is padded, `[a, b]` is not. Lines holding quotes are left to the YAML writer.
  const tidy = out.split('\n').map((l) => (/["']/.test(l) ? l : l.replace(/\[ +/g, '[').replace(/ +\]/g, ']'))).join('\n');
  return tidy.endsWith('\n') ? tidy : `${tidy}\n`;
}
