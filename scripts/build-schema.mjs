import { mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

// Bundle the TS schema modules, then emit plain JSON for editors (VS Code yaml-language-server etc.).
const out = 'dist/.schema-build.mjs';
await build({ entryPoints: ['src/schema/schemas.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { diagramSchema, storySchema } = await import(`../${out}`);
mkdirSync('schema', { recursive: true });
writeFileSync('schema/diagram.schema.json', JSON.stringify(diagramSchema, null, 2) + '\n');
writeFileSync('schema/storyboard.schema.json', JSON.stringify(storySchema, null, 2) + '\n');
console.log('wrote schema/diagram.schema.json, schema/storyboard.schema.json');
