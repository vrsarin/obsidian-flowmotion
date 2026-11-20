import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
const arg = process.argv[2];
if (!arg) { console.error('usage: npm run install-plugin -- "<path to vault>"'); process.exit(1); }
const vault = resolve(arg);
if (!statSync(join(vault, '.obsidian'), { throwIfNoEntry: false })?.isDirectory()) { console.error(`Not an Obsidian vault (no .obsidian folder): ${vault}`); process.exit(1); }
const dest = join(vault, '.obsidian', 'plugins', 'flowmotion');
mkdirSync(dest, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(join('dist', 'plugin', file), join(dest, file));
console.log(`Installed to ${dest}. Enable "FlowMotion" under Settings > Community plugins.`);
