import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

// CommonJS: loaded with Node require from the plugin folder. Monaco is large, so it ships as its own file and the plugin loads it only while an editor is open.
// Its CSS is embedded in the same file: a footer adds a <style> element when the file loads and keeps it on module.exports for removal.
mkdirSync('dist/plugin', { recursive: true });
rmSync('dist/plugin/monaco.css', { force: true }); // older builds wrote the CSS as a separate file
const result = await build({
  entryPoints: ['src/monaco/entry.ts'], bundle: true, format: 'cjs', platform: 'browser', target: 'es2020',
  outfile: 'dist/plugin/monaco.js', minify: true, logLevel: 'info', loader: { '.ttf': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' }, write: false,
});
const js = result.outputFiles.find((f) => f.path.endsWith('.js'));
const css = result.outputFiles.find((f) => f.path.endsWith('.css'));
if (!js) throw new Error('monaco build produced no JavaScript');
let text = js.text;
if (css) {
  text += `\n;(function(){var s=document.createElement("style");s.setAttribute("data-flowmotion-monaco","");s.textContent=${JSON.stringify(css.text)};document.head.appendChild(s);module.exports.__fmStyle=s;})();\n`;
}
writeFileSync('dist/plugin/monaco.js', text);
console.log(`monaco.js: ${(text.length / 1024).toFixed(0)} KB${css ? ' (CSS embedded)' : ' (no CSS output)'}`);
