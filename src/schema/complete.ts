import { isMap, isScalar, isSeq, parseDocument, type Node } from 'yaml';
import { diagramSchema } from './diagram';
import { storySchema } from './story';
import type { Schema } from './types';
import type { Kind } from './validate';

export interface Suggestion { label: string; insert: string; detail?: string; info?: string; type: 'property' | 'enum' | 'ref' }
export interface Completions { from: number; suggestions: Suggestion[] }

const MARK = '__fm__';
const KEY_POS = /(^[ \t]*(?:-[ \t]+)?|[{,][ \t]*)"?[\w-]*$/;
const VAL_POS = /(:[ \t]+|[[,][ \t]*|^[ \t]*-[ \t]+)"?[\w.>-]*$/;

/** Pick the schema branch that fits a YAML node (for `anyOf`). */
function pick(s: Schema | undefined, node: Node | null): Schema | undefined {
  if (!s?.anyOf) return s;
  const want = isSeq(node) ? 'array' : isMap(node) ? 'object' : 'string';
  return s.anyOf.find((b) => b.type === want) ?? s.anyOf[0];
}

type Ctx = { kind: 'key'; schema: Schema; present: Set<string> } | { kind: 'value'; schema: Schema };

function contextOf(node: Node | null, schema: Schema | undefined): Ctx | undefined {
  schema = pick(schema, node);
  if (!node || !schema) return undefined;
  if (isMap(node)) {
    const hasMark = node.items.some((p) => (p.key as { value?: unknown })?.value === MARK);
    if (hasMark) {
      if (schema.type === 'object') return { kind: 'key', schema, present: new Set(node.items.map((p) => String((p.key as { value?: unknown })?.value))) };
      return { kind: 'value', schema }; // `- fm: 0` typed where a plain id is expected
    }
    for (const p of node.items) {
      const key = String((p.key as { value?: unknown })?.value);
      const sub = schema.properties?.[key] ?? (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined);
      const hit = contextOf(p.value as Node | null, sub);
      if (hit) return hit;
    }
  } else if (isSeq(node)) {
    for (const it of node.items as Node[]) {
      const hit = contextOf(it, schema.items);
      if (hit) return hit;
    }
  } else if (isScalar(node) && node.value === MARK) return { kind: 'value', schema };
  return undefined;
}

function collectIds(js: unknown, ref: NonNullable<Schema['x-ref']>): string[] {
  const root = (js ?? {}) as Record<string, unknown>;
  const list = (k: string) => (Array.isArray(root[k]) ? (root[k] as unknown[]) : []);
  const key = { node: 'nodes', flow: 'flows', event: 'events', element: 'elements' }[ref];
  return list(key).map((x) => (x as { id?: unknown })?.id).filter((x): x is string => typeof x === 'string');
}

/** Suggestions for the cursor position inside one definition (`pos` is an offset into `source`). */
export function completeAt(source: string, pos: number, kindHint?: Kind): Completions | undefined {
  const lineStart = source.lastIndexOf('\n', pos - 1) + 1;
  const before = source.slice(lineStart, pos);
  const afterRest = source.slice(pos, source.indexOf('\n', pos) < 0 ? source.length : source.indexOf('\n', pos));
  const isKey = KEY_POS.test(before);
  if (!isKey && !VAL_POS.test(before)) return undefined;
  const word = /[\w.>-]*$/.exec(before)![0];
  const from = pos - word.length;
  const wordEnd = /^[\w.>-]*/.exec(afterRest)![0].length;
  // Key already has its colon, or sits inside JSON quotes: insert only the name.
  const keyAlready = /^[\w.>-]*"?[ \t]*:/.test(afterRest) || (before[before.length - word.length - 1] === '"' && afterRest[wordEnd] === '"');
  const patched = source.slice(0, from) + MARK + (isKey && !keyAlready ? ': 0' : '') + source.slice(pos + wordEnd);

  const doc = parseDocument(patched, { strict: false, prettyErrors: false });
  const top = doc.contents;
  if (!isMap(top)) return undefined;
  const keys = top.items.map((p) => String((p.key as { value?: unknown })?.value));
  const kind: Kind = kindHint ?? (keys.includes('scenes') || keys.includes('elements') ? 'storyboard' : 'diagram');
  const ctx = contextOf(top, kind === 'storyboard' ? storySchema : diagramSchema);
  if (!ctx) return undefined;

  const js = doc.toJS({ maxAliasCount: 20 }) as unknown;
  const out: Suggestion[] = [];
  const addValues = (s: Schema) => {
    const sch = pick(s, null) ?? s;
    for (const e of sch.enum ?? []) out.push({ label: String(e), insert: String(e), type: 'enum', detail: sch.description });
    if (sch.type === 'boolean') for (const b of ['true', 'false']) out.push({ label: b, insert: b, type: 'enum' });
    if (sch['x-ref']) for (const id of collectIds(js, sch['x-ref'])) out.push({ label: id, insert: id, type: 'ref', detail: sch['x-ref'] });
  };
  if (ctx.kind === 'key') {
    for (const [k, v] of Object.entries(ctx.schema.properties ?? {})) {
      if (ctx.present.has(k) && k !== MARK) continue;
      out.push({ label: k, insert: keyAlready ? k : `${k}: `, type: 'property', detail: v.type ?? (v.anyOf ? 'list or id' : undefined), info: v.description });
    }
  } else {
    const s = ctx.schema;
    addValues(s.anyOf ? { ...s, ...(s.anyOf.find((b) => b.type === 'string') ?? {}), anyOf: undefined } : s);
    if (s.type === 'array' && s.items) addValues(s.items);
  }
  const seen = new Set<string>();
  const suggestions = out.filter((x) => (seen.has(x.label) ? false : (seen.add(x.label), true)));
  return suggestions.length ? { from, suggestions } : undefined;
}

export interface Docs { title: string; type?: string; description?: string; values?: string[] }

/** Documentation for the key under `pos` (for hover tooltips). */
export function docsAt(source: string, pos: number, kindHint?: Kind): (Docs & { from: number; to: number }) | undefined {
  const doc = parseDocument(source, { strict: false, prettyErrors: false });
  const top = doc.contents;
  if (!isMap(top)) return undefined;
  const keys = top.items.map((p) => String((p.key as { value?: unknown })?.value));
  const kind: Kind = kindHint ?? (keys.includes('scenes') || keys.includes('elements') ? 'storyboard' : 'diagram');
  const walk = (node: Node | null, schema: Schema | undefined): ReturnType<typeof docsAt> => {
    schema = pick(schema, node);
    if (!node || !schema) return undefined;
    if (isMap(node)) for (const p of node.items) {
      const k = p.key as { value?: unknown; range?: [number, number, number] } | null;
      const key = String(k?.value);
      const sub = schema.properties?.[key];
      if (k?.range && pos >= k.range[0] && pos <= k.range[1] && sub) {
        const s = pick(sub, p.value as Node | null) ?? sub;
        return { title: key, type: s.type ?? (sub.anyOf ? 'list or id' : undefined), description: sub.description, values: s.enum?.map(String), from: k.range[0], to: k.range[1] };
      }
      const hit = walk(p.value as Node | null, sub); if (hit) return hit;
    } else if (isSeq(node)) for (const it of node.items as Node[]) { const hit = walk(it, schema.items); if (hit) return hit; }
    return undefined;
  };
  return walk(top, kind === 'storyboard' ? storySchema : diagramSchema);
}

/** Starter snippets (CodeMirror snippet syntax) offered at the start of a list item. */
export const ITEM_SNIPPETS: Record<string, { label: string; template: string }[]> = {
  nodes: [{ label: 'node', template: '{ id: ${id}, label: ${Label} }' }],
  flows: [{ label: 'flow', template: '{ id: ${id}, from: ${from}, to: ${to}, payload: ${payload} }' }],
  events: [
    { label: 'transfer event', template: '{ id: ${id}, type: transfer, flow: ${flow}, after: [${}] }' },
    { label: 'process event', template: '{ id: ${id}, type: process, node: ${node}, after: [${}] }' },
    { label: 'branch event', template: '{ id: ${id}, type: branch, select: [${}], after: [${}] }' },
    { label: 'wait event', template: '{ id: ${id}, type: wait, node: ${node}, until: [${}] }' },
  ],
};

/** Which top-level list (nodes/flows/events) the cursor line starts a new item in, if any. */
export function itemListAt(source: string, pos: number): string | undefined {
  const lineStart = source.lastIndexOf('\n', pos - 1) + 1;
  if (!/^[ \t]*-[ \t]+$/.test(source.slice(lineStart, pos))) return undefined;
  const before = source.slice(0, lineStart).split('\n').reverse();
  for (const l of before) { const m = /^([A-Za-z]\w*):/.exec(l); if (m) return m[1]; }
  return undefined;
}

export interface Scalar { from: number; to: number; value: string; ref?: NonNullable<Schema['x-ref']>; def?: NonNullable<Schema['x-ref']> }
const DEF_LISTS: Record<string, NonNullable<Schema['x-ref']>> = { nodes: 'node', flows: 'flow', events: 'event', elements: 'element' };

/** Every id definition (`id:` in nodes/flows/events/elements) and id reference (schema `x-ref`) with its text range. */
export function collectScalars(source: string, kindHint?: Kind): Scalar[] {
  const doc = parseDocument(source, { strict: false, prettyErrors: false });
  const top = doc.contents;
  if (!isMap(top)) return [];
  const keys = top.items.map((p) => String((p.key as { value?: unknown })?.value));
  const kind: Kind = kindHint ?? (keys.includes('scenes') || keys.includes('elements') ? 'storyboard' : 'diagram');
  const out: Scalar[] = [];
  const put = (n: Node, extra: Pick<Scalar, 'ref' | 'def'>) => {
    if (!isScalar(n) || !n.range || (typeof n.value !== 'string' && typeof n.value !== 'number')) return;
    const quoted = n.type === 'QUOTE_DOUBLE' || n.type === 'QUOTE_SINGLE';
    out.push({ from: n.range[0] + (quoted ? 1 : 0), to: n.range[1] - (quoted ? 1 : 0), value: String(n.value), ...extra });
  };
  const walk = (node: Node | null, schema: Schema | undefined, def?: Scalar['def']) => {
    schema = pick(schema, node);
    if (!node || !schema) return;
    if (isMap(node)) for (const p of node.items) {
      const key = String((p.key as { value?: unknown })?.value);
      const sub = schema.properties?.[key];
      if (def && key === 'id' && p.value) put(p.value as Node, { def });
      else walk(p.value as Node | null, sub ?? (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined), DEF_LISTS[key] && node === top ? undefined : def);
      if (node === top && DEF_LISTS[key] && isSeq(p.value)) for (const it of p.value.items as Node[]) walk(it, sub?.items, DEF_LISTS[key]);
    } else if (isSeq(node)) { if (node !== undefined) for (const it of node.items as Node[]) walk(it, schema.items, undefined); }
    else if (schema['x-ref']) put(node, { ref: schema['x-ref'] });
  };
  // Top-level lists are walked above with `def` set; skip the generic descent for them.
  const root = kind === 'storyboard' ? storySchema : diagramSchema;
  for (const p of top.items) {
    const key = String((p.key as { value?: unknown })?.value);
    const sub = root.properties?.[key];
    if (DEF_LISTS[key] && isSeq(p.value)) for (const it of p.value.items as Node[]) walk(it, sub?.items, DEF_LISTS[key]);
    else if (key !== 'diagram') walk(p.value, sub);
  }
  return out;
}

/** Where the id under `pos` is defined (for Cmd/Ctrl-click). */
export function definitionAt(source: string, pos: number): Scalar | undefined {
  const all = collectScalars(source);
  const here = all.find((s) => s.ref && pos >= s.from && pos <= s.to);
  return here && all.find((s) => s.def === here.ref && s.value === here.value);
}

/** Text edits that rename the id under `pos` everywhere it is defined or referenced. */
export function renameAt(source: string, pos: number): { id: string; ranges: [number, number][] } | undefined {
  const all = collectScalars(source);
  const here = all.find((s) => (s.ref || s.def) && pos >= s.from && pos <= s.to);
  if (!here) return undefined;
  const kind = here.ref ?? here.def;
  return { id: here.value, ranges: all.filter((s) => (s.ref ?? s.def) === kind && s.value === here.value).map((s) => [s.from, s.to]) };
}
