// Capture any Remotion composition as a Scene: step through it in Chrome (render mode), find the elements that
// move, appear, disappear or blend; record their transform, opacity and animated clips on every frame; render each
// one's artwork at rest; and lay them out as After Effects layers named after their <Sequence>s.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Anim, BlendMode, Comp, Footage, Layer, Mask, Scene, Vec } from "../ir.ts";
import { round, sampledAnim } from "../keys.ts";
import { openComposition } from "./remotion-page.ts";

const PAGE_SCRIPT = fileURLToPath(new URL("./page.js", import.meta.url));

export type CaptureOptions = {
  projectDir: string;
  entry: string;
  composition: string;
  /** Folder for the layer images (the .jsx goes next to it). */
  outDir: string;
  /** Artwork resolution relative to the composition (2 = room to scale up 2x without blur). */
  scale?: number;
  /** Also save Remotion's own frames at these frame numbers (reference for comparisons). */
  referenceFrames?: number[];
  referenceDir?: string;
  log?: (s: string) => void;
};

type Matrix = [number, number, number, number, number, number];
type Sample = { m: Matrix | null; o: number; clips: [number, number][][] };
type Meta = { chain: { name: string; from: number }[]; order: number[]; tag: string; elementId: string };
type Isolated = { box: { x: number; y: number; width: number; height: number }; rest: Matrix; origin: [number, number] };

const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const invert = ([a, b, c, d, e, f]: Matrix): Matrix => {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};
const apply = ([a, b, c, d, e, f]: Matrix, [x, y]: [number, number]): [number, number] => [a * x + c * y + e, b * x + d * y + f];
const compareOrder = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};
const safeName = (s: string) => s.replace(/[^\w\- ()]+/g, "_").replace(/\s+/g, " ").trim() || "layer";

