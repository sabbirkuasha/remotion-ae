# Plan

## Architecture

```
 remo timeline.json ─┐
                     ├─► adapter ─► Scene (src/ir.ts) ─► .jsx script ─► After Effects builds the project
 (later) React comps ┘              plain JSON, frames     builder runtime     (ae/builder.jsx, ExtendScript)
```

- **Scene IR** (`src/ir.ts`) is the contract: footage, comps, layers, keyframes, effects, masks, text,
  expressions. Every source (remo now, React components later) produces a Scene; one builder turns any
  Scene into After Effects items. New sources never touch the AE side, and AE fixes help every source.
- **Builder** (`ae/builder.jsx`) is plain ExtendScript (ES3) that runs inside After Effects. The exporter writes a
  single self-contained `.jsx`: builder + the Scene as data.
- **Bridge** (`src/bridge.ts`) runs a `.jsx` in the user's running After Effects and returns the result,
  so development and tests are automatic.
- **Compare** (`tools/compare.ts`) renders the same frames with Remotion and with After Effects and scores them
  (SSIM), writing side-by-side images. This is how "looks the same" is checked.

## Phase 1: remo timeline → After Effects  *(built and verified; waiting for the user's review)*

Everything a remo `timeline.json` can express:

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

**Done when:** the rickshaw example and a fixture that uses every feature export with no errors,
compare with high similarity at every checked frame (shot middles, transitions, caption fades, titles),
and the result is easy to edit in After Effects.

Command: `npm run export -- <remo project> [--lang bn] [--run]`. It writes
`<project>/renders/<name>.ae.jsx`; `--run` also builds it in the running After Effects.

## Phase 2: Remotion components  *(to be defined with the user)*

npm package with components (`<AeComp>`, `<AeImage>`, `<AeVideo>`, `<AeText>`, `<AeSolid>`, `<AeAudio>`…)
that render in Remotion and record a Scene while rendering. Export from any Remotion project built with them.

## Phase 3: render-to-layers fallback  *(to be defined)*

Anything not built with the components is rendered by Remotion per `<Sequence>` as transparent video
(ProRes 4444 / PNG sequence) and placed in After Effects at the right time.

## Later ideas

Easing curves, nested sequences, masks and shapes, audio comparison, an AE panel for one-click import,
saving a ready `.aep`.
