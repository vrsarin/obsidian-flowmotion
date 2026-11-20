import { isMap, isScalar, isSeq, parseDocument, type Node, type YAMLMap } from 'yaml';
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
  let want: Schema['type'];
  if (isSeq(node)) want = 'array';
  else if (isMap(node)) want = 'object';
  else want = 'string';
  return s.anyOf.find((b) => b.type === want) ?? s.anyOf[0];
}

type Ctx = { kind: 'key'; schema: Schema; present: Set<string> } | { kind: 'value'; schema: Schema };

function contextOf(node: Node | null, schema: Schema | undefined): Ctx | undefined {
  schema = pick(schema, node);
  if (!node || !schema) return undefined;
  if (isMap(node)) return contextInMap(node, schema);
  if (isSeq(node)) return contextInSequence(node, schema);
  if (isScalar(node) && node.value === MARK) return { kind: 'value', schema };
  return undefined;
}

function contextInMap(node: YAMLMap, schema: Schema): Ctx | undefined {
  const hasMark = node.items.some((pair) => (pair.key as { value?: unknown })?.value === MARK);
  if (hasMark) return mapMarkerContext(node, schema);
  for (const pair of node.items) {
    const key = String((pair.key as { value?: unknown })?.value);
    const additional = typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined;
    const hit = contextOf(pair.value as Node | null, schema.properties?.[key] ?? additional);
    if (hit) return hit;
  }
  return undefined;
}

function mapMarkerContext(node: YAMLMap, schema: Schema): Ctx {
  if (schema.type !== 'object') return { kind: 'value', schema };
  const present = new Set(node.items.map((pair) => String((pair.key as { value?: unknown })?.value)));
  return { kind: 'key', schema, present };
}

function contextInSequence(node: import('yaml').YAMLSeq, schema: Schema): Ctx | undefined {
  for (const item of node.items as Node[]) {
    const hit = contextOf(item, schema.items);
    if (hit) return hit;
  }
  return undefined;
}

function collectIds(js: unknown, ref: NonNullable<Schema['x-ref']>): string[] {
  const root = (js ?? {}) as Record<string, unknown>;
  const list = (k: string) => (Array.isArray(root[k]) ? (root[k] as unknown[]) : []);
  const key = { node: 'nodes', flow: 'flows', event: 'events', element: 'elements' }[ref];
  return list(key).map((x) => (x as { id?: unknown })?.id).filter((x): x is string => typeof x === 'string');
}

interface CursorWord {
  before: string;
  afterRest: string;
  word: string;
  from: number;
  wordEnd: number;
  keyAlready: boolean;
  isKey: boolean;
}

function cursorWord(source: string, pos: number): CursorWord | undefined {
  const lineStart = source.lastIndexOf('\n', pos - 1) + 1;
  const before = source.slice(lineStart, pos);
  const lineEnd = source.indexOf('\n', pos);
  const afterRest = source.slice(pos, lineEnd < 0 ? source.length : lineEnd);
  const isKey = KEY_POS.test(before);
  if (!isKey && !VAL_POS.test(before)) return undefined;
  const word = /[\w.>-]*$/.exec(before)![0];
  const wordEnd = /^[\w.>-]*/.exec(afterRest)![0].length;
  const keyAlready = /^[\w.>-]*"?[ \t]*:/.test(afterRest) || (before[before.length - word.length - 1] === '"' && afterRest[wordEnd] === '"');
  return { before, afterRest, word, from: pos - word.length, wordEnd, keyAlready, isKey };
}

function documentKind(keys: ReadonlySet<string>, kindHint?: Kind): Kind {
  return kindHint ?? (keys.has('scenes') || keys.has('elements') ? 'storyboard' : 'diagram');
}

