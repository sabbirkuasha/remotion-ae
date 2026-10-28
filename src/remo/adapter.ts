// remo timeline.json -> Scene. Every number here mirrors a remo component; the source file is named
// next to each group of constants. Frames match src/remo/timing.ts (a copy of remo's timing).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseColor } from "../color.ts";
import type { Anim, Comp, Effect, Footage, Key, Layer, RGB, Scene, TextSpec, Vec } from "../ir.ts";
import { curveAnim, minCurve, ramp, round, scaleCurve } from "../keys.ts";
import { probe, type MediaInfo } from "../media.ts";
import { shotSchema, timelineSchema, type ShotSpec, type Timeline } from "./schema.ts";
import { computeTimings, type ShotTiming } from "./timing.ts";

// KenBurns.tsx
const ZOOM = 0.12;
const PAN = 4; // % of the frame
const BACKDROP_SCALE = 1.15;
const BACKDROP_BLUR = 40; // CSS px
const BACKDROP_BRIGHTNESS = 0.55;

// Transitions.tsx
const FLASH_COLOR = "#fff6e2";
const SWEEP_ANGLE = 100; // CSS gradient angle, degrees

// Indic scripts fall back to Nirmala UI in Chrome on Windows (remo's font lists name it for Bangla).
const INDIC = "\\u0900-\\u0DFF\\u200C\\u200D";
const hasIndic = (s: string) => new RegExp(`[${INDIC}]`).test(s);

/** Ascent and descent per em (hhea = OS/2 win metrics, what Chrome uses on Windows). */
const METRICS: Record<string, [number, number]> = {
  "SegoeUI-Bold": [1.0791, 0.251],
  "Georgia-Italic": [0.917, 0.2192],
};
/** Distance from the top of a CSS line box to the baseline. */
const baselineInLineBox = (font: string, size: number, lineHeight: number) =>
  (lineHeight + (METRICS[font][0] - METRICS[font][1]) * size) / 2;

// Calibration of AE effects against Chrome's rendering.
const AE_BLUR_PER_CSS_BLUR = 2.5; // Gaussian Blur "Blurriness" per CSS blur() px (tools/calibrate-blur.ts)
const AE_SOFTNESS_PER_CSS_SHADOW_BLUR = 1; // Drop Shadow "Softness" per text-shadow blur px

export type RemoProject = { dir: string; lang?: string; suffix: string; timeline: string; assets: string; renders: string };

export function remoProject(dir: string, lang?: string): RemoProject {
  const abs = path.resolve(dir);
  const suffix = lang ? `.${lang}` : "";
  return {
    dir: abs,
    lang,
    suffix,
    timeline: path.join(abs, `timeline${suffix}.json`),
    assets: path.join(abs, "assets"),
    renders: path.join(abs, "renders"),
  };
}

/** Fields the schema doesn't know (e.g. added by a newer remo): parsing drops them, so they get reported. */
function unknownFields(raw: Record<string, unknown>): string[] {
  const extra = (obj: unknown, known: object, where: string) =>
    obj && typeof obj === "object" ? Object.keys(obj).filter((k) => !(k in known)).map((k) => `${where}"${k}"`) : [];
  const shots: Record<string, unknown>[] = Array.isArray(raw.shots) ? raw.shots : [];
  return [
    ...extra(raw, timelineSchema.shape, ""),
    ...extra(raw.audio, timelineSchema.shape.audio.unwrap().shape, "audio."),
    ...shots.flatMap((s, i) => extra(s, shotSchema.shape, `shot ${s?.id ?? i + 1}: `)),
  ];
}

export function loadTimeline(p: RemoProject): { timeline: Timeline; unknown: string[] } {
  if (!existsSync(p.timeline)) throw new Error(`no ${path.basename(p.timeline)} in ${p.dir}`);
  const raw = JSON.parse(readFileSync(p.timeline, "utf8"));
  const parsed = timelineSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`${path.basename(p.timeline)} does not match the remo schema:\n${issues}`);
  }
  return { timeline: parsed.data, unknown: unknownFields(raw) };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const db = (volume: number) => round(Math.max(-96, 20 * Math.log10(volume)), 2);

