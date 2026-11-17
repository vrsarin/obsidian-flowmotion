import { build } from 'esbuild';
import { mkdirSync, copyFileSync } from 'node:fs';

mkdirSync('dist/plugin', { recursive: true });
await build({
  entryPoints: ['src/obsidian/main.ts'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2020',
  external: ['obsidian', 'electron', 'http', 'fs', 'path', '@codemirror/state', '@codemirror/view'], outfile: 'dist/plugin/main.js', minify: true, logLevel: 'info',
  // elkjs optionally requires web-worker; the bundled build runs in-thread.
  define: { 'process.env.NODE_ENV': '"production"' },
});
await build({
  entryPoints: ['src/runtime/browser.ts'], bundle: true, format: 'iife', globalName: 'FlowMotion',
  platform: 'browser', target: 'es2020', outfile: 'dist/flowmotion-runtime.js', minify: true, logLevel: 'info',
});
copyFileSync('manifest.json', 'dist/plugin/manifest.json');
copyFileSync('styles.css', 'dist/plugin/styles.css');
