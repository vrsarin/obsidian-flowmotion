// A string-backed stand-in for Obsidian's Editor, enough for FlowMotion's block and completion helpers.
export class FakeEditor {
  cursor = { line: 0, ch: 0 };
  selection?: [any, any];
  constructor(public doc: string, line = 0, ch = 0) { this.cursor = { line, ch }; }
  getValue() { return this.doc; }
  getLine(n: number) { return this.doc.split('\n')[n] ?? ''; }
  lineCount() { return this.doc.split('\n').length; }
  getCursor(_w?: string) { return this.cursor; }
  setCursor(p: { line: number; ch: number }) { this.cursor = p; }
  setSelection(a: any, b: any) { this.selection = [a, b]; }
  posToOffset(p: { line: number; ch: number }) {
    const ls = this.doc.split('\n'); let o = 0;
    for (let i = 0; i < p.line; i++) o += (ls[i] ?? '').length + 1;
    return o + p.ch;
  }
  offsetToPos(o: number) {
    const before = this.doc.slice(0, o).split('\n');
    return { line: before.length - 1, ch: before[before.length - 1]!.length };
  }
  replaceRange(text: string, from: { line: number; ch: number }, to: { line: number; ch: number }) {
    this.doc = this.doc.slice(0, this.posToOffset(from)) + text + this.doc.slice(this.posToOffset(to));
  }
  replaceSelection = (text: string) => { const o = this.posToOffset(this.cursor); this.doc = this.doc.slice(0, o) + text + this.doc.slice(o); };
}
