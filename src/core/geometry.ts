export interface Pt { x: number; y: number }

/** A flattened polyline with arc-length lookup. The SVG path `d` is built from the same points,
 *  so packets follow exactly the drawn connector. */
export interface Path { points: Pt[]; d: string; length: number; cum: number[] }

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

function roundCorners(pts: Pt[], radius: number, steps = 8): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!, a = pts[i - 1]!, b = pts[i + 1]!;
    const r = Math.min(radius, dist(a, p) / 2, dist(p, b) / 2);
    if (r < 0.5) { out.push(p); continue; }
    const u = (q: Pt) => ({ x: (q.x - p.x) / dist(p, q), y: (q.y - p.y) / dist(p, q) });
    const ua = u(a), ub = u(b);
    const s = { x: p.x + ua.x * r, y: p.y + ua.y * r }, e = { x: p.x + ub.x * r, y: p.y + ub.y * r };
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, m = 1 - t;
      out.push({ x: m * m * s.x + 2 * m * t * p.x + t * t * e.x, y: m * m * s.y + 2 * m * t * p.y + t * t * e.y });
    }
  }
  out.push(pts.at(-1)!);
  return out;
}

function cubic(a: Pt, b: Pt, horizontal: boolean, steps = 32): Pt[] {
  const c1 = horizontal ? { x: (a.x + b.x) / 2, y: a.y } : { x: a.x, y: (a.y + b.y) / 2 };
  const c2 = horizontal ? { x: (a.x + b.x) / 2, y: b.y } : { x: b.x, y: (a.y + b.y) / 2 };
  const out: Pt[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, m = 1 - t;
    out.push({
      x: m ** 3 * a.x + 3 * m * m * t * c1.x + 3 * m * t * t * c2.x + t ** 3 * b.x,
      y: m ** 3 * a.y + 3 * m * m * t * c1.y + 3 * m * t * t * c2.y + t ** 3 * b.y,
    });
  }
  return out;
}

export function makePath(route: Pt[], opts: { curve?: boolean; horizontal?: boolean } = {}): Path {
  const raw = route.length >= 2 ? route : [route[0] ?? { x: 0, y: 0 }, route[0] ?? { x: 0, y: 0 }];
  const points = opts.curve
    ? cubic(raw[0]!, raw.at(-1)!, opts.horizontal ?? true)
    : roundCorners(raw, 12);
  return pathFromPoints(points);
}

/** Build a Path from already-flattened points (no further smoothing). */
export function pathFromPoints(points: Pt[]): Path {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1]! + dist(points[i - 1]!, points[i]!));
  const f = (n: number) => Math.round(n * 100) / 100;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join(' ');
  return { points, d, length: cum.at(-1)!, cum };
}

/** Point at fraction 0..1 of arc length. */
export function pointAt(path: Path, frac: number): Pt {
  const target = Math.min(1, Math.max(0, frac)) * path.length;
  let lo = 0, hi = path.cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path.cum[mid]! <= target) lo = mid; else hi = mid; }
  const a = path.points[lo]!, b = path.points[hi] ?? a;
  const seg = path.cum[hi]! - path.cum[lo]!;
  const k = seg > 0 ? (target - path.cum[lo]!) / seg : 0;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

/** Approximate text width in px (no DOM needed, so layout works headless). */
export const textWidth = (s: string, size = 13) => Math.ceil(s.length * size * 0.58);
