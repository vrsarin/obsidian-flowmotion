import { renderSvg } from '../render/svg';
import { animatedSvg } from '../export/html';
import type { Model } from '../render/model';
import { snapshotObsidianTheme, type ThemeName } from '../render/theme';
import { Player } from './player';

let counter = 0;

export interface MountOptions {
  createEl?: ElementFactory;
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

type ElementFactory = <K extends keyof HTMLElementTagNameMap>(tag: K) => HTMLElementTagNameMap[K];

function button(create: ElementFactory, label: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = create('button');
  b.type = 'button'; b.className = 'fm-btn'; b.textContent = text;
  b.setAttribute('aria-label', label); b.title = label;
  b.addEventListener('click', onClick);
  return b;
}

/** Reveal lays slides out in a fixed pixel box and scales it, so viewport units (vh) are wrong there:
 *  fit the diagram to a share of the slide box instead, leaving room for a title or text around it. */
function slideFitHeight(container: HTMLElement, win: Window & typeof globalThis, svg: SVGSVGElement, hv: string | undefined): string {
  const box = container.closest<HTMLElement>('.slides');
  const slideH = box ? Number.parseFloat(win.getComputedStyle(box).height) : Number.NaN;
  const full = Number.isFinite(slideH) && slideH > 0 ? slideH : 700;
  let want = Infinity;
  if (hv && /^[\d.]+vh$/.test(hv)) want = (Number.parseFloat(hv) / 100) * full;
  else if (hv && /^[\d.]+px$/.test(hv)) want = Number.parseFloat(hv);
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
}

function backgroundSelect(create: ElementFactory, opts: MountOptions): HTMLSelectElement {
  const sel = create('select');
  sel.className = 'fm-speed fm-mode'; sel.setAttribute('aria-label', 'Drawing background');
  for (const [v, l] of [['default', 'Background: default'], ['light', 'Background: light'], ['dark', 'Background: dark'], ['none', 'Background: none (match theme)']] as const) {
    const o = create('option'); o.value = v; o.textContent = l; sel.appendChild(o);
  }
  sel.value = ['light', 'dark', 'none'].includes(opts.paperChoice ?? '') ? opts.paperChoice! : 'default';
  sel.addEventListener('change', () => opts.onPaper!(sel.value));
  return sel;
}

/** In slides the bar floats over the diagram (it fades in on hover) and is drawn at screen size:
 *  Reveal scales the whole slide, which would otherwise make the controls huge. Returns a cleanup. */
function unscaleBarInSlide(win: Window & typeof globalThis, wrap: HTMLElement, bar: HTMLElement, refit: () => void): () => void {
  wrap.classList.add('fm-in-slide');
  const fix = () => {
    const s = wrap.offsetWidth ? wrap.getBoundingClientRect().width / wrap.offsetWidth : 1;
    const k = Number.isFinite(s) && s > 0 ? s : 1;
    bar.classList.add('fm-bar-scaled');
    bar.style.transform = `scale(${1 / k})`;
    bar.style.width = `${k * 100}%`;
  };
  fix();
  win.setTimeout(refit, 400); // after fonts and the slide layout settle
  win.addEventListener('resize', fix); win.addEventListener('resize', refit);
  const ResizeObserverCtor = win.ResizeObserver;
  const ro = typeof ResizeObserverCtor === 'function' ? new ResizeObserverCtor(fix) : undefined;
  ro?.observe(wrap);
  return () => { win.removeEventListener('resize', fix); win.removeEventListener('resize', refit); ro?.disconnect(); };
}

/** Pause when offscreen; resume only if it was playing before. Returns the observer, if the browser has one. */
function pauseWhenHidden(win: Window & typeof globalThis, wrap: HTMLElement, player: () => Player, refit: () => void): IntersectionObserver | undefined {
  let resumeOnVisible = false;
  const IntersectionObserverCtor = win.IntersectionObserver;
  if (typeof IntersectionObserverCtor !== 'function') return undefined;
  const io = new IntersectionObserverCtor((entries) => {
    const visible = entries.some((e) => e.isIntersecting);
    const p = player();
    if (!visible && p.playing) { resumeOnVisible = true; p.pause(); }
    else if (visible && resumeOnVisible) { resumeOnVisible = false; p.play(); }
    if (visible) refit();
  });
  io.observe(wrap);
  return io;
}

function screenMode(container: HTMLElement, wrap: HTMLElement, svg: SVGSVGElement, create: ElementFactory, model: Model, opts: MountOptions) {
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;
  const hv = opts.height ?? model.view?.height;
  type Mode = 'fit' | 'normal' | 'full';
  const inSlides = !!container.closest('.reveal'); // Obsidian Slides / Reveal.js: Normal may not fit a slide
  let mode = (inSlides ? 'fit' : model.view?.mode ?? 'fit') as Mode;
  const modeSel = create('select');
  modeSel.className = 'fm-speed fm-mode'; modeSel.setAttribute('aria-label', 'Screen mode');
  for (const [v, l] of [['fit', 'Fit'], ['normal', 'Normal'], ['full', 'Full screen']] as const) {
    if (inSlides && v === 'normal') continue;
    const o = create('option'); o.value = v; o.textContent = l; modeSel.appendChild(o);
  }
  const fitHeight = (): string | undefined => (inSlides ? slideFitHeight(container, win, svg, hv) : hv);
  const applyMode = (mm: Mode) => {
    mode = mm; modeSel.value = mm;
    svg.style.setProperty('--fm-diagram-max-height', mm === 'normal' ? 'none' : (fitHeight() ?? '75vh'));
    svg.style.setProperty('--fm-diagram-width', mm === 'normal' ? 'auto' : '100%');
  };
  modeSel.addEventListener('change', () => {
    const want = modeSel.value as Mode;
    if (want === 'full') {
      if (!wrap.requestFullscreen) { modeSel.value = mode; return; }
      wrap.requestFullscreen().catch(() => { modeSel.value = mode; });
    } else {
      if (doc.fullscreenElement === wrap) void doc.exitFullscreen();
      applyMode(want);
    }
  });
  let before: Mode = mode === 'full' ? 'fit' : mode;
  const onFs = () => {
    if (doc.fullscreenElement === wrap) {
      if (mode !== 'full') before = mode;
      mode = 'full';
      modeSel.value = 'full';
    } else if (mode === 'full') {
      applyMode(before);
    }
  };
  doc.addEventListener('fullscreenchange', onFs);
  applyMode(mode);
  return {
    select: modeSel, inSlides,
    refit: () => { if (inSlides && mode === 'fit') applyMode('fit'); },
    destroy: () => doc.removeEventListener('fullscreenchange', onFs),
  };
}

function exportButton(create: ElementFactory, wrap: HTMLElement, model: Model, opts: MountOptions): HTMLButtonElement {
  const win = wrap.ownerDocument.defaultView ?? window;
  const exportError = create('div');
  exportError.className = 'fm-error';
  exportError.hidden = true;
  exportError.setAttribute('role', 'alert');
  wrap.appendChild(exportError);
  return button(create, 'Export animated SVG', 'SVG ↓', () => {
    exportError.hidden = true;
    try {
      const theme = opts.theme === 'light' || opts.theme === 'dark' ? opts.theme : snapshotObsidianTheme(wrap);
      const blob = new Blob([animatedSvg(model, theme)], { type: 'image/svg+xml' });
      const url = win.URL.createObjectURL(blob);
      let link: HTMLAnchorElement | undefined;
      try {
        link = create('a');
        link.href = url;
        link.download = `${model.id.replace(/[^A-Za-z0-9_-]/g, '-')}.svg`;
        link.click();
      } finally {
        link?.remove();
        win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      console.error('FlowMotion: SVG export failed', error);
      exportError.textContent = `SVG export failed: ${error instanceof Error ? error.message : String(error)}`;
      exportError.hidden = false;
    }
  });
}

function playbackControls(create: ElementFactory, svg: SVGSVGElement, model: Model, opts: MountOptions, reduced: boolean) {
  const interactive = model.view?.interactive === true;
  let player: Player;
  const pb = create('div'); // playback controls, toggled by the button below
  pb.className = 'fm-pb';
  const playBtn = button(create, 'Play', '▶', () => player.toggle());
  const nextBtn = button(create, 'Play next beat', 'Next ▶', () => player.playNext(reduced));
  if (interactive) playBtn.remove(); else nextBtn.remove();
  const scrub = create('input');
  scrub.type = 'range'; scrub.className = 'fm-scrub'; scrub.min = '0'; scrub.value = '0';
  scrub.setAttribute('aria-label', 'Timeline');
  scrub.addEventListener('input', () => { player.pause(); player.seek(Number(scrub.value)); });
  const time = create('span');
  time.className = 'fm-time';
  const speed = create('select');
  speed.className = 'fm-speed'; speed.setAttribute('aria-label', 'Speed');
  const sync = () => {
    playBtn.textContent = player.playing ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
    nextBtn.disabled = player.playing || player.t >= player.total;
    scrub.value = String(Math.round(player.t));
    time.textContent = `${(player.t / 1000).toFixed(1)}s`;
  };
  player = new Player(svg, model, { speed: opts.speed, loop: opts.loop, onUpdate: sync });
  scrub.max = String(Math.round(player.total));
  for (const s of [0.25, 0.5, 1, 2, 4]) {
    const o = create('option'); o.value = String(s); o.textContent = `${s}×`;
    if (s === player.speed) o.selected = true;
    speed.appendChild(o);
  }
  speed.addEventListener('change', () => player.setSpeed(Number(speed.value)));
  pb.append(
    ...(interactive ? [] : [playBtn]),
    button(create, 'Step back', '⏮', () => player.stepBack()),
    button(create, 'Step forward', '⏭', () => player.stepForward()),
    button(create, 'Reset', '⏹', () => player.reset()),
    ...(interactive ? [] : [button(create, 'Replay', '↻', () => player.replay())]),
    scrub, time, speed,
  );
  const toggle = button(create, 'Show playback controls', '⚙', () => setControls(pb.hidden));
  const setControls = (on: boolean) => {
    pb.hidden = !on;
    toggle.setAttribute('aria-pressed', String(on));
    toggle.setAttribute('aria-label', on ? 'Hide playback controls' : 'Show playback controls');
    toggle.title = toggle.getAttribute('aria-label')!;
  };
  setControls(opts.controls === true);
  if (!interactive) {
    svg.classList.add('fm-clickable');
    svg.addEventListener('click', () => player.toggle()); // click the diagram to pause/play
  }
  return { player, pb, toggle, nextBtn, sync };
}

function modelSvg(container: HTMLElement, create: ElementFactory, model: Model, opts: MountOptions) {
  const doc = container.ownerDocument;
  const prefix = `fm${++counter}`;
  const wrap = create('div');
  wrap.className = 'fm-wrap';
  // Parse as XML and import the nodes: no HTML parsing and no innerHTML.
  const theme = opts.theme ?? 'obsidian';
  const parsed = new DOMParser().parseFromString(renderSvg(model, { idPrefix: prefix, theme, transparent: theme === 'obsidian' }), 'image/svg+xml');
  if (parsed.getElementsByTagName('parsererror').length) throw new Error('FlowMotion: the diagram produced invalid SVG');
  wrap.replaceChildren(doc.importNode(parsed.documentElement, true));
  const svg = wrap.querySelector('svg') as SVGSVGElement;
  if (model.backdrop && model.view?.paper === 'none') svg.classList.add(doc.body.classList.contains('theme-dark') ? 'fm-paper-dark' : 'fm-paper-light');
  container.appendChild(wrap);
  if (model.view?.width) { wrap.style.setProperty('--fm-wrap-width', model.view.width); wrap.classList.add('fm-capped'); }
  return { wrap, svg };
}

/** Render a model into `container`, attach the player and controls. Call destroy() to release everything. */
export function mountModel(container: HTMLElement, model: Model, opts: MountOptions = {}): Mounted {
  const win = container.ownerDocument.defaultView ?? window;
  // Obsidian factories may attach elements immediately; unused controls must be removed.
  const create: ElementFactory = opts.createEl ?? ((tag) => container.createEl(tag));
  const { wrap, svg } = modelSvg(container, create, model, opts);
  const screen = screenMode(container, wrap, svg, create, model, opts);
  const { inSlides, refit } = screen;
  const reduced = typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const interactive = model.view?.interactive === true;
  const bar = create('div');
  bar.className = 'fm-controls';
  const { player, pb, toggle, nextBtn, sync } = playbackControls(create, svg, model, opts, reduced);
  const exportBtn = exportButton(create, wrap, model, opts);
  // The toggle and screen mode are always visible, including in full screen.
  const parts: HTMLElement[] = [...(interactive ? [nextBtn] : []), pb, toggle, exportBtn, screen.select];
  if (model.backdrop && opts.onPaper) {
    parts.push(backgroundSelect(create, opts));
  }
  bar.append(...parts);
  if ((model.view?.controlsPosition ?? 'top') === 'top') svg.before(bar);
  else wrap.appendChild(bar);
  bar.classList.add(model.view?.controlsPosition === 'bottom' ? 'fm-bar-bottom' : 'fm-bar-top');
  sync();

  const unscale = inSlides ? unscaleBarInSlide(win, wrap, bar, refit) : undefined;
  const io = pauseWhenHidden(win, wrap, () => player, refit);

  if (!interactive && reduced) player.seek(player.total); // reduced motion: show the finished state, no autoplay
  else if (!interactive && (opts.autoplay ?? model.animation.autoplay)) player.play();
  sync();

  return { player, destroy() { unscale?.(); screen.destroy(); io?.disconnect(); player.destroy(); wrap.remove(); } };
}
