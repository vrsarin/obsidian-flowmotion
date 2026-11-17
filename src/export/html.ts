import { renderSvg } from '../render/svg';
import type { Model } from '../render/model';
import type { ThemeName } from '../render/theme';

export function animatedSvg(m: Model, theme: 'light' | 'dark' = 'light'): string {
  return renderSvg(m, { idPrefix: `fm-${m.id}`.replace(/[^A-Za-z0-9_-]/g, '-'), theme, smil: true });
}
/** One still frame. Defaults to the idle state (before anything runs), which reads as a plain diagram. */
export function staticSvg(m: Model, theme: 'light' | 'dark' = 'light', at = -1): string {
  return renderSvg(m, { idPrefix: `fm-${m.id}`.replace(/[^A-Za-z0-9_-]/g, '-'), theme, at });
}

/** Self-contained HTML: pre-laid-out model + runtime bundle + CSS. No network, no ELK. */
export function standaloneHtml(models: Model[], runtimeJs: string, css: string, title = 'FlowMotion', theme: ThemeName = 'light'): string {
  const json = JSON.stringify(models).replace(/</g, '\\u003c');
  const sections = models.map((m, i) => `<section><h2>${m.id}</h2><div class="fm-slot" data-i="${i}"></div></section>`).join('');
  const dark = theme === 'dark';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>${css}
body{margin:0;padding:24px;font-family:system-ui,sans-serif;background:${dark ? '#14181f' : '#fff'};color:${dark ? '#e6ebf2' : '#1f2933'}}
section{max-width:1100px;margin:0 auto 40px}h2{font-size:16px;text-transform:capitalize}
</style></head><body>${sections}
<noscript>This page needs JavaScript for playback; the exported .svg files animate without it.</noscript>
<script>${runtimeJs}</script>
<script>
var models=${json},params=new URLSearchParams(location.search);
document.querySelectorAll('.fm-slot').forEach(function(el){
  var m=FlowMotion.mountModel(el,models[el.dataset.i],{theme:${JSON.stringify(theme === 'obsidian' ? 'light' : theme)},autoplay:params.get('t')===null});
  if(params.get('t')!==null){m.player.seek(Number(params.get('t')));}
});
</script></body></html>`;
}