function dropShadow(opacity: number, distance: number, cssBlur: number): Effect {
  return {
    match: "ADBE Drop Shadow",
    props: {
      "ADBE Drop Shadow-0001": [0, 0, 0],
      "ADBE Drop Shadow-0002": round(opacity * 255, 2),
      "ADBE Drop Shadow-0003": 180,
      "ADBE Drop Shadow-0004": distance,
      "ADBE Drop Shadow-0005": round(cssBlur * AE_SOFTNESS_PER_CSS_SHADOW_BLUR, 2),
    },
  };
}

const slider = (name: string, value: number): Effect => ({
  match: "ADBE Slider Control",
  name,
  props: { "ADBE Slider Control-0001": round(value, 3) },
});

const keys = <V>(...k: Key<V>[]): Anim<V> => ({ keys: k });

/** Build the scene for a remo project. `scriptDir` is where the .jsx will live (for relative footage paths). */
export function remoScene(p: RemoProject, scriptDir: string): { scene: Scene; notes: string[] } {
  const { timeline: t, unknown } = loadTimeline(p);
  const { fps, width: W, height: H } = t;
  const MIN = Math.min(W, H);
  const center: Vec = [W / 2, H / 2];
  const notes = unknown.map((f) => `${f} is not a remo field this exporter knows; left out`);
  const errors: string[] = [];

  // ------------------------------------------------------------ footage

  const footage = new Map<string, Footage & { info: MediaInfo }>();
  function use(rel: string, what: string): Footage & { info: MediaInfo } {
    if (/^https?:\/\//.test(rel)) throw new Error(`${what}: remote files are not supported yet, download into assets/ (${rel})`);
    const key = rel.replace(/\\/g, "/");
    const hit = footage.get(key);
    if (hit) return hit;
    const file = path.join(p.assets, key);
    if (!existsSync(file)) throw new Error(`${what}: not found: assets/${key}`);
    const dir = path.posix.dirname(key);
    const f = {
      id: key,
      file,
      rel: path.relative(scriptDir, file).replace(/\\/g, "/"),
      folder: dir === "." ? "Footage" : `Footage/${dir}`,
      info: probe(file),
    };
    footage.set(key, f);
    return f;
  }

  const fitScale = ({ id, info }: Footage & { info: MediaInfo }, fit: "cover" | "contain") => {
    if (!info.width || !info.height) throw new Error(`no picture size for assets/${id}`);
    const sx = W / info.width;
    const sy = H / info.height;
    return fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
  };
  const pct = (s: number): Vec => [round(s * 100), round(s * 100)];

  // ------------------------------------------------------------ shot contents

  /** KenBurns.tsx: CSS `scale(m) translate(t%)` around the frame centre, progress over frames 0..D-1. */
  function kenBurns(shot: ShotSpec, image: Footage & { info: MediaInfo }, D: number): Layer {
    const s0 = fitScale(image, shot.fit ?? "cover");
    const end = Math.max(1, D - 1);
    const zoomed = 1 + ZOOM;
    const shift = (sign: number, axis: 0 | 1): Vec => {
      const v = [...center];
      v[axis] += (zoomed * sign * PAN * (axis === 0 ? W : H)) / 100;
      return v.map((x) => round(x));
    };
    let scale: Anim<Vec> = pct(s0);
    let position: Anim<Vec> = center;
    switch (shot.motion ?? "zoom-in") {
      case "zoom-in":
        scale = keys({ f: 0, v: pct(s0) }, { f: end, v: pct(s0 * zoomed) });
        break;
      case "zoom-out":
        scale = keys({ f: 0, v: pct(s0 * zoomed) }, { f: end, v: pct(s0) });
        break;
      case "pan-left":
        scale = pct(s0 * zoomed);
        position = keys({ f: 0, v: shift(-1, 0) }, { f: end, v: shift(1, 0) });
        break;
      case "pan-right":
        scale = pct(s0 * zoomed);
        position = keys({ f: 0, v: shift(1, 0) }, { f: end, v: shift(-1, 0) });
        break;
      case "pan-up":
        scale = pct(s0 * zoomed);
        position = keys({ f: 0, v: shift(-1, 1) }, { f: end, v: shift(1, 1) });
        break;
      case "pan-down":
        scale = pct(s0 * zoomed);
        position = keys({ f: 0, v: shift(1, 1) }, { f: end, v: shift(-1, 1) });
        break;
    }
    return { kind: "footage", footage: image.id, in: 0, out: D, transform: { position, scale } };
  }

  /** KenBurns.tsx Backdrop: cover, scale 1.15, blur(40px) brightness(0.55). */
  function backdrop(image: Footage & { info: MediaInfo }, D: number): Layer {
    const s0 = fitScale(image, "cover");
    return {
      kind: "footage",
      name: "Backdrop",
      footage: image.id,
      in: 0,
      out: D,
      transform: { position: center, scale: pct(s0 * BACKDROP_SCALE) },
      effects: [
        // CSS blurs in the element's own space before its transform; AE blurs in source pixels
        {
          match: "ADBE Gaussian Blur 2",
          props: {
            "ADBE Gaussian Blur 2-0001": round((BACKDROP_BLUR * AE_BLUR_PER_CSS_BLUR) / s0, 2),
            "ADBE Gaussian Blur 2-0003": 1,
          },
        },
        { match: "ADBE Easy Levels2", props: { "ADBE Easy Levels2-0007": BACKDROP_BRIGHTNESS } },
      ],
    };
  }

  /** Caption.tsx: bottom centre, box rgba(0,0,0,.4), Segoe UI Bold 5.5cqmin, line-height 1.25, fades 0.3s. */
  function caption(text: string, D: number): Layer[] {
    const size = 0.055 * MIN;
    const lh = 1.25 * size;
    const padX = 0.7 * size;
    const padY = 0.3 * size;
    // max-width: 85%, measured border-box in Remotion's page: text wraps at 85% minus the padding
    const wrapWidth = round(0.85 * W - 2 * padX, 1);
    const font = "SegoeUI-Bold";
    const base = baselineInLineBox(font, size, lh);
    const lastBaseline = H - 0.08 * H - padY - lh + base;
    const fade = Math.round(0.3 * fps);
    const opacity = curveAnim(scaleCurve(minCurve(ramp(0, fade, 0, 1), ramp(D - fade, D, 1, 0)), 100));
    const indic = hasIndic(text);
    const spec: TextSpec = {
      text,
      font,
      size: round(size, 3),
      fill: [1, 1, 1],
      justify: "center",
      leading: round(lh, 3),
      wrapWidth,
      ...(indic && { scriptFonts: [{ chars: INDIC, font: "NirmalaUI-Bold" }], universalEngine: true }),
    };
    const lines = 'String(c.text.sourceText).split("\\r").length';
    const L = round(lh, 3);
    return [
      {
        kind: "text",
        name: "Caption",
        in: 0,
        out: D,
        text: spec,
        transform: {
          // the anchor sits on the last line's baseline, so extra lines grow upwards like the CSS box
          anchor: { expr: `var c = thisLayer;\n[0, (${lines} - 1) * ${L}]` },
          position: [round(W / 2), round(lastBaseline, 3)],
          opacity,
        },
        effects: [dropShadow(0.8, 2, 12)],
      },
      {
        kind: "shape",
        name: "Caption box",
        in: 0,
        out: D,
        transform: { anchor: [0, 0], position: [0, 0], opacity: { expr: 'thisComp.layer("Caption").transform.opacity' } },
        effects: [slider("Padding X", padX), slider("Padding Y", padY), slider("Wrap width", wrapWidth)],
        shapes: [
          {
            kind: "rect",
            name: "Box",
            size: {
              expr: [
                'var c = thisComp.layer("Caption");',
                `var lines = ${lines};`,
                "// like CSS: once a caption wraps, its box takes the full wrap width",
                'var w = lines > 1 ? effect("Wrap width")("Slider") : c.sourceRectAtTime(time, false).width;',
                `[w + 2 * effect("Padding X")("Slider"), lines * ${L} + 2 * effect("Padding Y")("Slider")]`,
              ].join("\n"),
            },
            position: {
              expr: [
                'var c = thisComp.layer("Caption");',
                'var padY = effect("Padding Y")("Slider");',
                `var top = c.toComp([0, 0])[1] - ${round(base, 3)} - padY;`,
                `[c.toComp([0, 0])[0], top + (${lines} * ${L} + 2 * padY) / 2]`,
              ].join("\n"),
            },
            roundness: round(0.4 * size, 3),
            fill: [0, 0, 0],
            fillOpacity: 40,
          },
        ],
      },
    ];
  }

  /** Lines.tsx: centred column of Georgia Italic lines; each fades in over 1s and rises 1.5cqmin, all fade out over 0.8s. */
  function closingLines(lines: string[], D: number): Layer[] {
    const size = 0.046 * MIN;
    const lh = 1.3 * size;
    const gap = 0.025 * MIN;
    const rise = 0.015 * MIN;
    const font = "Georgia-Italic";
    const fadeIn = Math.round(fps);
    const fadeOut = Math.round(0.8 * fps);
    const step = (D * 0.6) / Math.max(1, lines.length);
    const total = lines.length * lh + (lines.length - 1) * gap;
    const top = (H - total) / 2;
    const out = ramp(D - fadeOut, D, 1, 0);
    return lines.map((line, i): Layer => {
      const start = Math.round(0.4 * fps + i * step);
      const baseline = round(top + i * (lh + gap) + baselineInLineBox(font, size, lh), 3);
      const indic = hasIndic(line);
      return {
        kind: "text",
        name: `Line ${i + 1}`,
        in: 0,
        out: D,
        text: {
          text: line,
          font,
          size: round(size, 3),
          fill: parseColor("#fff8ec").rgb,
          justify: "center",
          leading: round(lh, 3),
          wrapWidth: round(0.9 * W, 1),
          ...(indic && { scriptFonts: [{ chars: INDIC, font: "NirmalaUI", fauxItalic: true }], universalEngine: true }),
        },
        transform: {
          position: keys({ f: start, v: [round(W / 2), round(baseline + rise, 3)] }, { f: start + fadeIn, v: [round(W / 2), baseline] }),
          opacity: curveAnim(scaleCurve(minCurve(ramp(start, start + fadeIn, 0, 1), out), 100)),
        },
        effects: [dropShadow(0.85, 2, 18), dropShadow(0.6, 0, 4)],
      };
    });
  }

  function shotComp(s: ShotTiming): Comp {
    const { shot } = s;
    const D = s.durationInFrames;
    const fit = shot.fit ?? "cover";
    const what = `shot ${shot.id}`;
    const layers: Layer[] = [];
    if (shot.lines?.length) layers.push(...closingLines(shot.lines, D));
    if (shot.caption) layers.push(...caption(shot.caption, D));

    let covered = false;
    if (shot.clip) {
      const clip = use(shot.clip, what);
      const trim = Math.round((shot.clipStart ?? 0) * fps);
      const need = shot.seconds + (shot.clipStart ?? 0);
      if (clip.info.seconds !== undefined && clip.info.seconds + 0.05 < need) {
        errors.push(`${shot.id}: clip is ${clip.info.seconds.toFixed(2)}s but the shot needs ${need.toFixed(2)}s (seconds + clipStart)`);
      }
      layers.push({
        kind: "footage",
        footage: clip.id,
        in: 0,
        out: D,
        start: -trim,
        transform: { position: center, scale: pct(fitScale(clip, fit)) },
        audio: shot.clipVolume ? { enabled: true, levels: [db(shot.clipVolume), db(shot.clipVolume)] } : { enabled: false },
      });
      if (fit === "contain" && shot.image) layers.push(backdrop(use(shot.image, what), D));
      covered = fit === "cover" || !!shot.image;
    } else if (shot.image) {
      const image = use(shot.image, what);
      layers.push(kenBurns(shot, image, D));
      if (fit === "contain") layers.push(backdrop(image, D));
      covered = !/\.(png|webp|gif)$/i.test(shot.image);
    }
    // Shot.tsx paints shot.color (default black) behind everything
    const bg = parseColor(shot.color ?? "black");
    if ((!covered || shot.color) && bg.alpha > 0) {
      layers.push({
        kind: "solid",
        name: "Background",
        color: bg.rgb,
        width: W,
        height: H,
        in: 0,
        out: D,
        ...(bg.alpha < 1 && { transform: { opacity: round(bg.alpha * 100, 2) } }),
      });
    }
    return { id: `shot:${shot.id}`, name: `${pad2(s.index + 1)} ${shot.id}`, width: W, height: H, fps, frames: D, folder: "Shots", layers };
  }

  // ------------------------------------------------------------ main comp

  const { shots, totalFrames } = computeTimings(t);
  if (!shots.length) throw new Error("the timeline has no shots");
  const comps = shots.map(shotComp);

  type ShotLayer = Layer & { kind: "comp" };
  const shotLayers: ShotLayer[] = shots.map((s, i) => ({
    kind: "comp",
    comp: comps[i].id,
    in: s.from,
    out: s.from + s.durationInFrames,
    start: s.from,
    ...(s.shot.beat && { comment: s.shot.beat }),
  }));
  // overlays (flash, sweep glow/matte) sit directly above the shot they bring in
  const overlays: Layer[][] = shots.map(() => []);
  const transitionComps: Comp[] = [];
  const positionKeys: Key<Vec>[][] = shots.map(() => []);

  /** CSS linear-gradient(angle) geometry: point at q% along the gradient line. */
  const angle = (SWEEP_ANGLE * Math.PI) / 180;
  const dir = [Math.sin(angle), -Math.cos(angle)];
  const gradLength = Math.abs(W * Math.sin(angle)) + Math.abs(H * Math.cos(angle));
  const along = (q: number): Vec => [
    round(W / 2 + dir[0] * (q / 100 - 0.5) * gradLength, 2),
    round(H / 2 + dir[1] * (q / 100 - 0.5) * gradLength, 2),
  ];

  shots.forEach((s, i) => {
    const N = s.transitionFrames;
    if (!N) return;
    const kind = s.shot.transition ?? "cut";
    const next = shotLayers[i + 1];
    const id = shots[i + 1].shot.id;
    const t0 = shots[i + 1].from;
    const t1 = t0 + N;
    const slide = (enterFrom: Vec, exitTo: Vec) => {
      positionKeys[i + 1].push({ f: t0, v: enterFrom }, { f: t1, v: center });
      positionKeys[i].push({ f: t0, v: center }, { f: t1, v: exitTo });
    };
    switch (kind) {
      case "fade":
        next.transform = { ...next.transform, opacity: keys({ f: t0, v: 0 }, { f: t1, v: 100 }) };
        break;
      case "slide-left":
        slide([W / 2 + W, H / 2], [W / 2 - W, H / 2]);
        break;
      case "slide-right":
        slide([W / 2 - W, H / 2], [W / 2 + W, H / 2]);
        break;
      case "slide-up":
        slide([W / 2, H / 2 + H], [W / 2, H / 2 - H]);
        break;
      case "slide-down":
        slide([W / 2, H / 2 - H], [W / 2, H / 2 + H]);
        break;
      case "wipe":
        // revealed from the left edge; what is still hidden is the right-hand part
        next.effects = [
          ...(next.effects ?? []),
          {
            match: "ADBE Linear Wipe",
            props: {
              "ADBE Linear Wipe-0001": keys({ f: t0, v: 100 }, { f: t1, v: 0 }),
              "ADBE Linear Wipe-0002": 270,
              "ADBE Linear Wipe-0003": 0,
            },
          },
        ];
        break;
      case "flash": {
        // the next shot appears at 40% under a warm white that peaks there and fades out
        next.transform = {
          ...next.transform,
          opacity: keys({ f: t0, v: 0, interp: "hold" }, { f: t0 + Math.ceil(0.4 * N), v: 100 }),
        };
        overlays[i + 1].push({
          kind: "solid",
          name: `Flash ${id}`,
          color: parseColor(FLASH_COLOR).rgb,
          width: W,
          height: H,
          in: t0,
          out: t1,
          transform: { opacity: keys({ f: t0, v: 0 }, { f: round(t0 + 0.4 * N), v: 100 }, { f: t1, v: 0 }) },
        });
        break;
      }
      case "warm-sweep": {
        // reveal: linear-gradient(100deg, black edge-40%, transparent edge%), edge from -40% to 140%
        const matte = `Sweep matte ${id}`;
        overlays[i + 1].push({
          kind: "solid",
          name: matte,
          color: [1, 1, 1],
          width: W,
          height: H,
          in: t0,
          out: next.out,
          enabled: false,
          effects: [
            {
              match: "ADBE Ramp",
              props: {
                "ADBE Ramp-0001": keys({ f: t0, v: along(-80) }, { f: t1, v: along(100) }),
                "ADBE Ramp-0002": [1, 1, 1],
                "ADBE Ramp-0003": keys({ f: t0, v: along(-40) }, { f: t1, v: along(140) }),
                "ADBE Ramp-0004": [0, 0, 0],
                "ADBE Ramp-0005": 1,
              },
            },
          ],
        });
        next.matte = { layer: matte, type: "luma" };
        // glow: linear-gradient(100deg, transparent edge-34%, rgba(255,190,100,.45) edge-14%,
        // rgba(255,232,180,.75) edge-5%, transparent edge+6%), screened at opacity sin(pi * progress).
        // Screening a colour with alpha a = screening the premultiplied colour, so the glow is an opaque gradient
        // black -> P1 -> P2 -> black. AE scripts can't set multi-stop gradients, so it is built from three
        // two-stop Gradient Ramps: rise (normal), peak (add), fall (subtract).
        const P1 = parseColor("#ffbe64").rgb.map((c) => round(c * 0.45)) as RGB;
        const P2 = parseColor("#ffe8b4").rgb.map((c) => round(c * 0.75)) as RGB;
        const glowRamp = (name: string, from: number, to: number, color: RGB, blend?: "add" | "subtract"): Layer => ({
          kind: "solid",
          name,
          color: [0, 0, 0],
          width: W,
          height: H,
          in: 0,
          out: N,
          ...(blend && { blend }),
          effects: [
            {
              match: "ADBE Ramp",
              props: {
                "ADBE Ramp-0001": keys({ f: 0, v: along(-40 + from) }, { f: N, v: along(140 + from) }),
                "ADBE Ramp-0002": [0, 0, 0],
                "ADBE Ramp-0003": keys({ f: 0, v: along(-40 + to) }, { f: N, v: along(140 + to) }),
                "ADBE Ramp-0004": color,
                "ADBE Ramp-0005": 1,
              },
            },
          ],
        });
        const glow: Comp = {
          id: `glow:${id}`,
          name: `Sweep glow ${id}`,
          width: W,
          height: H,
          fps,
          frames: N,
          folder: "Transitions",
          layers: [
            glowRamp("Glow fall", -5, 6, P2, "subtract"),
            glowRamp("Glow peak", -14, -5, P2.map((c, k) => round(c - P1[k])) as RGB, "add"),
            glowRamp("Glow rise", -34, -14, P1),
          ],
        };
        transitionComps.push(glow);
        const T = N / fps;
        const speed = round((100 * Math.PI) / T, 2);
        overlays[i + 1].unshift({
          kind: "comp",
          comp: glow.id,
          in: t0,
          out: t1,
          start: t0,
          blend: "screen",
          transform: {
            opacity: keys(
              { f: t0, v: 0, ease: { out: [speed, 33.33] } },
              { f: round(t0 + N / 2), v: 100, ease: { in: [0, 33.33], out: [0, 33.33] } },
              { f: t1, v: 0, ease: { in: [-speed, 33.33] } },
            ),
          },
        });
        break;
      }
    }
  });
  shotLayers.forEach((l, i) => {
    if (positionKeys[i].length) {
      l.transform = { ...l.transform, position: { keys: positionKeys[i].sort((a, b) => a.f - b.f) } };
    }
  });

  // ------------------------------------------------------------ audio (Episode.tsx)

  const audio: Layer[] = [];
  const vo = t.audio?.voiceoverVolume ?? 1;
  shots.forEach((s) => {
    if (!s.shot.voiceover) return;
    const at = s.from + Math.round((s.shot.voiceoverDelay ?? 0) * fps);
    if (at >= totalFrames) return notes.push(`${s.shot.id}: voiceover starts after the end, left out`);
    audio.push({
      kind: "footage",
      name: `VO ${s.shot.id}`,
      footage: use(s.shot.voiceover, `shot ${s.shot.id}`).id,
      in: at,
      audio: { enabled: true, levels: [db(vo), db(vo)] },
    });
  });
  if (t.audio?.voiceover) {
    audio.push({
      kind: "footage",
      name: "Voiceover",
      footage: use(t.audio.voiceover, "audio.voiceover").id,
      in: 0,
      audio: { enabled: true, levels: [db(vo), db(vo)] },
    });
  }
  if (t.audio?.music) {
    // linear volume fade over the last 1.5s, sampled because AE interpolates levels in dB
    const volume = t.audio.musicVolume ?? 0.5;
    const fadeStart = totalFrames - 1.5 * fps;
    const samples = 8;
    const levels: Key<Vec>[] = [];
    for (let k = 0; k <= samples; k++) {
      const f = round(fadeStart + (k / samples) * (totalFrames - fadeStart), 2);
      if (f < 0) continue;
      const v = db(volume * (1 - k / samples));
      levels.push({ f, v: [v, v] });
    }
    audio.push({
      kind: "footage",
      name: "Music",
      footage: use(t.audio.music, "audio.music").id,
      in: 0,
      audio: { enabled: true, levels: levels.length > 1 ? { keys: levels } : [db(volume), db(volume)] },
    });
  }

  if (errors.length) throw new Error(errors.join("\n"));

  const layers: Layer[] = [...audio];
  for (let i = shots.length - 1; i >= 0; i--) layers.push(...overlays[i], shotLayers[i]);
  layers.push({ kind: "solid", name: "Background", color: [0, 0, 0], width: W, height: H, in: 0, out: totalFrames });

  const name = (t.title ?? path.basename(p.dir)) + (p.lang ? ` (${p.lang})` : "");
  const main: Comp = { id: "main", name, width: W, height: H, fps, frames: totalFrames, bg: [0, 0, 0] as RGB, layers };
  const scene: Scene = {
    version: 1,
    name,
    footage: [...footage.values()].map(({ info: _info, ...f }) => f),
    comps: [...comps, ...transitionComps, main],
    main: main.id,
  };
  return { scene, notes };
}
