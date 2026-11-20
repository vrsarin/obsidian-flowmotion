import { frameAt } from '../render/frame';
import { arrowPresentation, groupPresentation, nodePresentation, presentationOpacity, presentationVisibility } from '../render/presentation';
import { edgeMarkerRefs } from '../render/svg';
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
  private stopAt?: number;
  private readonly nodes = new Map<string, Element>();
  private readonly groups = new Map<string, Element>();
  private readonly bars = new Map<string, SVGRectElement>();
  private readonly packets = new Map<string, SVGGElement>();
  private readonly shows = new Map<string, Element>();
  private readonly edges = new Map<string, Element>();
  private readonly edgeWraps = new Map<string, Element>();
  private readonly edgeLabels = new Map<string, Element>();
  private readonly captions = new Map<string, Element>();

  constructor(private readonly root: SVGSVGElement, public readonly model: Model, private readonly opts: PlayerOptions = {}) {
    this.speed = opts.speed ?? model.animation.speed;
    this.loop = opts.loop ?? model.animation.loop;
    root.querySelectorAll('[data-node]').forEach((e) => this.nodes.set((e as HTMLElement).dataset.node!, e));
    root.querySelectorAll('[data-group]').forEach((e) => this.groups.set((e as HTMLElement).dataset.group!, e));
    root.querySelectorAll<SVGRectElement>('[data-bar]').forEach((e) => this.bars.set(e.dataset.bar!, e));
    root.querySelectorAll<SVGGElement>('[data-packet]').forEach((e) => this.packets.set(e.dataset.packet!, e));
    root.querySelectorAll('[data-show]').forEach((e) => this.shows.set((e as HTMLElement).dataset.show!, e));
    root.querySelectorAll('[data-edge]').forEach((e) => this.edges.set((e as HTMLElement).dataset.edge!, e));
    root.querySelectorAll('[data-edge-wrap]').forEach((e) => this.edgeWraps.set((e as HTMLElement).dataset.edgeWrap!, e));
    root.querySelectorAll('[data-edge-label]').forEach((e) => this.edgeLabels.set((e as HTMLElement).dataset.edgeLabel!, e));
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
  replay() { this.pause(); this.stopAt = undefined; this.t = 0; this.play(); }
  setSpeed(s: number) { this.speed = s; this.opts.onUpdate?.(); }
  seek(t: number) { this.stopAt = undefined; this.t = Math.min(this.total, Math.max(0, t)); this.render(); this.opts.onUpdate?.(); }

  playNext(instant = false) {
    if (this.playing || this.t >= this.total) return;
    const captions = this.model.timeline.items.filter((item) => item.type === 'caption' && !item.skipped);
    const boundaries = captions.length ? [...captions.map((item) => item.start), this.total] : this.model.timeline.boundaries;
    const target = boundaries.find((time) => time > this.t + 1e-6) ?? this.total;
    if (instant) this.seek(target);
    else { this.stopAt = target; this.play(); }
  }

  stepForward() {
    this.pause();
    const b = this.model.timeline.boundaries.find((x) => x > this.t + 1e-6);
    this.seek(b ?? this.total);
  }
  stepBack() {
    this.pause();
    const prev = this.model.timeline.boundaries.slice().reverse().find((x) => x < this.t - 1e-6);
    this.seek(prev ?? 0);
  }
  destroy() { this.playing = false; window.cancelAnimationFrame(this.raf); }

  private readonly tick = (now: number) => {
    if (!this.playing) return;
    const dt = Math.min(100, now - this.last) * this.speed; // clamp: no big jumps after tab sleep
    this.last = now;
    this.t += dt;
    if (this.stopAt !== undefined && this.t >= this.stopAt) {
      this.t = this.stopAt;
      this.stopAt = undefined;
      this.playing = false;
    } else if (this.t >= this.total) {
      if (this.loop) this.t %= this.total;
      else { this.t = this.total; this.playing = false; }
    }
    this.render();
    this.opts.onUpdate?.();
    if (this.playing) this.raf = window.requestAnimationFrame(this.tick);
  };

  private render() {
    const f = frameAt(this.model, this.t);
    this.renderNodes(f);
    this.renderGroups(f);
    this.renderBars(f);
    this.renderPackets(f);
    this.renderShows(f);
    this.renderEdges(f);
    this.renderEdgeLabels(f);
    this.renderCaptions(f);
  }

  private setPresentation(el: Element, settings: ReturnType<typeof nodePresentation>) {
    el.setAttribute('opacity', String(presentationOpacity(settings)));
    el.setAttribute('visibility', presentationVisibility(settings));
    const style = (el as SVGElement).style;
    if (settings.fill) style.setProperty('--fm-scene-fill', settings.fill); else style.removeProperty('--fm-scene-fill');
    if (settings.stroke) style.setProperty('--fm-scene-stroke', settings.stroke); else style.removeProperty('--fm-scene-stroke');
  }

  private renderNodes(f: ReturnType<typeof frameAt>) {
    for (const [id, el] of this.nodes) {
      (el as SVGElement).dataset.state = f.nodes[id] ?? 'idle';
      if (this.model.timeline.scenes) {
        this.setPresentation(el, nodePresentation(f.presentation, id));
      }
    }
  }

  private renderGroups(f: ReturnType<typeof frameAt>) {
    for (const [id, el] of this.groups) if (this.model.timeline.scenes) {
      this.setPresentation(el, groupPresentation(f.presentation, id));
    }
  }

  private renderBars(f: ReturnType<typeof frameAt>) {
    for (const [id, el] of this.bars) {
      const p = f.bars[id];
      el.setAttribute('opacity', p === undefined ? '0' : '1');
      el.setAttribute('width', String(p === undefined ? 0 : Number(el.dataset.full) * p));
    }
  }

  private renderPackets(f: ReturnType<typeof frameAt>) {
    for (const [id, el] of this.packets) {
      const pos = f.packets[id];
      el.setAttribute('opacity', pos ? '1' : '0');
      if (pos) el.setAttribute('transform', `translate(${pos.x} ${pos.y})`);
    }
  }

  private renderShows(f: ReturnType<typeof frameAt>) {
    for (const [id, el] of this.shows) {
      const node = (el as SVGElement).dataset.showNode;
      el.setAttribute('opacity', String((f.shows[id] ?? 0) * (node ? presentationOpacity(nodePresentation(f.presentation, node)) : 1)));
      if (node) el.setAttribute('visibility', presentationVisibility(nodePresentation(f.presentation, node)));
    }
  }

  private renderEdges(f: ReturnType<typeof frameAt>) {
    for (const [id, el] of this.edges) {
      (el as SVGElement).dataset.active = f.edges[id] ? 'true' : 'false';
      if (this.model.timeline.scenes) this.renderSceneEdge(id, el, f);
    }
  }

  private renderSceneEdge(id: string, el: Element, f: ReturnType<typeof frameAt>) {
    const settings = arrowPresentation(f.presentation, id);
    const edge = this.model.layout.edges.find((candidate) => candidate.id === id);
    if (!edge) return;
    const wrapper = this.edgeWraps.get(id);
    wrapper?.setAttribute('opacity', String(presentationOpacity(settings)));
    wrapper?.setAttribute('visibility', presentationVisibility(settings));
    const markers = edgeMarkerRefs(this.root.dataset.markerPrefix ?? '', edge, settings);
    this.setMarker(el, 'marker-end', markers.head);
    this.setMarker(el, 'marker-start', markers.tail);
    const color = settings.color ?? (!f.edges[id] ? edge.style?.stroke : undefined);
    this.setStroke(el, color);
  }

  private setMarker(el: Element, attribute: string, marker: string) {
    if (marker) el.setAttribute(attribute, marker);
    else el.removeAttribute(attribute);
  }

  private setStroke(el: Element, color?: string) {
    const style = (el as SVGElement).style;
    if (color) style.setProperty('stroke', color);
    else style.removeProperty('stroke');
  }

  private renderEdgeLabels(f: ReturnType<typeof frameAt>) {
    for (const [id, el] of this.edgeLabels) {
      const settings = arrowPresentation(f.presentation, id);
      el.setAttribute('opacity', String(presentationOpacity(settings)));
      el.setAttribute('visibility', presentationVisibility(settings));
    }
  }

  private renderCaptions(f: ReturnType<typeof frameAt>) {
    for (const [id, el] of this.captions) el.setAttribute('opacity', f.captions[id] ? '1' : '0');
  }
}
