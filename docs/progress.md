# Progress

Newest first. Status of each phase is in [plan.md](plan.md).

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
3. **Phase 2 scope** (Remotion components, see [plan.md](plan.md)) when you are ready.
