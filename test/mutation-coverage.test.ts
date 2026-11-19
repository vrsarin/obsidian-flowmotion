import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDiagram } from '../src/core/parse';
import { parseText } from '../src/text/parse';
import { DiagramError } from '../src/core/types';
import { lintSource } from '../src/schema';
import { formatSource } from '../src/schema/format';

// Robustness check: take every example diagram and damage it in simple ways (drop a line, cut it short,
// duplicate a line, break a line). The parsers must either accept the result or fail with a DiagramError,
// never crash with an unexpected exception. This also walks the parsers' many error paths.
const files = readdirSync('examples').map((f) => [f, readFileSync(`examples/${f}`, 'utf8')] as const);

const mutants = (text: string): string[] => {
  const lines = text.split('\n');
  const out: string[] = [];
  const stride = Math.max(1, Math.ceil(lines.length / 40));
  lines.forEach((l, i) => {
    if (i % stride) return;
    out.push([...lines.slice(0, i), ...lines.slice(i + 1)].join('\n'));
    out.push([...lines.slice(0, i), l.slice(0, Math.floor(l.length / 2)), ...lines.slice(i + 1)].join('\n'));
    out.push([...lines.slice(0, i + 1), l, ...lines.slice(i + 1)].join('\n'));
    out.push([...lines.slice(0, i), l.replace(/[\w]+/, '??'), ...lines.slice(i + 1)].join('\n'));
    out.push([...lines.slice(0, i), l.replace(/[:\-=>]+/, ' '), ...lines.slice(i + 1)].join('\n'));
    out.push([...lines.slice(0, i), l.replace(/[[\](){}"]/, ''), ...lines.slice(i + 1)].join('\n'));
    out.push([...lines.slice(0, i), l.replace(/\d+/, '-1'), ...lines.slice(i + 1)].join('\n'));
    out.push([...lines.slice(0, i), l.toUpperCase(), ...lines.slice(i + 1)].join('\n'));
    if (i + 1 < lines.length) out.push([...lines.slice(0, i), lines[i + 1]!, l, ...lines.slice(i + 2)].join('\n'));
    out.push([...lines.slice(0, i), `  ${l}`, ...lines.slice(i + 1)].join('\n'));
  });
  out.push(lines.slice(0, Math.ceil(lines.length / 2)).join('\n'));
  return out;
};

describe('damaged examples', () => {
  for (const [name, text] of files) {
    it(`${name}: parses or reports a diagram error`, async () => {
      for (const m of mutants(text)) {
        try {
          if (/\.(mmd|puml)$/.test(name)) parseText(m);
          else parseDiagram(m);
        } catch (e) { expect(e).toBeInstanceOf(DiagramError); }
        try { lintSource(m); formatSource(m); } catch (e) { expect(e).toBeInstanceOf(Error); }
      }
    }, 60000);
  }
});
