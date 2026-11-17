import { plain } from './str';
import { COLOR } from './types';
/** Per-diagram display options, written as top-level keys next to the diagram definition. */
export interface View {
  controls?: boolean;
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
  if (raw.controls !== undefined) {
    if (typeof raw.controls !== 'boolean') bad('controls: use true or false');
    else v.controls = raw.controls;
  }
  if (raw.controlsPosition !== undefined) {
    if (raw.controlsPosition !== 'top' && raw.controlsPosition !== 'bottom') bad('controlsPosition: top or bottom');
    else v.controlsPosition = raw.controlsPosition;
  }
  for (const k of ['header', 'footer'] as const) {
    if (raw[k] === undefined) continue;
    if (typeof raw[k] !== 'boolean') bad(`${k}: use true or false`);
    else v[k] = raw[k];
  }
  if (raw.mode !== undefined) {
    if (raw.mode !== 'fit' && raw.mode !== 'normal') bad('mode: fit or normal');
    else v.mode = raw.mode;
  }
  if (raw.paper !== undefined) {
    const c = plain(raw.paper).trim();
    if (!['light', 'dark', 'none'].includes(c) && !COLOR.test(c)) bad('paper: light, dark, none or a colour like #f4f1ea');
    else v.paper = c;
  }
  const size = (key: 'height' | 'width', units: string, hint: string) => {
    if (raw[key] === undefined) return;
    const s = typeof raw[key] === 'number' ? `${raw[key]}px` : plain(raw[key]).trim();
    if (!new RegExp(`^\\d{1,4}(\\.\\d+)?(${units})$`).test(s)) bad(`${key}: a size like ${hint} (a bare number means px)`);
    else v[key] = s;
  };
  size('height', 'px|vh', '60vh or 500px');
  size('width', 'px|vw|%', '70%, 900px or 80vw');
  return v;
}
