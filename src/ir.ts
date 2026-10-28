// Scene: a plain-data description of an After Effects project.
// Adapters (remo timelines now, Remotion components later) produce a Scene; ae/builder.jsx builds it in AE.
// All times are frames in the comp the value belongs to (fractions allowed), all sizes are pixels.

export type RGB = [number, number, number]; // 0-1
export type RGBA = [number, number, number, number];
export type Vec = number[];

export type Interp = "linear" | "hold" | "bezier";
/** Temporal ease at a keyframe: speed (value units per second) and influence (%), per direction. */
export type Ease = { in?: [number, number]; out?: [number, number] };
export type Key<V> = { f: number; v: V; interp?: Interp; ease?: Ease };

/** A property value: constant, keyframed, or an expression (with an optional base value). */
export type Anim<V> = V | { keys: Key<V>[] } | { expr: string; v?: V };

export type MaskPath = { vertices: [number, number][]; closed: boolean };

export type Scene = {
  version: 1;
  /** Name of the project folder everything is created in. */
  name: string;
  footage: Footage[];
  /** Precomps before the comps that use them. */
  comps: Comp[];
  /** Id of the comp to open when the build finishes. */
  main: string;
};

export type Footage = {
  id: string;
  /** Absolute path. */
  file: string;
  /** Path relative to the generated .jsx, tried first so a moved project folder still works. */
  rel?: string;
  /** Folder path inside the scene folder, e.g. "Footage/images". */
  folder?: string;
};

export type Comp = {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  folder?: string;
  bg?: RGB;
  /** Top layer first. Names must be unique within a comp (expressions and mattes refer to them). */
  layers: Layer[];
};

export type Transform = {
  anchor?: Anim<Vec>;
  position?: Anim<Vec>;
  /** Percent, [x, y]. */
  scale?: Anim<Vec>;
  rotation?: Anim<number>;
  /** 0-100. */
  opacity?: Anim<number>;
};

export type BlendMode =
  | "normal" | "screen" | "add" | "subtract" | "multiply" | "overlay" | "darken" | "lighten" | "color-dodge"
  | "color-burn" | "hard-light" | "soft-light" | "difference" | "exclusion" | "hue" | "saturation" | "color"
  | "luminosity";

export type Effect = {
  /** AE match name, e.g. "ADBE Gaussian Blur 2". */
  match: string;
  name?: string;
  /** Keyed by parameter match name. Colours may be RGB or RGBA. */
  props: Record<string, Anim<number | Vec>>;
};

export type Mask = {
  path: Anim<MaskPath>;
  feather?: Anim<Vec>;
  opacity?: Anim<number>;
  expansion?: Anim<number>;
  mode?: "add" | "subtract" | "intersect" | "none";
  inverted?: boolean;
};

export type TextSpec = {
  text: string;
  /** PostScript name. */
  font: string;
  size: number;
  fill: RGB;
  justify: "left" | "center" | "right";
  /** Line spacing in pixels; omitted = auto leading. */
  leading?: number;
  fauxItalic?: boolean;
  /**
   * Characters matching `chars` (regex character class body, e.g. "\\u0980-\\u09FF") use `font` instead,
   * optionally slanted (browsers fake italic for fonts without one).
   */
  scriptFonts?: { chars: string; font: string; fauxItalic?: boolean }[];
  /** Use the South Asian / Middle Eastern text engine (needed to shape Bangla, Devanagari, Arabic...). */
  universalEngine?: boolean;
  /** Break lines at spaces so no line is wider than this (measured in AE). Point text stays point text. */
  wrapWidth?: number;
};

export type ShapeSpec = {
  kind: "rect";
  name?: string;
  size: Anim<Vec>;
  position: Anim<Vec>;
  roundness?: Anim<number>;
  fill: RGB;
  fillOpacity?: Anim<number>;
};

type LayerBase = {
  name?: string;
  /** Visible range, [inFrame, outFrame). outFrame omitted = end of the source (clamped to the comp). */
  in: number;
  out?: number;
  /** Comp frame where the source's own time 0 sits (footage/precomps). Default = `in`. */
  start?: number;
  transform?: Transform;
  blend?: BlendMode;
  effects?: Effect[];
  masks?: Mask[];
  /** Use another layer of the same comp (by name) as this layer's track matte. */
  matte?: { layer: string; type: "alpha" | "alpha-inverted" | "luma" | "luma-inverted" };
  /** false = video switched off (e.g. a matte source). */
  enabled?: boolean;
  /** Collapse transformations (precomps: inner blend modes then act on the layers below, like CSS blending). */
  collapse?: boolean;
  /** Audio on/off and level in dB ([left, right]). */
  audio?: { enabled: boolean; levels?: Anim<Vec> };
  comment?: string;
};

export type Layer = LayerBase &
  (
    | { kind: "footage"; footage: string }
    | { kind: "comp"; comp: string }
    | { kind: "solid"; color: RGB; width: number; height: number }
    | { kind: "text"; text: TextSpec }
    | { kind: "shape"; shapes: ShapeSpec[] }
  );
