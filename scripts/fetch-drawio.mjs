// Copies the draw.io editor (Apache-2.0, github.com/jgraph/drawio) into dist/plugin/drawio so the plugin works offline.
// Usage: npm run fetch-drawio [-- --update]. Needs git and network once; later runs reuse .cache/drawio.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const cache = '.cache/drawio', web = `${cache}/src/main/webapp`, out = 'dist/plugin/drawio';
const git = (...a) => execFileSync('git', a, { stdio: 'inherit' });
if (process.argv.includes('--update') && existsSync(cache)) rmSync(cache, { recursive: true, force: true });
if (!existsSync(web)) {
  mkdirSync('.cache', { recursive: true });
  git('clone', '--depth', '1', '--filter=blob:none', '--sparse', 'https://github.com/jgraph/drawio.git', cache);
  git('-C', cache, 'sparse-checkout', 'set', 'src/main/webapp');
}
const commit = execFileSync('git', ['-C', cache, 'rev-parse', '--short', 'HEAD']).toString().trim();

// Only what the embedded editor loads (see js/bootstrap.js). Cloud integrations, viewers, templates and sources stay out.
const keep = ['index.html', 'favicon.ico', 'styles', 'images', 'img', 'shapes', 'stencils', 'plugins',
  'js/bootstrap.js', 'js/main.js', 'js/PreConfig.js', 'js/PostConfig.js', 'js/app.min.js', 'js/extensions.min.js', 'js/stencils.min.js', 'js/orgchart.min.js'];
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/js`, { recursive: true });
for (const k of keep) if (existsSync(`${web}/${k}`)) cpSync(`${web}/${k}`, `${out}/${k}`, { recursive: true });
for (const f of readFileSync(`${web}/js/bootstrap.js`, 'utf8').match(/shapes-[\w.-]+\.min\.js/g) ?? []) cpSync(`${web}/js/${f}`, `${out}/js/${f}`);
// Languages: English only.
for (const f of ['dia.txt', 'dia_en.txt']) if (existsSync(`${web}/resources/${f}`)) cpSync(`${web}/resources/${f}`, `${out}/resources/${f}`);
cpSync(`${cache}/LICENSE`, `${out}/LICENSE`);
writeFileSync(`${out}/VERSION`, `draw.io ${commit}\n`);
console.log(`draw.io ${commit} -> ${out}`);
