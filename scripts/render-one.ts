import { readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { buildModel } from '../src/model';
import { staticSvg } from '../src/export/html';
const [srcArg, dstArg, themeArg] = process.argv.slice(2);
if (!srcArg || !dstArg) { console.error('usage: render-one <src> <dst.svg> [light|dark]'); process.exit(1); }
const src = resolve(srcArg);
const dst = resolve(dstArg);
if (extname(dst).toLowerCase() !== '.svg') { console.error('Output must be an .svg file'); process.exit(1); }
const theme = themeArg === 'dark' ? 'dark' : 'light';
const m = await buildModel(readFileSync(src, 'utf8'));
writeFileSync(dst, staticSvg(m, theme));
console.log('ok', m.layout.width, m.layout.height);
