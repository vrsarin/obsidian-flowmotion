import { plain } from '../core/str';
import { isMap, isScalar, isSeq, parseDocument, type Node, type Pair, type YAMLMap } from 'yaml';
import { parseDiagram } from '../core/parse';
import { DiagramError } from '../core/types';
import { isTextSource, parseText, TextError } from '../text/parse';
import { detectKind, parseStoryboard } from '../story/parse';
import { parseEmbed } from '../core/embed';
import { collectScalars } from './complete';
import { diagramSchema } from './diagram';
import { storySchema } from './story';
import type { Schema } from './types';

export interface Issue { from: number; to: number; message: string; severity: 'error' | 'warning'; /** Suggested replacement text for [from,to). */ fix?: string }
type Range = [number, number];

const rangeOf = (n: unknown): Range => {
  const r = (n as { range?: [number, number, number] } | null)?.range;
  return r ? [r[0], Math.max(r[1], r[0] + 1)] : [0, 1];
};

/** Closest known key, for "did you mean" hints. */
function suggest(key: string, known: string[]): string | undefined {
  const dist = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array.from({ length: b.length }, () => 0)] as number[]);
    for (let j = 1; j <= b.length; j++) d[0]![j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length]![b.length]!;
  };
  let best: string | undefined, bd = 3;
  for (const k of known) { const x = dist(key.toLowerCase(), k.toLowerCase()); if (x < bd) { bd = x; best = k; } }
  return best;
}

const typeName = (n: unknown): string => {
  if (isMap(n)) return 'a mapping';
  if (isSeq(n)) return 'a list';
  if (!isScalar(n)) return 'unknown';
  if (typeof n.value === 'string') return 'text';
  if (n.value === null) return 'empty';
  return typeof n.value;
};

/** Validate a YAML node against the schema subset; reports problems at the offending node. */
function check(node: Node | null, schema: Schema, out: Issue[], path: string): boolean {
  const add: AddIssue = (n, message, fix) => {
    const [from, to] = rangeOf(n);
    out.push({ from, to, message, severity: 'error', fix });
    return false;
  };
  if (!node) return true;
  if (schema.anyOf) return checkAnyOf(node, schema, out, path);
  const v = isScalar(node) ? node.value : undefined;
  switch (schema.type) {
    case 'object': return checkObject(node, schema, out, path, add);
    case 'array': return checkArray(node, schema, out, path, add);
    case 'string': return checkString(node, schema, v, path, add);
    case 'number':
    case 'integer': return checkNumber(node, schema, v, path, add);
    case 'boolean': return isScalar(node) && typeof v === 'boolean' ? true : add(node, `${path || 'document'}: use true or false`);
    default: return true;
  }
}

type AddIssue = (node: unknown, message: string, fix?: string) => false;

function checkAnyOf(node: Node, schema: Schema, out: Issue[], path: string): boolean {
  const attempts = schema.anyOf!.map((branch) => {
    const issues: Issue[] = [];
    check(node, branch, issues, path);
    return issues;
  });
  if (attempts.some((issues) => issues.length === 0)) return true;
  attempts.sort((a, b) => a.length - b.length);
  out.push(...(attempts[0] ?? []));
  return false;
}

function childPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function unknownKeyMessage(key: string, hint: string | undefined, known: string[]): string {
  if (hint) return `Unknown key "${key}" — did you mean "${hint}"?`;
  if (known.length) return `Unknown key "${key}" (allowed: ${known.join(', ')})`;
  return `Unknown key "${key}"`;
}

function checkObject(node: Node, schema: Schema, out: Issue[], path: string, add: AddIssue): boolean {
  if (!isMap(node)) return add(node, `${path || 'document'}: expected a mapping, found ${typeName(node)}`);
  const known = Object.keys(schema.properties ?? {});
  const seen = new Set<string>();
  let ok = true;
  for (const pair of node.items as Pair<Node, Node>[]) {
    if (!checkObjectPair(pair, schema, path, known, seen, out, add)) ok = false;
  }
  return checkRequired(node, schema, path, known, seen, add) && ok;
}

function checkObjectPair(
  pair: Pair<Node, Node>,
  schema: Schema,
  path: string,
  known: string[],
  seen: Set<string>,
  out: Issue[],
  add: AddIssue,
): boolean {
  const key = plain((pair.key as { value?: unknown })?.value ?? '');
  let ok = true;
  if (seen.has(key)) ok = add(pair.key, `${path || 'document'}: duplicate key "${key}"`);
  seen.add(key);
  const sub = schema.properties?.[key];
  if (sub) {
    if (!check(pair.value, sub, out, childPath(path, key))) ok = false;
  } else if (typeof schema.additionalProperties === 'object') {
    if (!check(pair.value, schema.additionalProperties, out, childPath(path, key))) ok = false;
  } else if (schema.additionalProperties === false) {
    const hint = suggest(key, known);
    ok = add(pair.key, unknownKeyMessage(key, hint, known), hint);
  }
  return ok;
}

