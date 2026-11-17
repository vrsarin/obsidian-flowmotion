/** Locating ```flowmotion fences in a note. Pure text helpers, shared by the in-note language support. */
export interface Block {
  /** Offset of the first body character. */
  from: number;
  /** Offset just after the body (the start of the closing fence, or the end of the text when unclosed). */
  to: number;
  text: string;
}

const OPEN = /^[ \t]*(`{3,}|~{3,})[ \t]*flowmotion\b/i;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const CLOSE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

/** Every flowmotion code block in `doc`. */
export function findBlocks(doc: string): Block[] {
  const out: Block[] = [];
  const lines = doc.split('\n');
  let off = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = OPEN.exec(lines[i]!);
    if (!m) { off += lines[i]!.length + 1; continue; }
    const from = off + lines[i]!.length + 1;
    let end = from, j = i + 1, closed = false;
    for (; j < lines.length; j++) {
      const c = CLOSE.exec(lines[j]!);
      if (c && c[1]![0] === m[1]![0] && c[1]!.length >= m[1]!.length) { closed = true; break; }
      end += lines[j]!.length + 1;
    }
    const to = closed ? end : Math.min(end, doc.length);
    out.push({ from: Math.min(from, doc.length), to, text: doc.slice(Math.min(from, doc.length), to) });
    off = closed ? end + lines[j]!.length + 1 : doc.length;
    i = closed ? j : lines.length;
  }
  return out;
}

export interface Around { text: string; /** Cursor offset inside `text`. */ offset: number; startLine: number; endLine: number }

/** If (line, ch) sits inside a flowmotion block body, the body text and the cursor's offset in it. Cheap: scans only nearby lines. */
export function bodyAround(lineAt: (i: number) => string, count: number, line: number, ch: number): Around | undefined {
  if (FENCE.test(lineAt(line))) return undefined;
  let start = -1;
  for (let i = line - 1; i >= 0; i--) {
    const l = lineAt(i);
    if (!FENCE.test(l)) continue;
    if (OPEN.test(l)) start = i + 1;
    break;
  }
  if (start < 0) return undefined;
  let end = count, closed = false;
  for (let i = start; i < count; i++) if (i > line - 1 && CLOSE.test(lineAt(i))) { end = i; closed = true; break; }
  const body: string[] = [];
  let offset = 0;
  for (let i = start; i < end; i++) {
    const l = lineAt(i);
    if (i < line) offset += l.length + 1; else if (i === line) offset += Math.min(ch, l.length);
    body.push(l);
  }
  return { text: body.join('\n') + (closed ? '\n' : ''), offset, startLine: start, endLine: end };
}
