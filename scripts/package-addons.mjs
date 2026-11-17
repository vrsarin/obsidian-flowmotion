// Packages the optional add-ons (draw.io editor + code editor) into dist/addons/flowmotion-addons.zip.
// Upload the zip to the GitHub release. Users unzip it into their plugin folder to turn the features on.
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const src = 'dist/plugin', out = 'dist/addons/flowmotion-addons', zip = 'dist/addons/flowmotion-addons.zip';
for (const f of ['drawio', 'monaco.js']) {
  if (!existsSync(`${src}/${f}`)) throw new Error(`Missing ${src}/${f}. Run "npm run build" (and "npm run fetch-drawio" for draw.io) first.`);
}
rmSync(out, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(out, { recursive: true });
cpSync(`${src}/drawio`, `${out}/drawio`, { recursive: true });
cpSync(`${src}/monaco.js`, `${out}/monaco.js`);
writeFileSync(`${out}/README.txt`, 'FlowMotion optional add-ons.\n\nCopy everything in this folder into your FlowMotion plugin folder:\n  <vault>/.obsidian/plugins/flowmotion/\nThen turn on the draw.io editor and/or code editor in FlowMotion settings.\n');
execFileSync('zip', ['-qr', `${process.cwd()}/${zip}`, '.'], { cwd: out });
console.log(`Packaged ${zip}`);