function checkRequired(node: YAMLMap, schema: Schema, path: string, known: string[], seen: Set<string>, add: AddIssue): boolean {
  const typos = new Set([...seen].filter((key) => !schema.properties?.[key]).map((key) => suggest(key, known)));
  let ok = true;
  for (const required of schema.required ?? []) {
    if (seen.has(required) || typos.has(required)) continue;
    const label = path === '' ? 'Missing' : `${path}: missing`;
    ok = add(node.items[0]?.key ?? node, `${label} required key "${required}"`);
  }
  return ok;
}

function checkArray(node: Node, schema: Schema, out: Issue[], path: string, add: AddIssue): boolean {
  if (!isSeq(node)) return add(node, `${path || 'document'}: expected a list, found ${typeName(node)}`);
  let ok = true;
  if (schema.minItems !== undefined && node.items.length < schema.minItems) ok = add(node, `${path || 'document'}: needs at least ${schema.minItems} item(s)`);
  if (schema.maxItems !== undefined && node.items.length > schema.maxItems) ok = add(node, `${path || 'document'}: at most ${schema.maxItems} items`);
  if (schema.items) {
    node.items.forEach((item, index) => {
      if (!check(item as Node, schema.items!, out, `${path}[${index}]`)) ok = false;
    });
  }
  return ok;
}

function checkString(node: Node, schema: Schema, value: unknown, path: string, add: AddIssue): boolean {
  if (!isScalar(node) || (typeof value !== 'string' && typeof value !== 'number')) {
    return add(node, `${path || 'document'}: expected text, found ${typeName(node)}`);
  }
  const text = String(value);
  if (schema.enum && !schema.enum.includes(text)) {
    const hint = suggest(text, schema.enum.map(String));
    const message = `${path || 'document'}: "${text}" is not one of ${schema.enum.join(', ')}` + (hint ? ` — did you mean "${hint}"?` : '');
    return add(node, message, hint);
  }
  if (schema.maxLength !== undefined && text.length > schema.maxLength) return add(node, `${path || 'document'}: longer than ${schema.maxLength} characters`);
  if (schema.pattern && !new RegExp(schema.pattern).test(text)) {
    const description = schema.description ? ` (${schema.description})` : '';
    return add(node, `${path || 'document'}: "${text}" is not valid here${description}`);
  }
  return true;
}

function checkNumber(node: Node, schema: Schema, value: unknown, path: string, add: AddIssue): boolean {
  if (!isScalar(node) || typeof value !== 'number') return add(node, `${path || 'document'}: expected a number, found ${typeName(node)}`);
  if (schema.minimum !== undefined && value < schema.minimum) return add(node, `${path || 'document'}: must be at least ${schema.minimum}`);
  if (schema.maximum !== undefined && value > schema.maximum) return add(node, `${path || 'document'}: must be at most ${schema.maximum}`);
  return true;
}

/** Resolve a parser message path like `events[2].flow` to a node range (falls back to the nearest parent). */
function locate(doc: ReturnType<typeof parseDocument>, path: (string | number)[]): Range {
  if (path.length === 0) return rangeOf(doc.contents);
  for (let length = path.length; length > 0; length--) {
    const range = locatePrefix(doc, path, length);
    if (range) return range;
  }
  return rangeOf(doc.contents);
}

function locatePrefix(doc: ReturnType<typeof parseDocument>, path: (string | number)[], length: number): Range | undefined {
  const prefix = path.slice(0, length);
  const node: unknown = doc.getIn(prefix, true);
  if (!node) return undefined;
  const pairRange = mappingValueRange(doc, path, prefix, length);
  return pairRange ?? rangeOf(node);
}

function mappingValueRange(
  doc: ReturnType<typeof parseDocument>,
  path: (string | number)[],
  prefix: (string | number)[],
  length: number,
): Range | undefined {
  if (length !== path.length) return undefined;
  const parent: unknown = length > 1 ? doc.getIn(prefix.slice(0, -1), true) : doc.contents;
  if (!isMap(parent)) return undefined;
  const key = String(prefix[length - 1]);
  const pair = parent.items.find((entry) => String((entry.key as { value?: unknown }).value) === key);
  return pair ? rangeOf(pair.value ?? pair.key) : undefined;
}

