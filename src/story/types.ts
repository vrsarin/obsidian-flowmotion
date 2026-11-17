export type Tone = 'gray' | 'blue' | 'purple' | 'green' | 'orange';
export const TONES: Tone[] = ['gray', 'blue', 'purple', 'green', 'orange'];

/** One entry inside a card: a text row or a small entity graph. */
export interface RowSpec {
  kind: 'row' | 'graph';
  tag?: string; tone: Tone; text?: string; meta?: string; mark?: string; mono?: boolean;
  nodes?: string[]; links?: [string, string][]; lit?: string[];
}
export interface StoryElement {
  id: string;
  type: 'rectangle' | 'cylinder' | 'group' | 'arrow';
  // cards
  title?: string; subtitle?: string; width?: number; minCardHeight?: number;
  // groups
  groupLabel?: string; children?: string[]; direction?: 'row' | 'column'; gap?: number; align?: 'stretch' | 'center' | 'start';
  // arrows
  start?: string; end?: string; label?: string; quiet?: boolean;
}
export interface BeatEdge { edge: string; data?: string; back: boolean }
export interface Beat { edges: BeatEdge[]; show: Record<string, RowSpec[]>; light: string[]; say: string; ms?: number }
export interface Scene { label: string; beats: Beat[] }
export interface Storyboard { view?: import("../core/view").View; id: string; title: string; speed: number; elements: StoryElement[]; scenes: Scene[] }
