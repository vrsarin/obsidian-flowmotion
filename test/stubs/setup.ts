// Obsidian adds DOM helpers to every element (createEl, addClass, ...) and globals (activeDocument).
// Only tests that declare the happy-dom environment have these globals.
if (typeof HTMLElement !== "undefined") {
// Provide the subset FlowMotion uses, on top of happy-dom, so UI code runs under Vitest.
type Opts = { cls?: string; text?: string; attr?: Record<string, string>; title?: string };
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
const apply = (el: HTMLElement, o?: Opts | string) => {
  if (typeof o === 'string') el.className = o;
  else if (o) {
    if (o.cls) el.className = o.cls;
    if (o.text !== undefined) el.textContent = o.text;
    if (o.title) el.title = o.title;
    for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, v);
  }
  return el;
};
proto.createEl = function (this: HTMLElement, tag: string, o?: Opts | string) { const el = apply(this.ownerDocument.createElement(tag), o); this.appendChild(el); return el; };
proto.createDiv = function (this: HTMLElement, o?: Opts | string) { return (this as HTMLElement & { createEl: (t: string, o?: unknown) => HTMLElement }).createEl('div', o); };
proto.createSpan = function (this: HTMLElement, o?: Opts | string) { return (this as HTMLElement & { createEl: (t: string, o?: unknown) => HTMLElement }).createEl('span', o); };
proto.empty = function (this: HTMLElement) { this.replaceChildren(); };
proto.show = function (this: HTMLElement) { this.style.display = ''; };
proto.hide = function (this: HTMLElement) { this.style.display = 'none'; };
proto.setText = function (this: HTMLElement, t: string) { this.textContent = t; };
proto.addClass = function (this: HTMLElement, ...c: string[]) { this.classList.add(...c); };
proto.removeClass = function (this: HTMLElement, ...c: string[]) { this.classList.remove(...c); };
proto.hasClass = function (this: HTMLElement, c: string) { return this.classList.contains(c); };
proto.toggleClass = function (this: HTMLElement, c: string, on: boolean) { this.classList.toggle(c, on); };
(globalThis as Record<string, unknown>).activeDocument = document;
(globalThis as Record<string, unknown>).activeWindow = window;
(globalThis as Record<string, unknown>).createEl = (tag: string, o?: Opts | string) => apply(document.createElement(tag), o);
}
