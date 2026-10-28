# Plan

## Architecture

```
 any Remotion project ─► capture (step through frames in Chrome,  ─┐
                          read every element on every frame)       ├─► Scene ─► .jsx ─► After Effects
 remo timeline.json ───► remo adapter (Phase 1)                   ─┘   (src/ir.ts)  (ae/builder.jsx)
```

- **Scene** (`src/ir.ts`) is the contract: footage, comps, layers, keyframes, effects, masks, text, expressions.
  Every source produces a Scene; one builder turns any Scene into After Effects items. New sources never touch the
  After Effects side, and After Effects fixes help every source.
- **Builder** (`ae/builder.jsx`) is plain ExtendScript (ES3) that runs inside After Effects. The exporter writes a
  single self-contained `.jsx`: builder + the Scene as data.
- **Bridge** (`src/bridge.ts`) runs a `.jsx` in the running After Effects and returns the result, so development
  and tests are automatic.
- **Compare** (`tools/compare.ts`) renders the same frames with Remotion and with After Effects and scores them
  (SSIM), writing side-by-side images. This is how "looks the same" is checked, for any Remotion project.

## Phase 1: remo timeline → After Effects  *(done; user review pending)*

Everything a remo `timeline.json` can express, verified frame by frame against remo's renders:

| remo feature | After Effects result |
|---|---|
| project | folder with the main comp, `Shots/` precomps, `Footage/`, `Solids/` |
| shot | precomp per shot, placed at its time in the main comp (transitions overlap like in remo) |
| image + `motion` | image layer, scale/position keyframes (zoom-in/out, pan-*), `fit` cover/contain |
| `fit: contain` | contained image over a blurred, darkened backdrop copy (Gaussian Blur + Levels) |
| clip, `clipStart`, `clipVolume` | footage layer offset by `clipStart`, audio on/off and level |
| `color` | solid layer |
| `caption` | editable text layer + rounded box that resizes to the text (expressions), fade keyframes |
| `lines` | one text layer per line, staggered fade/rise keyframes |
| `fade` | opacity keyframes on the incoming shot |
| `slide-*` | position keyframes on both shots |
| `wipe` | Linear Wipe effect on the incoming shot |
| `flash` | warm white solid + hold keyframes |
| `warm-sweep` | Gradient Ramp luma matte (reveal) + glow precomp of three Gradient Ramps, screened |
| music, voiceover, per-shot voiceover | audio layers with levels, delays, music fade-out |
| Bangla text | Nirmala UI for Bangla characters, South Asian text engine |

Command: `npm run export -- <remo project> [--lang bn] [--run]`, writes `<project>/renders/after-effects.jsx`.

## Proposed next phases  *(to be confirmed with the user)*

The primary goal (see [goal.md](goal.md)) is any Remotion animation, unchanged. So the core becomes **capture**:
open the Remotion project's bundle in Chrome the way Remotion's renderer does, step through the frames, and on each
frame read every element's geometry, transform, opacity, colours, text, SVG, media and timing. Elements keep their
identity across frames, so each one becomes one After Effects layer with keyframes.

### Phase 2: capture prototype

- Step any composition frame by frame and record what is on screen (the riskiest part: hooking into Remotion's
  renderer per frame; prototyped first).
- Boxes and backgrounds (shape layers with rounded corners), text (text layers), images, video, 2D transforms,
  opacity, `<Sequence>` timing (layer in/out points).
- Keyframes on every frame at first.
- Test projects: small Remotion compositions written for this (text, shapes, images, motion), plus remo
  projects captured this way and compared with the Phase 1 export.
- **Done when:** the test projects match in `compare`.

### Phase 3: editable motion

- Reduce per-frame samples to a few keyframes with matching easing (`interpolate`, `Easing.*`, `spring()`).
- Sensible layer names (from text content, component and class names; an optional `data-ae-name` hint).
- Groups that move or fade together become precomps or parented layers.

### Phase 4: vectors and styling

- SVG paths as shape layers with the exact curves, strokes, draw-on animations (Trim Paths), gradients, borders,
  shadows, CSS filters, `overflow: hidden`/`clip-path` as masks or mattes, blend modes.
- Test case: an Illustrator design (SVG + AI + PDF from the user), animated in Remotion.

### Phase 5: fallback and audio

- Anything that can't be rebuilt (canvas, unsupported CSS, and 3D until Phase 6) is rendered by Remotion as
  transparent video and placed as a layer at the right position and time, so nothing is ever missing.
- Audio from Remotion's own audio tracking (sources, start times, volume curves).

### Phase 6: three.js → After Effects 3D

three.js scenes (`@remotion/three`, React Three Fiber) rebuilt with After Effects' own 3D, as closely as possible,
improving over time.

- **Reading the scene:** three.js announces every scene and renderer it creates to a developer-tools hook
  (`__THREE_DEVTOOLS__`); capture listens to it and reads the scene graph on each frame: objects, world
  transforms, geometry, materials, lights and the camera used for rendering. No changes to the project.
- **Rebuilding it** in a comp using the Advanced 3D renderer:

  | three.js | After Effects |
  |---|---|
  | PerspectiveCamera (fov, position, rotation) | camera layer (zoom from the field of view), keyframed |
  | Mesh + geometry + MeshStandardMaterial | 3D model layer from a generated GLB (PBR colour, metalness, roughness, textures) |
  | flat planes, images, text in 3D | native 3D layers where that is simpler to edit |
  | Directional / Point / Spot / Ambient light | parallel / point / spot / ambient light |
  | object animation | 3D position, orientation and scale keyframes |

- Coordinates: three.js is right-handed and Y-up in arbitrary units; After Effects is Y-down in pixels. One
  scale factor per scene keeps the perspective identical.
- Expected to stay approximate for a while: exact lighting and tone mapping, shadows, skinned or morphing
  meshes, particles, custom shaders and post-processing (those use the Phase 5 video fallback).
- **Checked so far (2026-10-28):** a script can import a GLB into After Effects 2026, place it as a 3D model layer
  with orientation, add a camera and a light, and render it with the Advanced 3D renderer.

### Packaging

`npx remotion-ae export <remotion project> --composition <id>`, documentation and examples for both audiences
(Remotion authors and After Effects users).

## Later ideas

CSS 3D transforms as 3D layers, an After Effects panel for one-click import, saving a ready `.aep`, macOS support.