/** Suggestions for the cursor position inside one definition (`pos` is an offset into `source`). */
export function completeAt(source: string, pos: number, kindHint?: Kind): Completions | undefined {
  const cursor = cursorWord(source, pos);
  if (!cursor) return undefined;
  const { from, wordEnd, keyAlready, isKey } = cursor;
  const patched = source.slice(0, from) + MARK + (isKey && !keyAlready ? ': 0' : '') + source.slice(pos + wordEnd);

  const doc = parseDocument(patched, { strict: false, prettyErrors: false });
  const top = doc.contents;
  if (!isMap(top)) return undefined;
  const keys = new Set(top.items.map((p) => String((p.key as { value?: unknown })?.value)));
  const kind = documentKind(keys, kindHint);
  const ctx = contextOf(top, kind === 'storyboard' ? storySchema : diagramSchema);
  if (!ctx) return undefined;

  const js = doc.toJS({ maxAliasCount: 20 }) as unknown;
  const suggestions = suggestionsFor(ctx, js, keyAlready);
  return suggestions.length ? { from, suggestions } : undefined;
}

function addSchemaValues(out: Suggestion[], schema: Schema, js: unknown): void {
  const selected = pick(schema, null) ?? schema;
  for (const value of selected.enum ?? []) out.push({ label: String(value), insert: String(value), type: 'enum', detail: selected.description });
  if (selected.type === 'boolean') {
    for (const value of ['true', 'false']) out.push({ label: value, insert: value, type: 'enum' });
  }
  if (selected['x-ref']) {
    for (const id of collectIds(js, selected['x-ref'])) out.push({ label: id, insert: id, type: 'ref', detail: selected['x-ref'] });
  }
}

function uniqueSuggestions(suggestions: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    if (seen.has(suggestion.label)) return false;
    seen.add(suggestion.label);
    return true;
  });
}

function suggestionsFor(ctx: Ctx, js: unknown, keyAlready: boolean): Suggestion[] {
  if (ctx.kind === 'key') return uniqueSuggestions(propertySuggestions(ctx, keyAlready));
  return uniqueSuggestions(valueSuggestions(ctx.schema, js));
}

function propertySuggestions(ctx: Extract<Ctx, { kind: 'key' }>, keyAlready: boolean): Suggestion[] {
  const out: Suggestion[] = [];
  for (const [key, schema] of Object.entries(ctx.schema.properties ?? {})) {
    if (ctx.present.has(key) && key !== MARK) continue;
    out.push({
      label: key,
      insert: keyAlready ? key : `${key}: `,
      type: 'property',
      detail: schema.type ?? (schema.anyOf ? 'list or id' : undefined),
      info: schema.description,
    });
  }
  return out;
}

function valueSuggestions(schema: Schema, js: unknown): Suggestion[] {
  const out: Suggestion[] = [];
  addSchemaValues(out, stringBranch(schema), js);
  if (schema.type === 'array' && schema.items) addSchemaValues(out, schema.items, js);
  return out;
}

function stringBranch(schema: Schema): Schema {
  const branch = schema.anyOf?.find((candidate) => candidate.type === 'string');
  if (!branch) return schema;
  const withoutBranches = { ...schema };
  delete withoutBranches.anyOf;
  return { ...withoutBranches, ...branch };
}

export interface Docs { title: string; type?: string; description?: string; values?: string[] }

/** Documentation for the key under `pos` (for hover tooltips). */
export function docsAt(source: string, pos: number, kindHint?: Kind): (Docs & { from: number; to: number }) | undefined {
  const doc = parseDocument(source, { strict: false, prettyErrors: false });
  const top = doc.contents;
  if (!isMap(top)) return undefined;
  const keys = new Set(top.items.map((p) => String((p.key as { value?: unknown })?.value)));
  const kind = documentKind(keys, kindHint);
  return findDocsAt(top, kind === 'storyboard' ? storySchema : diagramSchema, pos);
}

type LocatedDocs = Docs & { from: number; to: number };

function findDocsAt(node: Node | null, schema: Schema | undefined, pos: number): LocatedDocs | undefined {
  schema = pick(schema, node);
  if (!node || !schema) return undefined;
  if (isMap(node)) return findMapDocs(node, schema, pos);
  if (isSeq(node)) {
    for (const item of node.items as Node[]) {
      const hit = findDocsAt(item, schema.items, pos);
      if (hit) return hit;
    }
  }
  return undefined;
}

