import { textWidth } from '../core/geometry';
import type { RowSpec } from '../story/types';

export const ROW_GAP = 6, GRAPH_H = 73;
const charW = (mono: boolean) => (mono ? 0.62 : 0.56);

export function wrap(text: string, maxW: number, size: number, mono = false, maxLines = 4): string[] {
  const per = Math.max(4, Math.floor(maxW / (size * charW(mono))));
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && (cur + ' ' + w).length > per) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1]!.replace(/.{0,2}$/, '…'); }
  return lines;
}

export interface GraphPart { nodes: { name: string; x: number; y: number; w: number; lit: boolean }[]; links: [number, number][] }
export interface RowPart { y: number; h: number; spec: RowSpec; lines: string[]; graph?: GraphPart }

/** Stack rows inside a card of inner width `innerW`. Pure, shared by layout and renderer. */
export function layoutRows(rows: RowSpec[], innerW: number): { parts: RowPart[]; h: number } {
  const parts: RowPart[] = [];
  let y = 0;
  for (const r of rows) {
    let part: RowPart;
    if (r.kind === 'graph') {
      const names = r.nodes ?? [];
      const nodes = names.map((name, i) => {
        const w = textWidth(name, 11) + 14, left = i === 0;
        const rest = names.length - 1, k = i - 1;
        return {
          name, w, lit: (r.lit ?? []).includes(name),
          x: left ? Math.max(w / 2 + 2, innerW * 0.2) : Math.min(innerW - w / 2 - 2, innerW * 0.72),
          y: left ? GRAPH_H / 2 : rest === 1 ? GRAPH_H / 2 : 14 + (k * (GRAPH_H - 28)) / (rest - 1),
        };
      });
      const idx = (n: string) => names.indexOf(n);
      const links = (r.links ?? []).map(([a, b]) => [idx(a), idx(b)] as [number, number]).filter(([a, b]) => a >= 0 && b >= 0);
      part = { y, h: GRAPH_H, spec: r, lines: [], graph: { nodes, links } };
    } else {
      const lines = wrap(r.text ?? '', innerW - 16, 12, r.mono);
      const hdr = r.tag || r.mark ? 15 : 0;
      part = { y, h: 7 + hdr + Math.max(1, lines.length) * 14.5 + (r.meta ? 14 : 0) + 7, spec: r, lines };
    }
    parts.push(part);
    y += part.h + ROW_GAP;
  }
  return { parts, h: parts.length ? y - ROW_GAP : 0 };
}
