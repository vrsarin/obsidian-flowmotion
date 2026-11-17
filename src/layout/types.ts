import type { Path } from '../core/geometry';

export interface LaidNode {
  id: string; label: string; x: number; y: number; w: number; h: number;
  /** Storyboard cards only. */
  kind?: 'rect' | 'cylinder'; subtitle?: string; headerH?: number;
  /** Diagram nodes: outline and colour overrides. */
  /** Draw the label to the right of the shape (Gantt bars that are too short for it). */ outside?: boolean;
  href?: string; tooltip?: string;
  lines?: string[]; shape?: import('../core/types').Shape; style?: import('../core/types').Style;
}
export interface LaidGroup { id: string; label?: string; x: number; y: number; w: number; h: number; /** Nesting depth, 0 = outermost. */ depth?: number }
export interface LaidEdge { id: string; from: string; to: string; path: Path; label?: { text: string; x: number; y: number }; quiet?: boolean;
  headLabel?: { text: string; x: number; y: number }; tailLabel?: { text: string; x: number; y: number };
  line?: import('../core/types').Line; head?: import('../core/types').End; tail?: import('../core/types').End; style?: import('../core/types').Style }
export interface Layout {
  /** Time axis: vertical gridlines with labels along the top. */
  axis?: { ticks: { x: number; label: string }[]; top: number; bottom: number; title?: string };
  width: number; height: number;
  /** Fixed layouts: diagram coordinates of this layout's top-left corner. */
  origin?: { x: number; y: number };
  nodes: LaidNode[]; groups: LaidGroup[]; edges: LaidEdge[];
  /** Storyboard chrome: step label baseline and caption block. */
  story?: { headerY: number; captionY: number; captionW: number; captionH: number; contentTop: number; contentBottom: number };
}