const PATH = /^([A-Za-z_][\w.]*(?:\[\d+\])?(?:\.[\w-]+(?:\[\d+\])?)*): /;
const toPath = (p: string): (string | number)[] => [...p.matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map((m) => (m[2] !== undefined ? Number(m[2]) : m[1]!));

export type Kind = 'diagram' | 'storyboard';

/** All problems in one definition: YAML syntax, schema (types, unknown keys), then cross-reference checks. */
export function lintSource(source: string, kind: Kind = detectKind(source)): Issue[] {
  if (source.trim() === '') return [];
  if (isTextSource(source)) return lintText(source);
  return lintYamlSource(source, kind);
}

function lintYamlSource(source: string, kind: Kind): Issue[] {
  const doc = parseDocument(source, { strict: true, prettyErrors: false });
  const syntaxIssues = yamlIssues(doc);
  if (syntaxIssues) return syntaxIssues;
  if (isMap(doc.contents) && doc.contents.has('src')) return lintEmbed(source, doc.contents);
  const issues: Issue[] = [];
  check(doc.contents, kind === 'storyboard' ? storySchema : diagramSchema, issues, '');
  if (issues.length) return issues.slice(0, 30);
  return lintParsedDocument(source, kind, doc);
}

function yamlIssues(doc: ReturnType<typeof parseDocument>): Issue[] | undefined {
  if (!doc.errors.length) return undefined;
  return doc.errors.slice(0, 5).map((error) => ({
    from: error.pos[0],
    to: Math.max(error.pos[1], error.pos[0] + 1),
    message: `YAML: ${error.message.split('\n')[0]}`,
    severity: 'error' as const,
  }));
}

function lintParsedDocument(source: string, kind: Kind, doc: ReturnType<typeof parseDocument>): Issue[] {
  const issues: Issue[] = [];
  try { kind === 'storyboard' ? parseStoryboard(source) : parseDiagram(source); }
  catch (e) {
    if (!(e instanceof DiagramError)) throw e;
    for (const p of e.problems.slice(0, 30)) {
      const m = PATH.exec(p);
      const [from, to] = m ? locate(doc, toPath(m[1]!)) : rangeOf(doc.contents);
      issues.push({ from, to, message: m ? p.slice(m[0].length) : p, severity: 'error' });
    }
  }
  if (!issues.length && kind === 'diagram') issues.push(...unusedWarnings(source));
  return issues;
}

/** Text-DSL problems, located by line. */
function lintText(source: string): Issue[] {
  const starts = lineStarts(source);
  try { parseText(source); return []; }
  catch (e) {
    if (!(e instanceof DiagramError)) throw e;
    return textIssues(source, starts, e);
  }
}

function lineStarts(source: string): number[] {
  const starts: number[] = [];
  let offset = 0;
  for (const line of source.split('\n')) {
    starts.push(offset);
    offset += line.length + 1;
  }
  return starts;
}

function textIssues(source: string, starts: number[], error: DiagramError): Issue[] {
  const located = error instanceof TextError ? error.located : error.problems.map((message) => ({ line: 1, message }));
  return located.map(({ line, message }) => {
    const from = starts[line - 1] ?? 0;
    const len = (source.slice(from).split('\n')[0] ?? '').length;
    return { from, to: from + Math.max(1, len), message, severity: 'error' as const };
  });
}

/** Hints that are not errors: nodes and flows nothing refers to. */
function unusedWarnings(source: string): Issue[] {
  const all = collectScalars(source, 'diagram');
  if (!all.some((s) => s.def === 'event')) return []; // no script: every node and flow is animated automatically
  const used = new Set(all.filter((s) => s.ref).map((s) => `${s.ref}:${s.value}`));
  return all.filter((s) => (s.def === 'node' || s.def === 'flow') && !used.has(`${s.def}:${s.value}`))
    .map((s) => ({ from: s.from, to: s.to, severity: 'warning' as const, message: `${s.def === 'node' ? 'Node' : 'Flow'} "${s.value}" is never used by any ${s.def === 'node' ? 'flow or event' : 'event'}.` }));
}

/** A block that embeds a file: only `src` and display options are allowed. */
function lintEmbed(source: string, top: import('yaml').YAMLMap): Issue[] {
  try { parseEmbed(source); return []; }
  catch (e) {
    if (!(e instanceof DiagramError)) throw e;
    return e.problems.map((p) => {
      const key = /^(\w+):/.exec(p)?.[1];
      const pair = top.items.find((x) => String((x.key as { value?: unknown }).value) === key);
      const [from, to] = rangeOf(pair?.value ?? pair?.key ?? top);
      return { from, to, severity: 'error' as const, message: key ? p.slice(key.length + 2) : p };
    });
  }
}

/** Range and path of the `src:` value in an embedding block, if any. */
export function srcOf(source: string): { path: string; from: number; to: number } | undefined {
  try {
    const doc = parseDocument(source, { prettyErrors: false });
    if (!isMap(doc.contents)) return undefined;
    const node = doc.contents.get('src', true) as Node | undefined;
    if (!isScalar(node) || typeof node.value !== 'string' || !node.range) return undefined;
    const [from, to] = rangeOf(node);
    return { path: node.value.trim(), from, to };
  } catch { return undefined; }
}
