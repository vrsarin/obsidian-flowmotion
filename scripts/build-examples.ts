import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildModel } from '../src/model';
import { animatedSvg, staticSvg, standaloneHtml } from '../src/export/html';

mkdirSync('out', { recursive: true });
const names = ['retain-poc', 'retain', 'recall', 'reflect', 'hindsight-retain'];
const runtime = readFileSync('dist/flowmotion-runtime.js', 'utf8');
const css = readFileSync('styles.css', 'utf8');
const models = [];
for (const n of names) {
  const m = await buildModel(readFileSync(`examples/${n}.yaml`, 'utf8'));
  models.push(m);
  writeFileSync(`out/${n}.animated.svg`, animatedSvg(m, 'light'));
  writeFileSync(`out/${n}.animated.dark.svg`, animatedSvg(m, 'dark'));
  writeFileSync(`out/${n}.static.svg`, staticSvg(m, 'light'));
}
writeFileSync('out/preview.html', standaloneHtml(models, runtime, css, 'FlowMotion preview'));
writeFileSync('out/hindsight.html', standaloneHtml([models[models.length - 1]!], runtime, css, 'Hindsight Retain'));
console.log('wrote out/: ' + names.join(', '));
