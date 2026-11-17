import { renderSvg } from '../render/svg';
import type { Model } from '../render/model';
import type { ThemeName } from '../render/theme';
import { Player } from './player';

let counter = 0;

export interface MountOptions {
  theme?: ThemeName;
  controls?: boolean;
  /** CSS max-height for the diagram, e.g. "60vh". */
  height?: string;
  autoplay?: boolean;
  speed?: number;
  loop?: boolean;
  /** draw.io drawings: called when the viewer picks a background from the bar (value is 'default' to clear it). */
  /** The background written in the file or block, if any (shown selected in the bar). */
  paperChoice?: string;
  onPaper?: (value: string) => void;
}
export interface Mounted { player: Player; destroy(): void }

function button(label: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = createEl('button');
  b.type = 'button'; b.className = 'fm-btn'; b.textContent = text;
  b.setAttribute('aria-label', label); b.title = label;
  b.addEventListener('click', onClick);
  return b;
}

/** Render a model into `container`, attach the player and controls. Call destroy() to release everything. */
export function mountModel(container: HTMLElement, model: Model, opts: MountOptions = {}): Mounted {
  const prefix = `fm${++counter}`;
  const wrap = createDiv();
  wrap.className = 'fm-wrap';
  // Parse as XML and import the nodes: no HTML parsing and no innerHTML. renderSvg output is well-formed XML.
  const parsed = new DOMParser().parseFromString(renderSvg(model, { idPrefix: prefix, theme: opts.theme ?? 'obsidian', transparent: (opts.theme ?? 'obsidian') === 'obsidian' }), 'image/svg+xml');
  if (parsed.getElementsByTagName('parsererror').length) throw new Error('FlowMotion: the diagram produced invalid SVG');
  wrap.replaceChildren(activeDocument.importNode(parsed.documentElement, true));
  const svg = wrap.querySelector('svg') as SVGSVGElement;
  if (model.backdrop && model.view?.paper === 'none') svg.style.colorScheme = activeDocument.body.classList.contains('theme-dark') ? 'dark' : 'light'; // no sheet: draw.io colours follow Obsidian
  container.appendChild(wrap);
  if (model.view?.width) { wrap.style.width = model.view.width; wrap.classList.add('fm-capped'); }
  const hv = opts.height ?? model.view?.height;
  type Mode = 'fit' | 'normal' | 'full';
  const inSlides = !!container.closest('.reveal'); // Obsidian Slides / Reveal.js: Normal may not fit a slide
  let mode = (inSlides ? 'fit' : model.view?.mode ?? 'fit') as Mode;
  const modeSel = createEl('select');
  modeSel.className = 'fm-speed fm-mode'; modeSel.setAttribute('aria-label', 'Screen mode');
  for (const [v, l] of [['fit', 'Fit'], ['normal', 'Normal'], ['full', 'Full screen']] as const) {
    if (inSlides && v === 'normal') continue;
    const o = createEl('option'); o.value = v; o.textContent = l; modeSel.appendChild(o);
  }
  // Reveal lays slides out in a fixed pixel box and scales it, so viewport units (vh) are wrong there:
  // fit the diagram to a share of the slide box instead, leaving room for a title or text around it.
  const fitHeight = (): string | undefined => {
    if (!inSlides) return hv;
    const box = container.closest<HTMLElement>('.slides');
    const slideH = box ? parseFloat(getComputedStyle(box).height) : NaN;
    const full = Number.isFinite(slideH) && slideH > 0 ? slideH : 700;
    const want = hv && /^[\d.]+vh$/.test(hv) ? (parseFloat(hv) / 100) * full : hv && /^[\d.]+px$/.test(hv) ? parseFloat(hv) : Infinity;
    // Give the diagram what the slide has left after its title and text; never less than a third, never more than 85%.
    const slide = container.closest<HTMLElement>('section');
    let room = full * 0.72;
    if (slide && slide.scrollHeight > 0) {
      svg.classList.add('fm-measure'); // collapses the diagram so its height is not counted
      const others = slide.scrollHeight; // everything on the slide except the diagram
      svg.classList.remove('fm-measure');
      room = full - others - 24;
    }
    return `${Math.round(Math.min(want, Math.max(full * 0.33, Math.min(room, full * 0.85))))}px`;
  };
  const applyMode = (mm: Mode) => {
    mode = mm; modeSel.value = mm;
    svg.style.maxHeight = mm === 'normal' ? 'none' : (fitHeight() ?? '');
    svg.style.width = mm === 'normal' ? 'auto' : '';
  };
  modeSel.addEventListener('change', () => {
    const want = modeSel.value as Mode;
    if (want === 'full') {
      if (!wrap.requestFullscreen) { modeSel.value = mode; return; }
      wrap.requestFullscreen().catch(() => { modeSel.value = mode; });
    } else {
      if (activeDocument.fullscreenElement === wrap) void activeDocument.exitFullscreen();
      applyMode(want);
    }
  });
  let before: Mode = mode === 'full' ? 'fit' : mode;
  const onFs = () => {
    if (activeDocument.fullscreenElement === wrap) { if (mode !== 'full') before = mode; mode = 'full'; modeSel.value = 'full'; svg.style.maxHeight = ''; svg.style.width = ''; }
    else if (mode === 'full') applyMode(before);
  };
  activeDocument.addEventListener('fullscreenchange', onFs);
  applyMode(mode);

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let playBtn: HTMLButtonElement | undefined, scrub: HTMLInputElement | undefined, time: HTMLElement | undefined;
  const sync = () => {
    if (playBtn) { playBtn.textContent = player.playing ? '⏸' : '▶'; playBtn.setAttribute('aria-label', player.playing ? 'Pause' : 'Play'); }
    if (scrub) scrub.value = String(Math.round(player.t));
    if (time) time.textContent = `${(player.t / 1000).toFixed(1)}s`;
  };
  const player = new Player(svg, model, { speed: opts.speed, loop: opts.loop, onUpdate: sync });

  const bar = createDiv();
  bar.className = 'fm-controls';
  const pb = createDiv(); // playback controls, toggled by the button below
  pb.className = 'fm-pb';
  playBtn = button('Play', '▶', () => player.toggle());
  scrub = createEl('input');
  scrub.type = 'range'; scrub.className = 'fm-scrub'; scrub.min = '0'; scrub.max = String(Math.round(player.total)); scrub.value = '0';
  scrub.setAttribute('aria-label', 'Timeline');
  scrub.addEventListener('input', () => { player.pause(); player.seek(Number(scrub.value)); });
  time = createSpan(); time.className = 'fm-time';
  const speed = createEl('select');
  speed.className = 'fm-speed'; speed.setAttribute('aria-label', 'Speed');
  for (const s of [0.25, 0.5, 1, 2, 4]) {
    const o = createEl('option'); o.value = String(s); o.textContent = `${s}×`;
    if (s === player.speed) o.selected = true;
    speed.appendChild(o);
  }
  speed.addEventListener('change', () => player.setSpeed(Number(speed.value)));
  pb.append(
    playBtn,
    button('Step back', '⏮', () => player.stepBack()),
    button('Step forward', '⏭', () => player.stepForward()),
    button('Reset', '⏹', () => player.reset()),
    button('Replay', '↻', () => player.replay()),
    scrub, time, speed,
  );
  const toggle = button('Show playback controls', '⚙', () => setControls(pb.hidden));
  const setControls = (on: boolean) => {
    pb.hidden = !on;
    toggle.setAttribute('aria-pressed', String(on));
    toggle.setAttribute('aria-label', on ? 'Hide playback controls' : 'Show playback controls');
    toggle.title = toggle.getAttribute('aria-label')!;
    toggle.style.opacity = on ? '1' : '0.7';
  };
  setControls(opts.controls === true);
  svg.classList.add('fm-clickable');
  svg.addEventListener('click', () => player.toggle()); // click the diagram to pause/play
  // The toggle and screen mode are always visible, including in full screen.
  const parts: HTMLElement[] = [pb, toggle, modeSel];
  if (model.backdrop && opts.onPaper) {
    const sel = createEl('select');
    sel.className = 'fm-speed fm-mode'; sel.setAttribute('aria-label', 'Drawing background');
    for (const [v, l] of [['default', 'Background: default'], ['light', 'Background: light'], ['dark', 'Background: dark'], ['none', 'Background: none (match theme)']] as const) {
      const o = createEl('option'); o.value = v; o.textContent = l; sel.appendChild(o);
    }
    sel.value = ['light', 'dark', 'none'].includes(opts.paperChoice ?? '') ? opts.paperChoice! : 'default';
    sel.addEventListener('change', () => opts.onPaper!(sel.value));
    parts.push(sel);
  }
  bar.append(...parts);
  if ((model.view?.controlsPosition ?? 'top') === 'top') wrap.insertBefore(bar, svg); else wrap.appendChild(bar);
  bar.classList.add(model.view?.controlsPosition === 'bottom' ? 'fm-bar-bottom' : 'fm-bar-top');
  sync();

  // In slides the bar floats over the diagram (it fades in on hover) and is drawn at screen size:
  // Reveal scales the whole slide, which would otherwise make the controls huge.
  let unscale: (() => void) | undefined;
  if (inSlides) {
    wrap.classList.add('fm-in-slide');
    const fix = () => {
      const s = wrap.offsetWidth ? wrap.getBoundingClientRect().width / wrap.offsetWidth : 1;
      const k = Number.isFinite(s) && s > 0 ? s : 1;
      bar.classList.add('fm-bar-scaled');
      bar.style.transform = `scale(${1 / k})`;
      bar.style.width = `${k * 100}%`;
    };
    fix();
    const refit = () => { if (mode === 'fit') applyMode('fit'); };
    window.setTimeout(refit, 400); // after fonts and the slide layout settle
    window.addEventListener('resize', fix); window.addEventListener('resize', refit);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fix) : undefined;
    ro?.observe(wrap);
    unscale = () => { window.removeEventListener('resize', fix); window.removeEventListener('resize', refit); ro?.disconnect(); };
  }

  // Pause when offscreen; resume only if it was playing before.
  let resumeOnVisible = false;
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (!visible && player.playing) { resumeOnVisible = true; player.pause(); }
        else if (visible && resumeOnVisible) { resumeOnVisible = false; player.play(); }
        if (visible && inSlides && mode === 'fit') applyMode('fit');
      })
    : undefined;
  io?.observe(wrap);

  if (reduced) player.seek(player.total); // reduced motion: show the finished state, no autoplay
  else if (opts.autoplay ?? model.animation.autoplay) player.play();
  sync();

  return { player, destroy() { unscale?.(); activeDocument.removeEventListener("fullscreenchange", onFs); io?.disconnect(); player.destroy(); wrap.remove(); } };
}
