export type Direction = 'LR' | 'RL' | 'TB' | 'BT';
export type EventType = 'transfer' | 'process' | 'complete' | 'branch' | 'fork' | 'join' | 'wait' | 'emit';
export type NodeState = 'idle' | 'receiving' | 'processing' | 'completed' | 'waiting' | 'error';

export const SAFE_HREF = /^(?:https?:\/\/|obsidian:\/\/|#)[^\s"'<>]*$/i;
export const SHAPES = ['rect', 'round', 'stadium', 'diamond', 'circle', 'cylinder', 'hexagon', 'subroutine', 'parallelogram', 'start', 'end', 'bar', 'class'] as const;
export type Shape = (typeof SHAPES)[number];
export const LINES = ['solid', 'dotted', 'thick'] as const;
export type Line = (typeof LINES)[number];
export const ENDS = ['none', 'arrow', 'circle', 'cross', 'triangle', 'diamond', 'diamond-filled'] as const;
export type End = (typeof ENDS)[number];

/** Colours only (validated, so they are safe to put in SVG attributes). */
export interface Style { fill?: string; stroke?: string; color?: string; strokeWidth?: number }
/** CSS colour: #hex, rgb()/hsl(), or a plain name. Nothing that could break out of an attribute. */
export const COLOR = /^(#[0-9a-fA-F]{3,8}|(?:rgb|hsl)a?\([0-9.,%\s/]+\)|[a-zA-Z]{3,24})$/;

export interface NodeDef { /** Optional link (http, https or obsidian: only) and hover text, from Mermaid `click`. */ href?: string; tooltip?: string; id: string; label: string; shape?: Shape; /** Extra text lines under the title (class members, entity attributes, state notes). */ lines?: string[]; /** Id of the containing group. */ group?: string; style?: Style }
export interface GroupDef { id: string; label?: string; /** Id of the enclosing group (nesting). */ parent?: string }
export interface FlowDef {
  id: string; from: string; to: string; payload?: string; curve: boolean;
  /** Static look of the connector. Defaults: solid line, arrow at the end, nothing at the start. */
  line?: Line; head?: End; tail?: End; style?: Style;
  /** Small texts at the two ends (multiplicity such as "1" or "0..*"). */
  headLabel?: string; tailLabel?: string;
}
export interface EventDef {
  id: string;
  type: EventType;
  flow?: string;
  node?: string;
  payload?: string;
  after: string[];
  /** wait only: the wait ends once all of these events complete. */
  until: string[];
  /** branch only: child events that are taken; other children are skipped. */
  select: string[];
  duration?: number;
  /** process only: node ends in `error` state. */
  fail: boolean;
}
export interface AnimationDef { autoplay: boolean; loop: boolean; speed: number }
/** Time-axis diagrams: each node id maps to its span in days from the project start. */
export interface GanttDef { startDay: number; tasks: Record<string, { start: number; end: number; milestone?: boolean }>; title?: string }
/** Imported diagrams (draw.io) keep their own coordinates: boxes by id, plus interior waypoints per flow. */
export interface FixedLayout { nodes: Record<string, { x: number; y: number; w: number; h: number }>; groups: Record<string, { x: number; y: number; w: number; h: number }>; routes: Record<string, { x: number; y: number }[]>;
  /** Draw.io SVG imports: minimum drawn x/y of the diagram, and each flow's connector cell id. */
  offset?: { x: number; y: number }; edgeCell?: Record<string, string> }
export interface Diagram {
  gantt?: GanttDef;
  fixed?: FixedLayout;
  view?: import("./view").View;
  id: string;
  direction: Direction;
  /** Draw each flow's payload text on its connector (always visible, even when static). */
  edgeLabels: boolean;
  nodes: NodeDef[];
  groups: GroupDef[];
  flows: FlowDef[];
  events: EventDef[];
  animation: AnimationDef;
}

export class DiagramError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join('\n'));
    this.name = 'DiagramError';
  }
}

export const LIMITS = { nodes: 200, flows: 400, events: 1000, label: 120, duration: 60000 } as const;
