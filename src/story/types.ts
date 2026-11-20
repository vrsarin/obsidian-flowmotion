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
  start?: string; end?: string; label?: string; quiet?: boolean; line?: Line;
}
export interface BeatEdge { edge: string; data?: string; back: boolean }
export interface Beat { edges: BeatEdge[]; show: Record<string, RowSpec[]>; light: string[]; say: string; ms?: number }
export interface ShapePresentation { visible?: boolean; opacity?: number; fill?: string; stroke?: string }
export interface NodePresentation extends ShapePresentation { highlight?: boolean }
export interface ArrowPresentation {
  visible?: boolean; opacity?: number; color?: string; arrowheads?: 'start' | 'end' | 'both' | 'none';
  packet?: boolean; highlight?: boolean;
}
export interface ScenePresentation {
  defaults?: { nodes?: NodePresentation; groups?: ShapePresentation; arrows?: ArrowPresentation };
  nodes?: Record<string, NodePresentation>;
  groups?: Record<string, ShapePresentation>;
  arrows?: Record<string, ArrowPresentation>;
}
export interface Scene { label: string; beats: Beat[]; presentation?: ScenePresentation }
export interface Storyboard { view?: import("../core/view").View; id: string; title: string; speed: number; elements: StoryElement[]; scenes: Scene[] }
import type { Line } from '../core/types';

