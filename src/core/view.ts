import { plain } from './str';
import { COLOR } from './types';
/** Per-diagram display options, written as top-level keys next to the diagram definition. */
export interface View {
  controls?: boolean;
  /** Wait for a button press before playing each beat or event interval. */
  interactive?: boolean;
  /** Where the control bar sits (default "top"). */
  controlsPosition?: 'top' | 'bottom';
  /** Max height of the diagram, e.g. "60vh" or "500px". */
  height?: string;
  /** Max width of the diagram, e.g. "70%", "900px" or "80vw". The diagram is centered. */
  width?: string;
  mode?: 'fit' | 'normal';
  /** Storyboards: show the step label above the diagram (default false). */
  header?: boolean;
  /** Storyboards: show the caption text below the diagram (default false). */
  footer?: boolean;
  /** draw.io drawings: sheet behind the drawing. "light" (default) white, "dark" dark, "none" transparent and follows the Obsidian theme, or any colour such as "#f4f1ea". */
  paper?: string;
}

export function parseView(raw: Record<string, unknown>, bad: (m: string) => void): View {
  const v: View = {};
  for (const key of ['controls', 'interactive', 'header', 'footer'] as const) setBoolean(raw, v, bad, key);
  setControlsPosition(raw, v, bad);
  setMode(raw, v, bad);
  setPaper(raw, v, bad);
  parseSize(raw, v, bad, 'height', 'px|vh', '60vh or 500px');
  parseSize(raw, v, bad, 'width', 'px|vw|%', '70%, 900px or 80vw');
  return v;
}

function setBoolean(raw: Record<string, unknown>, view: View, bad: (message: string) => void, key: 'controls' | 'interactive' | 'header' | 'footer'): void {
  if (raw[key] === undefined) return;
  if (typeof raw[key] !== 'boolean') bad(`${key}: use true or false`);
  else view[key] = raw[key];
}

function setControlsPosition(raw: Record<string, unknown>, view: View, bad: (message: string) => void): void {
  if (raw.controlsPosition === undefined) return;
  if (raw.controlsPosition !== 'top' && raw.controlsPosition !== 'bottom') bad('controlsPosition: top or bottom');
  else view.controlsPosition = raw.controlsPosition;
}

function setMode(raw: Record<string, unknown>, view: View, bad: (message: string) => void): void {
  if (raw.mode === undefined) return;
  if (raw.mode !== 'fit' && raw.mode !== 'normal') bad('mode: fit or normal');
  else view.mode = raw.mode;
}

function setPaper(raw: Record<string, unknown>, view: View, bad: (message: string) => void): void {
  if (raw.paper === undefined) return;
  const colorValue = plain(raw.paper).trim();
  if (!['light', 'dark', 'none'].includes(colorValue) && !COLOR.test(colorValue)) bad('paper: light, dark, none or a colour like #f4f1ea');
  else view.paper = colorValue;
}

function parseSize(
  raw: Record<string, unknown>,
  view: View,
  bad: (message: string) => void,
  key: 'height' | 'width',
  units: string,
  hint: string,
): void {
  if (raw[key] === undefined) return;
  const s = typeof raw[key] === 'number' ? `${raw[key]}px` : plain(raw[key]).trim();
  if (!new RegExp(String.raw`^\d{1,4}(\.\d+)?(${units})$`).test(s)) bad(`${key}: a size like ${hint} (a bare number means px)`);
  else view[key] = s;
}
