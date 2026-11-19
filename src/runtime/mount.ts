import { renderSvg } from '../render/svg';
import type { Model } from '../render/model';
import type { ThemeName } from '../render/theme';
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

/** Render a model into `container`, attach the player and controls. Call destroy() to release everything. */
export function mountModel(container: HTMLElement, model: Model, opts: MountOptions = {}): Mounted {
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;
  // This runtime is only used inside Obsidian, whose DOM helpers are available
  // on elements. Keep the optional factory for callers that need a specific
  // Obsidian context, and use the container's helper by default.
  const create: ElementFactory = opts.createEl ?? ((tag) => container.createEl(tag));
  const prefix = `fm${++counter}`;
  const wrap = create('div');
  wrap.className = 'fm-wrap';
  // Parse as XML and import the nodes: no HTML parsing and no innerHTML. renderSvg output is well-formed XML.
  const parsed = new DOMParser().parseFromString(renderSvg(model, { idPrefix: prefix, theme: opts.theme ?? 'obsidian', transparent: (opts.theme ?? 'obsidian') === 'obsidian' }), 'image/svg+xml');
  if (parsed.getElementsByTagName('parsererror').length) throw new Error('FlowMotion: the diagram produced invalid SVG');
  wrap.replaceChildren(doc.importNode(parsed.documentElement, true));
  const svg = wrap.querySelector('svg') as SVGSVGElement;
  if (model.backdrop && model.view?.paper === 'none') svg.classList.add(doc.body.classList.contains('theme-dark') ? 'fm-paper-dark' : 'fm-paper-light');
  container.appendChild(wrap);
  if (model.view?.width) { wrap.style.setProperty('--fm-wrap-width', model.view.width); wrap.classList.add('fm-capped'); }
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
  // Reveal lays slides out in a fixed pixel box and scales it, so viewport units (vh) are wrong there:
  // fit the diagram to a share of the slide box instead, leaving room for a title or text around it.
  const fitHeight = (): string | undefined => {
    if (!inSlides) return hv;
    const box = container.closest<HTMLElement>('.slides');
    const slideH = box ? parseFloat(win.getComputedStyle(box).height) : NaN;
    const full = Number.isFinite(slideH) && slideH > 0 ? slideH : 700;
    let want = Infinity;
    if (hv && /^[\d.]+vh$/.test(hv)) want = (parseFloat(hv) / 100) * full;
    else if (hv && /^[\d.]+px$/.test(hv)) want = parseFloat(hv);
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

  const reduced = typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let player: Player;
  const bar = create('div');
  bar.className = 'fm-controls';
  const pb = create('div'); // playback controls, toggled by the button below
  pb.className = 'fm-pb';
  const playBtn = button(create, 'Play', '▶', () => player.toggle());
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
    playBtn,
    button(create, 'Step back', '⏮', () => player.stepBack()),
    button(create, 'Step forward', '⏭', () => player.stepForward()),
    button(create, 'Reset', '⏹', () => player.reset()),
    button(create, 'Replay', '↻', () => player.replay()),
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
  svg.classList.add('fm-clickable');
  svg.addEventListener('click', () => player.toggle()); // click the diagram to pause/play
  // The toggle and screen mode are always visible, including in full screen.
  const parts: HTMLElement[] = [pb, toggle, modeSel];
  if (model.backdrop && opts.onPaper) {
    const sel = create('select');
    sel.className = 'fm-speed fm-mode'; sel.setAttribute('aria-label', 'Drawing background');
    for (const [v, l] of [['default', 'Background: default'], ['light', 'Background: light'], ['dark', 'Background: dark'], ['none', 'Background: none (match theme)']] as const) {
      const o = create('option'); o.value = v; o.textContent = l; sel.appendChild(o);
    }
    sel.value = ['light', 'dark', 'none'].includes(opts.paperChoice ?? '') ? opts.paperChoice! : 'default';
    sel.addEventListener('change', () => opts.onPaper!(sel.value));
    parts.push(sel);
  }
  bar.append(...parts);
  if ((model.view?.controlsPosition ?? 'top') === 'top') svg.before(bar);
  else wrap.appendChild(bar);
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
    win.setTimeout(refit, 400); // after fonts and the slide layout settle
    win.addEventListener('resize', fix); win.addEventListener('resize', refit);
    const ResizeObserverCtor = win.ResizeObserver;
    const ro = typeof ResizeObserverCtor === 'function' ? new ResizeObserverCtor(fix) : undefined;
    ro?.observe(wrap);
    unscale = () => { win.removeEventListener('resize', fix); win.removeEventListener('resize', refit); ro?.disconnect(); };
  }

  // Pause when offscreen; resume only if it was playing before.
  let resumeOnVisible = false;
  const IntersectionObserverCtor = win.IntersectionObserver;
  const io = typeof IntersectionObserverCtor === 'function'
    ? new IntersectionObserverCtor((entries) => {
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

  return { player, destroy() { unscale?.(); doc.removeEventListener("fullscreenchange", onFs); io?.disconnect(); player.destroy(); wrap.remove(); } };
}
