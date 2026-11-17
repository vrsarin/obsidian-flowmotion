import type { Layout } from '../layout/types';
import type { Timeline } from '../core/timeline';
import type { View } from '../core/view';
import type { AnimationDef } from '../core/types';

/** Everything needed to render and play a diagram. JSON-serializable; no Obsidian or ELK dependency. */
export interface Model { id: string; animation: AnimationDef; layout: Layout; timeline: Timeline; view?: View;
  /** A drawing shown unchanged under the animation (draw.io SVG); ox/oy place it in layout coordinates. */
  backdrop?: { inner: string; w: number; h: number; ox: number; oy: number } }