export async function capture(o: CaptureOptions): Promise<{ scene: Scene; notes: string[] }> {
  const log = o.log ?? ((s: string) => console.log(s));
  const scale = o.scale ?? 2;
  const notes: string[] = [];
  const comp = await openComposition(o.projectDir, o.entry, o.composition, { log });
  const { chrome, meta: info } = comp;
  const { fps, width: W, height: H, durationInFrames: N } = info;
  const evaluate = <T>(js: string) => chrome.evaluate<T>(js);

  try {
    await comp.seek(0);
    await evaluate(readFileSync(PAGE_SCRIPT, "utf8"));

    // pass 1: what changes, appears, disappears or blends
    log(`pass 1/3: stepping through ${N} frames to find what moves`);
    for (let f = 1; f < N; f++) {
      await comp.seek(f);
      await evaluate("window.__ae.drain()");
    }
    const summary = await evaluate<{
      layers: string[];
      animated: string[];
      clips: string[];
      blends: Record<string, string>;
      meta: Record<string, Meta>;
    }>("window.__ae.summary()");
    const layerIds = summary.layers.sort((a, b) => compareOrder(summary.meta[a].order, summary.meta[b].order));
    log(`  ${layerIds.length} layers, ${summary.clips.length} animated clip path(s), ${Object.keys(summary.blends).length} blending element(s)`);

    // pass 2: where each layer is, on every frame
    log("pass 2/3: measuring every layer on every frame");
    const samples = new Map<string, Map<number, Sample>>(layerIds.map((id) => [id, new Map()]));
    if (o.referenceDir) mkdirSync(o.referenceDir, { recursive: true });
    for (let f = 0; f < N; f++) {
      await comp.seek(f);
      const s = await evaluate<Record<string, Sample>>(`window.__ae.sample(${JSON.stringify(layerIds)}, ${JSON.stringify(summary.clips)})`);
      for (const [id, v] of Object.entries(s)) samples.get(id)?.set(f, v);
      if (o.referenceFrames?.includes(f) && o.referenceDir) {
        const shot = await chrome.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(path.join(o.referenceDir, `remotion_${String(f).padStart(5, "0")}.png`), Buffer.from(shot.data, "base64"));
      }
    }

    const seen = layerIds.filter((id) => samples.get(id)!.size > 0).length;
    log(`  ${seen} of ${layerIds.length} layers are visible at some frame`);

    // pass 3: each layer's artwork at rest, as a transparent image
    log("pass 3/3: rendering each layer's artwork");
    const imagesDir = path.join(o.outDir, "layers");
    rmSync(imagesDir, { recursive: true, force: true });
    mkdirSync(imagesDir, { recursive: true });
    const used = new Set<string>(["static"]);
    const rel = (file: string) => path.relative(o.outDir, file).replace(/\\/g, "/");
    const shoot = async (id: string | null, frame: number, file: string): Promise<Isolated | null> => {
      await comp.seek(frame);
      const iso = await evaluate<Isolated | null>(
        `window.__ae.isolate(${JSON.stringify(id)}, ${JSON.stringify(layerIds)}, ${JSON.stringify(summary.animated)}, ${JSON.stringify(summary.clips)}, 24)`,
      );
      try {
        if (!iso || iso.box.width < 0.5 || iso.box.height < 0.5) return null;
        const w = Math.ceil(iso.box.width * scale);
        const h = Math.ceil(iso.box.height * scale);
        iso.box.width = w / scale;
        iso.box.height = h / scale;
        await evaluate(`window.__ae.frameRegion(${JSON.stringify(iso.box)}, ${scale})`);
        await chrome.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
        const shot = await chrome.send("Page.captureScreenshot", {
          format: "png",
          clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
          captureBeyondViewport: true,
        });
        writeFileSync(file, Buffer.from(shot.data, "base64"));
        return iso;
      } finally {
        await chrome.send("Emulation.setDefaultBackgroundColorOverride", {});
        await evaluate("window.__ae.restore()");
      }
    };

    type Captured = { id: string; meta: Meta; frames: number[]; iso: Isolated; footage: Footage; blend?: string };
    const captured: Captured[] = [];
    const tmpPng = path.join(imagesDir, "_capture.png");
    for (const id of layerIds) {
      const frames = [...samples.get(id)!.keys()].sort((a, b) => a - b);
      if (!frames.length) continue;
      const m = summary.meta[id];
      const iso = await shoot(id, frames[frames.length - 1], tmpPng);
      if (!iso) continue; // draws nothing of its own (e.g. a group whose children are layers)
      const base = safeName(
        m.chain.filter((c) => !c.name.startsWith("<")).map((c) => c.name).join(" - ") ||
          m.elementId ||
          m.chain.map((c) => c.name.replace(/[<>]/g, "")).filter(Boolean).pop() ||
          m.tag,
      );
      let file = base;
      for (let n = 2; used.has(file.toLowerCase()); n++) file = `${base} ${n}`;
      used.add(file.toLowerCase());
      const png = path.join(imagesDir, `${file}.png`);
      renameSync(tmpPng, png);
      captured.push({
        id,
        meta: m,
        frames,
        iso,
        blend: summary.blends[id],
        footage: { id: `layer:${file}`, file: png, rel: rel(png), folder: "Footage/layers" },
      });
    }
    const staticPng = path.join(imagesDir, "Static.png");
    const staticIso = await shoot(null, N - 1, staticPng);
    log(`  ${captured.length} layers with artwork${staticIso ? " + static background" : ""}`);

    // ------------------------------------------------------------ scene
    const toLayer = (c: Captured, offset: number, name: string): Layer => {
      const { box, rest, origin } = c.iso;
      const restInv = invert(rest);
      const anchor: Vec = [round((origin[0] - box.x) * scale, 3), round((origin[1] - box.y) * scale, 3)];
      const position: [number, number[]][] = [];
      const scaleKeys: [number, number[]][] = [];
      const rotation: [number, number[]][] = [];
      const opacity: [number, number[]][] = [];
      const masks: [number, number[][]][][] = [];
      let lastAngle = 0;
      let skewed = false;
      for (const f of c.frames) {
        const s = samples.get(c.id)!.get(f)!;
        if (!s.m) continue;
        const M = multiply(s.m, restInv);
        const [a, b, cc, d] = M;
        const sx = Math.hypot(a, b);
        const sy = (a * d - b * cc) / sx;
        if (Math.abs(a * cc + b * d) / (sx * Math.abs(sy) || 1) > 1e-3) skewed = true;
        let angle = (Math.atan2(b, a) * 180) / Math.PI;
        while (angle - lastAngle > 180) angle -= 360;
        while (angle - lastAngle < -180) angle += 360;
        lastAngle = angle;
        const t = f - offset;
        position.push([t, apply(M, origin)]);
        scaleKeys.push([t, [(sx * 100) / scale, (sy * 100) / scale]]);
        rotation.push([t, [angle]]);
        opacity.push([t, [s.o * 100]]);
        // animated clips -> masks, in layer pixels
        const Minv = invert(M);
        s.clips.forEach((poly, i) => {
          (masks[i] ??= []).push([t, poly.map((q) => {
            const p = apply(Minv, q);
            return [round((p[0] - box.x) * scale, 2), round((p[1] - box.y) * scale, 2)];
          })]);
        });
      }
      if (skewed) notes.push(`${name}: skew is not carried over (After Effects transforms have no skew)`);
      const maskList: Mask[] = masks.map((keys) => ({
        path: keys.length > 1 && keys.some(([, v]) => JSON.stringify(v) !== JSON.stringify(keys[0][1]))
          ? { keys: keys.map(([f, vertices]) => ({ f, v: { vertices: vertices as [number, number][], closed: true } })) }
          : { vertices: keys[0][1] as [number, number][], closed: true },
      }));
      return {
        kind: "footage",
        name,
        footage: c.footage.id,
        in: c.frames[0] - offset,
        out: c.frames[c.frames.length - 1] + 1 - offset,
        transform: {
          anchor,
          position: sampledAnim(position, 3) as Anim<Vec>,
          scale: sampledAnim(scaleKeys, 3) as Anim<Vec>,
          rotation: sampledAnim(rotation, 3) as Anim<number>,
          opacity: sampledAnim(opacity, 2) as Anim<number>,
        },
        ...(maskList.length && { masks: maskList }),
        ...(c.blend && { blend: c.blend as BlendMode }),
      };
    };

    // group layers by their outermost named <Sequence>; a sequence with several layers becomes a precomp
    const named = (c: Captured) => c.meta.chain.filter((s) => s.name && !s.name.startsWith("<"));
    const fallback = (c: Captured) =>
      c.meta.elementId || c.meta.chain.map((s) => s.name.replace(/[<>]/g, "")).filter(Boolean).pop() || c.meta.tag;
    const withBlend = (c: Captured, name: string) => (c.blend ? `${name} (${c.blend})` : name);
    const groups: { key: string; name: string; members: Captured[] }[] = [];
    for (const c of captured) {
      const top = named(c)[0];
      const key = top ? `${top.name}@${top.from}` : `#${c.id}`;
      const g = groups.find((x) => x.key === key && top);
      if (g) g.members.push(c);
      else groups.push({ key, name: top?.name ?? fallback(c), members: [c] });
    }

    const unique = (names: string[]) => {
      const seen = new Map<string, number>();
      return names.map((n) => {
        const k = (seen.get(n) ?? 0) + 1;
        seen.set(n, k);
        return k > 1 ? `${n} ${k}` : n;
      });
    };
    const comps: Comp[] = [];
    const mainLayers: Layer[] = [];
    for (const g of groups) {
      if (g.members.length === 1) {
        const c = g.members[0];
        const chain = named(c);
        mainLayers.push(toLayer(c, 0, withBlend(c, chain[chain.length - 1]?.name ?? g.name)));
        continue;
      }
      const start = Math.min(...g.members.map((c) => c.frames[0]));
      const end = Math.max(...g.members.map((c) => c.frames[c.frames.length - 1] + 1));
      const names = unique(
        g.members.map((c) => {
          const inner = named(c).slice(1).map((s) => s.name);
          return withBlend(c, inner.length ? inner.join(" - ") : g.name);
        }),
      );
      const id = `seq:${comps.length}:${g.name}`;
      comps.push({
        id,
        name: g.name,
        width: W,
        height: H,
        fps,
        frames: end - start,
        folder: "Sequences",
        // paint order is bottom-up; AE lists the top layer first
        layers: g.members.map((c, i) => toLayer(c, start, names[i])).reverse(),
      });
      // collapsed, so blend modes inside (e.g. colour-dodge glows) act on what lies below, as in the browser
      mainLayers.push({ kind: "comp", comp: id, name: g.name, in: start, out: end, start, collapse: true });
    }
    const mainNames = unique(mainLayers.map((l) => l.name!));
    mainLayers.forEach((l, i) => (l.name = mainNames[i]));
    if (staticIso) {
      mainLayers.unshift({
        kind: "footage",
        name: "Static",
        footage: "layer:Static",
        in: 0,
        out: N,
        comment: "Everything that never moves, appears or disappears",
        transform: {
          anchor: [round((staticIso.origin[0] - staticIso.box.x) * scale, 3), round((staticIso.origin[1] - staticIso.box.y) * scale, 3)],
          position: [round(staticIso.origin[0], 3), round(staticIso.origin[1], 3)],
          scale: [100 / scale, 100 / scale],
        },
      });
    }
    const footage: Footage[] = [
      ...(staticIso ? [{ id: "layer:Static", file: staticPng, rel: rel(staticPng), folder: "Footage/layers" }] : []),
      ...captured.map((c) => c.footage),
    ];
    const main: Comp = { id: "main", name: o.composition, width: W, height: H, fps, frames: N, bg: [0, 0, 0], layers: mainLayers.reverse() };
    return { scene: { version: 1, name: o.composition, footage, comps: [...comps, main], main: "main" }, notes };
  } finally {
    await comp.close();
  }
}
