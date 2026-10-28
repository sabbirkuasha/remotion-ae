import type { Anim, Key } from "./ir.ts";

// Piecewise-linear curves as [frame, value] points, constant beyond the ends (like clamped interpolate()
// in Remotion and like keyframes in After Effects).
export type Curve = [number, number][];

export const round = (v: number, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Linear from v0 at f0 to v1 at f1. */
export const ramp = (f0: number, f1: number, v0: number, v1: number): Curve =>
  f1 > f0 ? [[f0, v0], [f1, v1]] : [[f0, v1]];

export function valueAt(c: Curve, f: number): number {
  if (f <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    const [f0, v0] = c[i - 1];
    const [f1, v1] = c[i];
    if (f <= f1) return v0 + ((v1 - v0) * (f - f0)) / (f1 - f0);
  }
  return c[c.length - 1][1];
}

/** Drop points that lie on the line through their neighbours. */
function simplify(c: Curve): Curve {
  const out: Curve = [];
  for (const p of c) {
    if (out.length && Math.abs(out[out.length - 1][0] - p[0]) < 1e-9) continue;
    while (out.length >= 2) {
      const [a, b] = [out[out.length - 2], out[out.length - 1]];
      const expected = a[1] + ((p[1] - a[1]) * (b[0] - a[0])) / (p[0] - a[0]);
      if (Math.abs(expected - b[1]) > 1e-6) break;
      out.pop();
    }
    out.push(p);
  }
  // a flat start or end needs only one point
  while (out.length >= 2 && Math.abs(out[0][1] - out[1][1]) < 1e-9) out.shift();
  while (out.length >= 2 && Math.abs(out[out.length - 1][1] - out[out.length - 2][1]) < 1e-9) out.pop();
  return out;
}

/** Pointwise minimum of two curves, exact (adds the crossing points). */
export function minCurve(a: Curve, b: Curve): Curve {
  const xs = [...new Set([...a, ...b].map((p) => p[0]))].sort((x, y) => x - y);
  const diff = (x: number) => valueAt(a, x) - valueAt(b, x);
  const pts: Curve = [];
  xs.forEach((x, i) => {
    if (i > 0 && diff(xs[i - 1]) * diff(x) < 0) {
      const x0 = xs[i - 1];
      const xc = x0 + ((x - x0) * diff(x0)) / (diff(x0) - diff(x));
      pts.push([xc, valueAt(a, xc)]);
    }
    pts.push([x, Math.min(valueAt(a, x), valueAt(b, x))]);
  });
  return simplify(pts);
}

export const scaleCurve = (c: Curve, k: number): Curve => c.map(([f, v]) => [f, v * k]);

/**
 * Keyframes for sampled values (one per frame, any number of dimensions): a constant when nothing changes,
 * otherwise linear keys with every key dropped that lies on the straight line between its neighbours.
 */
export function sampledAnim(samples: [number, number[]][], digits = 3, tolerance = 1e-3): Anim<number[]> | Anim<number> {
  const scalar = samples.length > 0 && samples[0][1].length === 1;
  const pack = (v: number[]) => (scalar ? round(v[0], digits) : v.map((x) => round(x, digits)));
  const same = (a: number[], b: number[]) => a.every((x, i) => Math.abs(x - b[i]) <= tolerance);
  if (samples.every(([, v]) => same(v, samples[0][1]))) return pack(samples[0][1]) as never;
  const kept: [number, number[]][] = [];
  for (let i = 0; i < samples.length; i++) {
    const [f, v] = samples[i];
    const prev = kept[kept.length - 1];
    const next = samples[i + 1];
    if (prev && next) {
      const t = (f - prev[0]) / (next[0] - prev[0]);
      if (same(v, prev[1].map((x, d) => x + (next[1][d] - x) * t))) continue;
    }
    kept.push([f, v]);
  }
  return { keys: kept.map(([f, v]): Key<number | number[]> => ({ f, v: pack(v) })) } as never;
}

/** A constant when the curve is flat, linear keyframes otherwise. */
export function curveAnim(c: Curve): Anim<number> {
  const s = simplify(c);
  if (s.length === 1) return round(s[0][1]);
  return { keys: s.map(([f, v]): Key<number> => ({ f: round(f), v: round(v) })) };
}
