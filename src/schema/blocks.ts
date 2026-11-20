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
  let i = 0;
  while (i < lines.length) {
    const m = OPEN.exec(lines[i]!);
    if (!m) { off += lines[i]!.length + 1; i++; continue; }
    const from = off + lines[i]!.length + 1;
    const { end, line: closingLine, closed } = findClosingFence(lines, i + 1, from, m[1]!);
    const to = closed ? end : Math.min(end, doc.length);
    out.push({ from: Math.min(from, doc.length), to, text: doc.slice(Math.min(from, doc.length), to) });
    off = closed ? end + lines[closingLine]!.length + 1 : doc.length;
    i = closed ? closingLine + 1 : lines.length;
  }
  return out;
}

function findClosingFence(lines: string[], start: number, bodyStart: number, fence: string): { end: number; line: number; closed: boolean } {
  let end = bodyStart;
  for (let line = start; line < lines.length; line++) {
    const close = CLOSE.exec(lines[line]!);
    if (close && close[1]!.startsWith(fence[0]!) && close[1]!.length >= fence.length) return { end, line, closed: true };
    end += lines[line]!.length + 1;
  }
  return { end, line: lines.length, closed: false };
}

export interface Around { text: string; /** Cursor offset inside `text`. */ offset: number; startLine: number; endLine: number }

/** If (line, ch) sits inside a flowmotion block body, the body text and the cursor's offset in it. Cheap: scans only nearby lines. */
export function bodyAround(lineAt: (i: number) => string, count: number, line: number, ch: number): Around | undefined {
  if (FENCE.test(lineAt(line))) return undefined;
  const start = openingBodyStart(lineAt, line);
  if (start < 0) return undefined;
  const { end, closed } = closingBodyEnd(lineAt, start, count, line);
  return bodyText(lineAt, start, end, line, ch, closed);
}

function openingBodyStart(lineAt: (i: number) => string, line: number): number {
  for (let index = line - 1; index >= 0; index--) {
    const text = lineAt(index);
    if (!FENCE.test(text)) continue;
    return OPEN.test(text) ? index + 1 : -1;
  }
  return -1;
}

function closingBodyEnd(lineAt: (i: number) => string, start: number, count: number, line: number): { end: number; closed: boolean } {
  for (let index = Math.max(start, line); index < count; index++) {
    if (CLOSE.test(lineAt(index))) return { end: index, closed: true };
  }
  return { end: count, closed: false };
}

function bodyText(lineAt: (i: number) => string, start: number, end: number, line: number, ch: number, closed: boolean): Around {
  const body: string[] = [];
  let offset = 0;
  for (let index = start; index < end; index++) {
    const text = lineAt(index);
    if (index < line) offset += text.length + 1;
    else if (index === line) offset += Math.min(ch, text.length);
    body.push(text);
  }
  return { text: body.join('\n') + (closed ? '\n' : ''), offset, startLine: start, endLine: end };
}
