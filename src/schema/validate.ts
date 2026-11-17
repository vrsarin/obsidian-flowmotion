import { plain } from '../core/str';
import { isMap, isScalar, isSeq, parseDocument, type Node, type Pair } from 'yaml';
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

const typeName = (n: unknown): string => isMap(n) ? 'a mapping' : isSeq(n) ? 'a list' : isScalar(n) ? (typeof n.value === 'string' ? 'text' : n.value === null ? 'empty' : typeof n.value) : 'unknown';

/** Validate a YAML node against the schema subset; reports problems at the offending node. */
function check(node: Node | null, schema: Schema, out: Issue[], path: string): boolean {
  const add = (n: unknown, message: string, fix?: string) => { const [from, to] = rangeOf(n); out.push({ from, to, message, severity: 'error', fix }); return false; };
  if (!node) return true;
  if (schema.anyOf) {
    const attempts = schema.anyOf.map((s) => { const sub: Issue[] = []; check(node, s, sub, path); return sub; });
    if (attempts.some((a) => a.length === 0)) return true;
    out.push(...(attempts.sort((a, b) => a.length - b.length)[0] ?? []));
    return false;
  }
  const v = isScalar(node) ? node.value : undefined;
  switch (schema.type) {
    case 'object': {
      if (!isMap(node)) return add(node, `${path || 'document'}: expected a mapping, found ${typeName(node)}`);
      const known = Object.keys(schema.properties ?? {});
      let ok = true;
      const seen = new Set<string>();
      for (const pair of node.items as Pair<Node, Node>[]) {
        const key = plain((pair.key as { value?: unknown })?.value ?? '');
        if (seen.has(key)) ok = add(pair.key, `${path || 'document'}: duplicate key "${key}"`);
        seen.add(key);
        const sub = schema.properties?.[key];
        if (sub) { if (!check(pair.value, sub, out, (path ? `${path}.${key}` : key))) ok = false; }
        else if (typeof schema.additionalProperties === 'object') { if (!check(pair.value, schema.additionalProperties, out, (path ? `${path}.${key}` : key))) ok = false; }
        else if (schema.additionalProperties === false) {
          const hint = suggest(key, known);
          ok = add(pair.key, `Unknown key "${key}"${hint ? ` — did you mean "${hint}"?` : known.length ? ` (allowed: ${known.join(', ')})` : ''}`, hint);
        }
      }
      const typos = new Set([...seen].filter((k) => !schema.properties?.[k]).map((k) => suggest(k, known)));
      for (const r of schema.required ?? []) if (!seen.has(r) && !typos.has(r)) ok = add(node.items[0]?.key ?? node, `${path === '' ? 'Missing' : path + ': missing'} required key "${r}"`);
      return ok;
    }
    case 'array': {
      if (!isSeq(node)) return add(node, `${path || 'document'}: expected a list, found ${typeName(node)}`);
      let ok = true;
      if (schema.minItems !== undefined && node.items.length < schema.minItems) ok = add(node, `${path || 'document'}: needs at least ${schema.minItems} item(s)`);
      if (schema.maxItems !== undefined && node.items.length > schema.maxItems) ok = add(node, `${path || 'document'}: at most ${schema.maxItems} items`);
      if (schema.items) node.items.forEach((it, i) => { if (!check(it as Node, schema.items!, out, `${path}[${i}]`)) ok = false; });
      return ok;
    }
    case 'string': {
      if (!isScalar(node) || (typeof v !== 'string' && typeof v !== 'number')) return add(node, `${path || 'document'}: expected text, found ${typeName(node)}`);
      const s = String(v);
      if (schema.enum && !schema.enum.includes(s)) {
        const hint = suggest(s, schema.enum.map(String));
        return add(node, `${path || 'document'}: "${s}" is not one of ${schema.enum.join(', ')}${hint ? ` — did you mean "${hint}"?` : ''}`, hint);
      }
      if (schema.maxLength !== undefined && s.length > schema.maxLength) return add(node, `${path || 'document'}: longer than ${schema.maxLength} characters`);
      if (schema.pattern && !new RegExp(schema.pattern).test(s)) return add(node, `${path || 'document'}: "${s}" is not valid here${schema.description ? ` (${schema.description})` : ''}`);
      return true;
    }
    case 'number': case 'integer': {
      if (!isScalar(node) || typeof v !== 'number') return add(node, `${path || 'document'}: expected a number, found ${typeName(node)}`);
      if (schema.minimum !== undefined && v < schema.minimum) return add(node, `${path || 'document'}: must be at least ${schema.minimum}`);
      if (schema.maximum !== undefined && v > schema.maximum) return add(node, `${path || 'document'}: must be at most ${schema.maximum}`);
      return true;
    }
    case 'boolean':
      return isScalar(node) && typeof v === 'boolean' ? true : add(node, `${path || 'document'}: use true or false`);
    default: return true;
  }
}

/** Resolve a parser message path like `events[2].flow` to a node range (falls back to the nearest parent). */
function locate(doc: ReturnType<typeof parseDocument>, path: (string | number)[]): Range {
  for (let n = path.length; n >= 0; n--) {
    const prefix = path.slice(0, n);
    if (n === 0) return rangeOf(doc.contents);
    const node: unknown = doc.getIn(prefix, true);
    if (node) {
      // Prefer the key for a mapping entry: it is the visible label.
      const parent: unknown = n > 1 ? doc.getIn(prefix.slice(0, -1), true) : doc.contents;
      if (isMap(parent)) { const pair = parent.items.find((p) => String((p.key as { value?: unknown }).value) === String(prefix[n - 1])); if (pair && n === path.length) return rangeOf(pair.value ?? pair.key); }
      return rangeOf(node);
    }
  }
  return [0, 1];
}

const PATH = /^([A-Za-z_][\w.]*(?:\[\d+\])?(?:\.[\w-]+(?:\[\d+\])?)*): /;
const toPath = (p: string): (string | number)[] => [...p.matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map((m) => (m[2] !== undefined ? Number(m[2]) : m[1]!));

export type Kind = 'diagram' | 'storyboard';

/** All problems in one definition: YAML syntax, schema (types, unknown keys), then cross-reference checks. */
export function lintSource(source: string, kind: Kind = detectKind(source)): Issue[] {
  if (source.trim() === '') return [];
  if (isTextSource(source)) return lintText(source);
  const doc = parseDocument(source, { strict: true, prettyErrors: false });
  if (doc.errors.length) return doc.errors.slice(0, 5).map((e) => ({ from: e.pos[0], to: Math.max(e.pos[1], e.pos[0] + 1), message: `YAML: ${e.message.split('\n')[0]}`, severity: 'error' as const }));
  const issues: Issue[] = [];
  if (isMap(doc.contents) && doc.contents.has('src')) return lintEmbed(source, doc.contents);
  check(doc.contents, kind === 'storyboard' ? storySchema : diagramSchema, issues, '');
  if (issues.length) return issues.slice(0, 30);
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
  const starts: number[] = [];
  source.split('\n').reduce((o, l) => (starts.push(o), o + l.length + 1), 0);
  try { parseText(source); return []; }
  catch (e) {
    if (!(e instanceof DiagramError)) throw e;
    const located = e instanceof TextError ? e.located : e.problems.map((message) => ({ line: 1, message }));
    return located.map(({ line, message }) => {
      const from = starts[line - 1] ?? 0;
      const len = (source.slice(from).split('\n')[0] ?? '').length;
      return { from, to: from + Math.max(1, len), message, severity: 'error' as const };
    });
  }
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
