import { readFileSync, writeFileSync } from 'node:fs';
import { buildModel } from '../src/model';
import { staticSvg } from '../src/export/html';
const [src, dst, theme] = process.argv.slice(2);
const m = await buildModel(readFileSync(src!, 'utf8'));
writeFileSync(dst!, staticSvg(m, (theme as 'light' | 'dark') ?? 'light'));
console.log('ok', m.layout.width, m.layout.height);
