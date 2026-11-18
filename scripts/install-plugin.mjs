import { copyFileSync, mkdirSync } from 'node:fs';
const vault = process.argv[2];
if (!vault) { console.error('usage: npm run install-plugin -- "<path to vault>"'); process.exit(1); }
const dest = `${vault}/.obsidian/plugins/flowmotion`;
mkdirSync(dest, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) copyFileSync(`dist/plugin/${file}`, `${dest}/${file}`);
console.log(`Installed to ${dest}. Enable "FlowMotion" under Settings > Community plugins.`);
