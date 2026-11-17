import { parse as parseYaml } from 'yaml';
import { DiagramError } from './types';
import { parseView, type View } from './view';

export interface Embed { src: string; view: View }

/**
 * A block whose body is `src: <path>` (plus optional display options) embeds a diagram stored in a file.
 * Returns undefined for ordinary inline definitions.
 */
export function parseEmbed(source: string): Embed | undefined {
  let raw: unknown;
  try { raw = parseYaml(source, { maxAliasCount: 20 }); } catch { return undefined; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !('src' in raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const problems: string[] = [];
  const bad = (m: string) => problems.push(m);
  const allowed = ['src', 'controls', 'controlsPosition', 'mode', 'height', 'width', 'header', 'footer', 'paper'];
  for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(`${k}: not allowed next to "src" (the diagram comes from the file); allowed: ${allowed.join(', ')}`);
  if (typeof o.src !== 'string' || !o.src.trim()) bad('src: a file path like ./diagram.yaml');
  else if (!/\.(ya?ml|json|flow|svg|drawio)$/i.test(o.src.trim())) bad('src: file must end in .flow, .drawio, .svg, .yaml, .yml or .json');
  const view = parseView(o, bad);
  if (problems.length) throw new DiagramError(problems);
  return { src: (o.src as string).trim(), view };
}

/**
 * Resolve `rel` against the note's folder (or the vault root if it starts with "/").
 * Returns undefined when the path would leave the vault.
 */
export function resolveVaultPath(noteDir: string, rel: string): string | undefined {
  const parts = (rel.startsWith('/') ? [] : noteDir.split('/').filter(Boolean));
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.pop()) return undefined; } else parts.push(seg);
  }
  return parts.length ? parts.join('/') : undefined;
}

/** Path of `to` as seen from the folder `fromDir` (what `src:` expects; "../" is allowed). */
export function relativePath(fromDir: string, to: string): string {
  const a = fromDir ? fromDir.split('/') : [], b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array<string>(a.length - i).fill('..'), ...b.slice(i)].join('/');
}
