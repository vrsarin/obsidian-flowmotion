import { frameAt } from '../render/frame';
import type { Model } from '../render/model';

export interface PlayerOptions { loop?: boolean; speed?: number; onUpdate?: () => void }

/** Deterministic playback: all visuals are a pure function of one simulated clock `t`. */
export class Player {
  t = 0;
  playing = false;
  speed: number;
  loop: boolean;
  private raf = 0;
  private last = 0;
  private nodes = new Map<string, Element>();
  private bars = new Map<string, SVGRectElement>();
  private packets = new Map<string, SVGGElement>();
  private shows = new Map<string, Element>();
  private edges = new Map<string, Element>();
  private captions = new Map<string, Element>();

  constructor(private root: SVGSVGElement, public readonly model: Model, private opts: PlayerOptions = {}) {
    this.speed = opts.speed ?? model.animation.speed;
    this.loop = opts.loop ?? model.animation.loop;
    root.querySelectorAll('[data-node]').forEach((e) => this.nodes.set((e as HTMLElement).dataset.node!, e));
    root.querySelectorAll<SVGRectElement>('[data-bar]').forEach((e) => this.bars.set(e.dataset.bar!, e));
    root.querySelectorAll<SVGGElement>('[data-packet]').forEach((e) => this.packets.set(e.dataset.packet!, e));
    root.querySelectorAll('[data-show]').forEach((e) => this.shows.set((e as HTMLElement).dataset.show!, e));
    root.querySelectorAll('[data-edge]').forEach((e) => this.edges.set((e as HTMLElement).dataset.edge!, e));
    root.querySelectorAll('[data-caption]').forEach((e) => this.captions.set((e as HTMLElement).dataset.caption!, e));
    this.render();
  }

  get total() { return this.model.timeline.total; }

  play() {
    if (this.playing) return;
    if (this.t >= this.total) this.t = 0;
    this.playing = true;
    this.last = performance.now();
    this.raf = window.requestAnimationFrame(this.tick);
    this.opts.onUpdate?.();
  }
  pause() {
    if (!this.playing) return;
    this.playing = false;
    window.cancelAnimationFrame(this.raf);
    this.opts.onUpdate?.();
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  reset() { this.pause(); this.seek(0); }
  replay() { this.pause(); this.t = 0; this.play(); }
  setSpeed(s: number) { this.speed = s; this.opts.onUpdate?.(); }
  seek(t: number) { this.t = Math.min(this.total, Math.max(0, t)); this.render(); this.opts.onUpdate?.(); }

  stepForward() {
    this.pause();
    const b = this.model.timeline.boundaries.find((x) => x > this.t + 1e-6);
    this.seek(b ?? this.total);
  }
  stepBack() {
    this.pause();
    const prev = this.model.timeline.boundaries.filter((x) => x < this.t - 1e-6).pop();
    this.seek(prev ?? 0);
  }
  destroy() { this.playing = false; window.cancelAnimationFrame(this.raf); }

  private tick = (now: number) => {
    if (!this.playing) return;
    const dt = Math.min(100, now - this.last) * this.speed; // clamp: no big jumps after tab sleep
    this.last = now;
    this.t += dt;
    if (this.t >= this.total) {
      if (this.loop) this.t %= this.total;
      else { this.t = this.total; this.playing = false; }
    }
    this.render();
    this.opts.onUpdate?.();
    if (this.playing) this.raf = window.requestAnimationFrame(this.tick);
  };

  private render() {
    const f = frameAt(this.model, this.t);
    for (const [id, el] of this.nodes) el.setAttribute('data-state', f.nodes[id] ?? 'idle');
    for (const [id, el] of this.bars) {
      const p = f.bars[id];
      el.setAttribute('opacity', p === undefined ? '0' : '1');
      el.setAttribute('width', String(p === undefined ? 0 : Number(el.dataset.full) * p));
    }
    for (const [id, el] of this.packets) {
      const pos = f.packets[id];
      el.setAttribute('opacity', pos ? '1' : '0');
      if (pos) el.setAttribute('transform', `translate(${pos.x} ${pos.y})`);
    }
    for (const [id, el] of this.shows) el.setAttribute('opacity', String(f.shows[id] ?? 0));
    for (const [id, el] of this.edges) el.setAttribute('data-active', f.edges[id] ? 'true' : 'false');
    for (const [id, el] of this.captions) el.setAttribute('opacity', f.captions[id] ? '1' : '0');
  }
}
