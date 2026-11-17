import { build } from 'esbuild';
import { mkdirSync, copyFileSync, readFileSync } from 'node:fs';

// Monaco imports its stylesheets; turn each into a module that adds a <style> element when first loaded.
const monacoCss = {
  name: 'monaco-css',
  setup(b) {
    b.onLoad({ filter: /monaco-editor[\\/].*\.css$/ }, async (a) => {
      const result = await build({ entryPoints: [a.path], bundle: true, write: false, outfile: 'monaco.css', loader: { '.ttf': 'dataurl' }, logLevel: 'silent' });
      const css = result.outputFiles[0].text;
      return {
        contents: `const s=document.createElement('style');s.setAttribute('data-flowmotion-monaco','');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);`,
        loader: 'js',
      };
    });
  },
};

mkdirSync('dist/plugin', { recursive: true });
await build({
  entryPoints: ['src/obsidian/main.ts'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2020',
  external: ['obsidian', 'electron', 'http', 'https', 'zlib', 'fs', 'path', '@codemirror/state', '@codemirror/view'], outfile: 'dist/plugin/main.js', minify: true, plugins: [monacoCss], loader: { '.ttf': 'dataurl' }, logLevel: 'info',
  // elkjs optionally requires web-worker; the bundled build runs in-thread.
  define: { 'process.env.NODE_ENV': '"production"' },
});
await build({
  entryPoints: ['src/runtime/browser.ts'], bundle: true, format: 'iife', globalName: 'FlowMotion',
  platform: 'browser', target: 'es2020', outfile: 'dist/flowmotion-runtime.js', minify: true, logLevel: 'info',
});
copyFileSync('manifest.json', 'dist/plugin/manifest.json');
copyFileSync('styles.css', 'dist/plugin/styles.css');
