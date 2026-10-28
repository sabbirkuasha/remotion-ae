# Progress

Newest first. Status of each phase is in [plan.md](plan.md).

## 2026-10-29: release download and step-by-step README

Most people will get remotion-ae from GitHub Releases, not by cloning, so there is now a download:
`remotion-ae-<version>-windows.zip` (`npm run package`) with `ae/`, `src/` and a double-click `Install.cmd`. It
checks Node.js, copies remotion-ae to `%LOCALAPPDATA%\remotion-ae` (so the download can be deleted) and installs the
panel into every After Effects, asking for administrator rights through one UAC prompt only when the panel folder
needs them (Program Files usually does). `Uninstall.cmd` removes both. The panel and capture need no npm packages,
so the download has no `node_modules`. `.github/workflows/release.yml` builds the zip on a `v*` tag and publishes
the release with install notes. GitHub Packages was not used: installing even a public npm package from it needs a
GitHub token, which is no use to After Effects users.

The README now starts with install and import steps for After Effects users, then troubleshooting; the command
line, remo and development sections follow.

Checked: the zip builds; capture lists the test animation's compositions when run from the extracted zip with no
`node_modules`; `Install.cmd`'s flow, messages and Node version check; the UAC command's quoting with spaces and
apostrophes in paths (run without elevation). **Waiting on the user:** running `Install.cmd` from the zip for real
(it writes into After Effects' folder), the UAC path on an After Effects under C:\Program Files, and the first
tagged release.

## 2026-10-29: the After Effects panel (no terminal)

**Remotion Importer** (`ae/RemotionImporter.jsx`), installed with `npm run install-panel`, is the plugin's interface
for After Effects users: choose the Remotion project folder, pick a composition (read from the project), choose
quality, Import. The export runs hidden in the background with a progress bar (After Effects stays responsive) and
the layers are built into the open project. It checks for Node.js (22.18+), the script file-access preference and
the project's dependencies (with a button to install them), and explains what is missing.

Tested end to end by driving the panel through the bridge (`tools/test-panel.ts`): the test animation lists in 5 s
and imports in 62 s (52 layers). Installed into After Effects 2026 on this machine.

## 2026-10-29: Phase 2 capture works on the real test animation

`npm run capture -- <remotion project> --composition <id>` exports any Remotion composition. On the test animation
(a real Illustrator design animated in Remotion; 9 s, ~64,000 SVG elements):

- 46 layers + a static background, in 6 comps: one precomp per `<Sequence>` that holds several layers (RISING,
  THE, STANDARD, Tagline, Bottom bars), named exactly like the Studio timeline (R, I, S…, Green bar…).
- Motion as keyframes (position/scale/rotation/opacity around each element's CSS transform origin), the arrow's
  animated clip path as an animated mask, `<Sequence>` timing as in/out points. Capture takes about 65 s.
- **Remotion vs After Effects: SSIM 0.9998 to 1.0000 on every checked frame** (`npm run compare-capture`).

Fixed along the way (each one found with the comparison and side-by-side images):
- A MutationObserver's callback consumes its records; `takeRecords()` then returns nothing.
- `#remotion-canvas *` (has an id) outranks `[data-ae-show] *` even with `!important`; the show/hide rules need
  the id too.
- Hiding everything also hid clip-path shapes in `<defs>`, and an SVG clip path with hidden shapes clips
  everything away (the ribbons came out empty).
- Element registration has to walk through elements React didn't create, or it misses parts of the tree.
- Blend modes only mix within their nearest isolated group (clip-path, opacity, filter… create one). A blend
  that stays inside its layer is now rendered as part of that layer's artwork (exact); only blends that reach
  outside their layer become separate AE layers with the matching blend mode. This took the ribbons from
  0.97 to 0.9999.
- Each `<Sequence>` boundary starts a layer, even if nothing in it moves (the arrow pieces), so paint order holds.

## 2026-10-28 (night): what the test animation taught about Remotion projects

- **Layers in Remotion are `<Sequence>`s.** Remotion Studio's timeline shows one row per `<Sequence>`; the user
  expects the same elements as separate layers in After Effects. Capture should map each sequence to an AE layer
  (or precomp, when nested) with matching in/out points and names.
- Studio folds sequences created at the same JSX spot (a loop) into one row ("+N, programmatically duplicated").
  Capture should still give each instance its own AE layer.
- Projects that load data into React state after mount (fetch + `delayRender` + `setState`) can misbehave in
  Studio's development mode (remounts); rendering is fine. Capture runs in render mode, like `remotion render`.
- Designers' tricks appear in real files: the test design draws a word twice to weave an arrow through it. The
  animation repaints it in an equivalent order (SSIM 0.9999) so each letter is one layer.

## 2026-10-28 (night): Phase 2 test case, step 1

A real Illustrator design (client work, kept outside this repository) was animated in Remotion from its SVG export,
as the main real-world test case for capture. What it will exercise: about 63,700 SVG shapes (two halftone
ribbons hold 31,800 each), 58 gradients, clipping paths, a drop-shadow filter, colour-dodge blending, a hidden
layer, outlined text animated per letter (CSS transforms on SVG groups), an arrow drawn on with an animated
clip path, a `spring()` scale, and a sine drift. Waiting for the user's review of the animation before capture work.

## 2026-10-28 (late): three.js in scope

three.js animations should be rebuilt with After Effects' own 3D as closely as possible, improving over time
(Phase 6 in [plan.md](plan.md)). Feasibility check passed: a script imported a generated GLB (a cube with a PBR
material) into After Effects 2026 as a 3D model layer, added a camera and a parallel light, set its orientation and
rendered it shaded with the Advanced 3D renderer. Renderers available by script: `ADBE Advanced 3d`,
`ADBE Calder` (Classic 3D), `ADBE Ernst` (Cinema 4D). Next 3D question: the scale between glTF units and pixels.

## 2026-10-28 (late): goal clarified

The primary goal is **any Remotion animation → After Effects, with no changes to the Remotion project**, so After
Effects users never need to learn Remotion. Phase 1 (remo) proved the After Effects side. The plan now builds
**capture**: step through a Remotion composition in Chrome, read every element on every frame, and rebuild it as
layers and keyframes. The earlier idea of special components was dropped: it would make Remotion authors change
their code. Updated [goal.md](goal.md) and [plan.md](plan.md).

## 2026-10-28 (evening): open source

- The repository is public: https://github.com/sabbirkuasha/remotion-ae, MIT license.
- README rewritten for people finding the project: what it does, requirements, usage, the remo format,
  limitations, how it works, how it is verified.
- Nothing machine-specific is left in the code: the bridge finds After Effects through the registry
  (scanning drive letters hung on this machine's Remote Desktop drives), and the calibration tool gets its paths
  from the repository location.
- Timeline fields the exporter doesn't know (e.g. from a newer remo) are now reported as notes instead of being
  dropped silently.

## 2026-10-28 (afternoon): Phase 1 built and matched to Remotion

**Built**
- `npm run export -- <remo project>` writes one self-contained After Effects script; `--run` builds it in the
  running AE. Every remo feature is translated (table in [plan.md](plan.md)).
- `npm run compare -- <remo project>` renders the same frames with remo and with AE and scores them
  (SSIM at quarter size, flagged below 0.98), with side-by-side images in `test-output/<project>/compare/`.
- Test projects: remo's `examples/rickshaw`, plus `fixtures/features` (every other remo feature: clip with
  `clipStart` and sound, contain, Bangla, wrapped caption, flash, warm-sweep, all slides, colour hold, closing
  lines, music, voiceovers) and `fixtures/vertical` (1080x1920).

**Results** (view SSIM, 1 = identical)

| project | frames checked | result |
|---|---|---|
| rickshaw | 11 | all match, 0.990 to 0.997 |
| vertical | 11 | all match, 0.981 to 0.998 |
| features | 16 | 14 match (0.990 to 0.9996); frames 0 and 45 differ because of the remo bug below |

- Captions (box and text, including Bangla and wrapped lines) land within about 1 px of Chrome's.
- Audio checked in the built project: voiceover start times and delays, levels (dB from remo's 0-1 volumes),
  clip sound and `clipStart`, the 9-key music fade-out. Not yet compared by ear.
- The script still finds its files after the project folder is moved (relative paths), and `--lang bn` exports
  `after-effects.bn.jsx` named "<title> (bn)".

**Fixed along the way**
- Blurred backdrop: AE Gaussian Blur "Blurriness" = 2.5 x CSS blur px (`tools/calibrate-blur.ts`).
- Wrapped captions: Remotion's page is border-box, so text wraps at 85% minus padding and the box is 85% wide;
  lines are measured by advance width (as browsers do), not AE's narrower ink bounds.
- Warm-sweep glow: rebuilt exactly from three Gradient Ramps (AE scripts can't set multi-stop gradients).

**Learned about After Effects** (also in CLAUDE.md)
- `comp.saveFrameToPng` returns before the file is written; tools wait for complete PNGs.
- Test renders pile up in AE's RAM cache (it reached 29 GB); tools purge it after each run.
- Image sharpness differs slightly between Chrome and AE (decoding/resampling), visible only at the pixel level.

## 2026-10-28 (morning): setup

- After Effects 2026 (26.5) on this machine can be driven automatically: the bridge runs scripts in the open
  AE and reads back results, errors (with file and line) and rendered frames.
- AE preference "Allow Scripts to Write Files and Access Network" is on (needed by the bridge).
- Checked the AE scripting API for everything Phase 1 needs: per-character fonts and the South Asian text engine
  (Bangla), track mattes, Gradient Ramp, Linear Wipe, Gaussian Blur, Levels, Drop Shadow. All available.
- Fonts used by remo are installed and their metrics read, so text can be placed where the browser places it:
  Segoe UI Bold and Nirmala UI (ascent 1.0791, descent 0.2510 em), Georgia Italic (0.9170 / 0.2192 em).

## Decisions

| decision | why |
|---|---|
| Output is an ExtendScript `.jsx`, not an `.aep` file | `.aep` is an undocumented binary format; a script builds the same project reliably in any AE version |
| The script builds into the open AE project, as one Undo step | running it never closes or overwrites the user's work |
| Each shot becomes a precomp | transitions in remo apply to the whole shot (image + caption), same as a precomp layer |
| Captions use expressions for the box | the box keeps fitting when the text is edited in AE |
| The exporter follows what remo means, not remo's bugs | see the remo bug below |

## Waiting on the user

1. **Review Phase 1 in After Effects.** The three test projects are built in the open AE project
   ("Rickshaw demo", "Features fixture", "Vertical fixture"). Is the structure easy to work with?
2. **remo bug: contained clips are invisible.** In remo's `src/components/Shot.tsx`, a shot with a `clip`,
   `fit: "contain"` and an `image` draws the blurred backdrop *over* the video: the backdrop is
   `position: absolute`, the video is not, and CSS paints positioned elements on top. So only the blurred copy
   shows. The same happens to a contained still with `motion: "none"` (`KenBurns.tsx`); both confirmed by
   rendering with remo. The After Effects export shows the intended result. The fix in remo is small
   (`position: relative` on the video/image). Fix it?
3. **Confirm Phase 2** (capture prototype, see [plan.md](plan.md)), and share any Remotion projects you want
   used as test cases.