function findMapDocs(node: YAMLMap, schema: Schema, pos: number): LocatedDocs | undefined {
  for (const pair of node.items) {
    const keyNode = pair.key as { value?: unknown; range?: [number, number, number] } | null;
    const key = String(keyNode?.value);
    const sub = schema.properties?.[key];
    if (keyNode?.range && pos >= keyNode.range[0] && pos <= keyNode.range[1] && sub) {
      const selected = pick(sub, pair.value as Node | null) ?? sub;
      return {
        title: key,
        type: selected.type ?? (sub.anyOf ? 'list or id' : undefined),
        description: sub.description,
        values: selected.enum?.map(String),
        from: keyNode.range[0],
        to: keyNode.range[1],
      };
    }
    const hit = findDocsAt(pair.value as Node | null, sub, pos);
    if (hit) return hit;
  }
  return undefined;
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

function addScalar(out: Scalar[], node: Node, extra: Pick<Scalar, 'ref' | 'def'>): void {
  if (!isScalar(node) || !node.range || (typeof node.value !== 'string' && typeof node.value !== 'number')) return;
  const quoted = node.type === 'QUOTE_DOUBLE' || node.type === 'QUOTE_SINGLE';
  out.push({
    from: node.range[0] + (quoted ? 1 : 0),
    to: node.range[1] - (quoted ? 1 : 0),
    value: String(node.value),
    ...extra,
  });
}

function walkScalarNode(node: Node | null, schema: Schema | undefined, def: Scalar['def'], top: Node, out: Scalar[]): void {
  const selected = pick(schema, node);
  if (!node || !selected) return;
  if (isMap(node)) {
    walkMapScalars(node, selected, def, top, out);
    return;
  }
  if (isSeq(node)) {
    for (const item of node.items as Node[]) walkScalarNode(item, selected.items, undefined, top, out);
    return;
  }
  if (selected['x-ref']) addScalar(out, node, { ref: selected['x-ref'] });
}

function walkMapScalars(node: YAMLMap, schema: Schema, def: Scalar['def'], top: Node, out: Scalar[]): void {
  for (const pair of node.items as import('yaml').Pair<Node, Node>[]) walkMapScalarEntry(pair, node, schema, def, top, out);
}

function walkMapScalarEntry(pair: import('yaml').Pair<Node, Node>, node: YAMLMap, schema: Schema, def: Scalar['def'], top: Node, out: Scalar[]): void {
  const key = String((pair.key as { value?: unknown })?.value);
  const sub = schema.properties?.[key];
  if (schema['x-key-ref'] && pair.key) addScalar(out, pair.key, { ref: schema['x-key-ref'] });
  if (def && key === 'id' && pair.value) addScalar(out, pair.value, { def });
  else {
    const additional = typeof schema.additionalProperties === 'object' ? schema.additionalProperties : undefined;
    const childDef = DEF_LISTS[key] && node === top ? undefined : def;
    walkScalarNode(pair.value, sub ?? additional, childDef, top, out);
  }
  if (node === top && DEF_LISTS[key] && isSeq(pair.value)) walkDefinitionItems(pair.value, sub?.items, DEF_LISTS[key], top, out);
}

function walkDefinitionItems(node: import('yaml').YAMLSeq, schema: Schema | undefined, def: Scalar['def'], top: Node, out: Scalar[]): void {
  for (const item of node.items as Node[]) walkScalarNode(item, schema, def, top, out);
}

/** Every id definition (`id:` in nodes/flows/events/elements) and id reference (schema `x-ref`) with its text range. */
export function collectScalars(source: string, kindHint?: Kind): Scalar[] {
  const doc = parseDocument(source, { strict: false, prettyErrors: false });
  const top = doc.contents;
  if (!isMap(top)) return [];
  const keys = new Set(top.items.map((p) => String((p.key as { value?: unknown })?.value)));
  const kind = documentKind(keys, kindHint);
  const out: Scalar[] = [];
  // Top-level lists are walked above with `def` set; skip the generic descent for them.
  const root = kind === 'storyboard' ? storySchema : diagramSchema;
  for (const p of top.items) {
    const key = String((p.key as { value?: unknown })?.value);
    const sub = root.properties?.[key];
    if (DEF_LISTS[key] && isSeq(p.value)) {
      for (const item of p.value.items as Node[]) walkScalarNode(item, sub?.items, DEF_LISTS[key], top, out);
    } else if (key !== 'diagram') walkScalarNode(p.value, sub, undefined, top, out);
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
