# remotion-ae

**Turn a Remotion video into an After Effects project you can keep editing.**

[Remotion](https://www.remotion.dev) videos are React code, and After Effects can't open them. The only official
bridge goes the other way (After Effects → Lottie → Remotion). remotion-ae goes from Remotion to After Effects:
it writes one script that rebuilds the video in After Effects as real comps, text layers, keyframes and effects,
not as a flattened render.

```
npm run export -- my-video/        →  my-video/renders/after-effects.jsx
After Effects: File > Scripts > Run Script File…  →  the whole edit, ready to work on
```

## Status

| Phase | What it covers | State |
|---|---|---|
| 1 | Projects made with **remo**, a Remotion player driven by a `timeline.json` | working, verified against Remotion renders |
| 2 | Any Remotion project, through remotion-ae components that also describe themselves for After Effects | planned |
| 3 | A render-to-layers fallback for anything the components can't describe | planned |

Details: [docs/goal.md](docs/goal.md), [docs/plan.md](docs/plan.md), [docs/progress.md](docs/progress.md).

## What you get in After Effects

Everything goes into one folder named after the project, inside the project that is open. **Edit > Undo** removes
it again in one step.

```
My video/
  My video          main comp: shots at their times, transitions, audio
  Shots/            one precomp per shot: image or clip, camera move, caption, titles
  Transitions/      helper comps for transitions that need them (warm-sweep glow)
  Footage/          images, clips, audio (same sub-folders as the project's assets/)
  Solids/
```

| In the timeline | In After Effects |
|---|---|
| shot | a precomp, placed at its time in the main comp; overlapping transitions overlap the same way |
| image + `motion` (zoom-in/out, pan-left/right/up/down) | image layer with scale/position keyframes |
| `fit: "contain"` | the whole image over a blurred, darkened copy of itself (Gaussian Blur + Levels) |
| `clip`, `clipStart`, `clipVolume` | footage layer starting `clipStart` into the clip, with its own sound on or off |
| `color` | solid layer |
| `caption` | text layer + rounded box that resizes itself when you edit the text, fading in and out |
| `lines` (closing titles) | one text layer per line, each fading and rising in |
| `fade` | opacity keyframes on the incoming shot |
| `slide-left/right/up/down` | position keyframes on both shots |
| `wipe` | Linear Wipe effect |
| `flash` | the next shot comes up under a warm white solid |
| `warm-sweep` | the next shot revealed through a Gradient Ramp matte, under a screened glow |
| music, voiceover, per-shot voiceovers | audio layers with levels, delays and the music fade-out |
| Bangla (and other Indic scripts) | Nirmala UI for those characters, South Asian text engine |
| `beat` notes | layer comments on the shot layers |

Editing tips:
- **Captions:** just edit the text; the box follows. Its padding and wrap width are sliders on the
  *Caption box* layer. Press Enter in the text for a new line; the caption grows upwards.
- **Camera moves and transitions** are ordinary keyframes: change timing or easing in the graph editor.
- Moving a shot in the main comp moves its caption and titles with it, because they live in the shot's precomp.

## Requirements

- **After Effects**: tested with After Effects 2026 (26.5). Older versions are untested; the script uses recent
  scripting features such as per-character fonts.
- **Node.js 22.18 or newer** (runs the TypeScript sources directly, no build step).
- **ffmpeg** on the PATH (`ffprobe` reads image and video sizes and lengths while exporting).
- **Fonts**: Segoe UI, Georgia and Nirmala UI, the fonts remo uses. They come with Windows. On a Mac, After Effects
  substitutes other fonts and text sizes and line breaks will differ.
- **Windows** for `--run`, `npm run ae` and the comparison tools (they drive After Effects with `AfterFX.exe -r`).
  The exported script itself is plain ExtendScript.

## Install

```
git clone https://github.com/sabbirkuasha/remotion-ae.git
cd remotion-ae
npm install
```

## Use

```
npm run export -- <project folder> [--lang bn] [--out file.jsx] [--run] [--replace]
```

| option | |
|---|---|
| `--lang bn` | export `timeline.bn.json` instead, to `after-effects.bn.jsx`; the folder in AE is named "Title (bn)" |
| `--out file.jsx` | write the script somewhere else (default: `<project>/renders/after-effects.jsx`) |
| `--run` | also build it right away in the running After Effects (Windows) |
| `--replace` | the script first deletes an earlier import of the same project (handy with `--run`) |

Then in After Effects: **File > Scripts > Run Script File…** and pick the `.jsx`.

Keep the script in the project's `renders/` folder. It finds the images, clips and audio relative to itself, so
the whole project folder can be moved or copied to another machine.

The exporter prints a **note** for anything it can't carry over, for example a timeline field it doesn't know.
Nothing is dropped silently.

## The remo project format

remo is a separate project. Exporting doesn't need it installed, only the project folder. A remo project is
a folder:

```
my-video/
  timeline.json     the edit
  assets/           images/, clips/, audio/ (paths in timeline.json are relative to this folder)
  renders/          outputs
```

```json
{
  "title": "My video",
  "fps": 30, "width": 1920, "height": 1080,
  "shots": [
    { "id": "street", "seconds": 4, "image": "images/01_street.jpg", "clip": "clips/01_street.mp4",
      "caption": "Dhaka, 6 AM", "transition": "fade", "transitionSeconds": 0.6 },
    { "id": "r1", "seconds": 3, "image": "images/02_r1.jpg", "motion": "pan-left",
      "caption": "The peacock", "transition": "slide-left" }
  ],
  "audio": { "music": "audio/music.mp3", "musicVolume": 0.4 }
}
```

The full schema, with every shot field, is in [src/remo/schema.ts](src/remo/schema.ts). The two test projects in
[fixtures/](fixtures) use all of it.

## Limitations

- **Local files only.** remo accepts `https://` links for images, clips and audio; the exporter stops with an
  error and asks for the file in `assets/`.
- **remo's contained-clip bug.** remo currently draws the blurred backdrop over a contained clip (and over a
  contained still with `motion: "none"`), so the video is hidden in remo's own render. The export shows what is
  meant: the clip over its backdrop.
- **Not yet verified:** audio by ear (timings and levels are checked), photos with an EXIF rotation, animated
  GIFs, and Indic scripts other than Bangla.
- Images come out very slightly sharper than in Chrome (different decoding and resampling); visible only
  zoomed in to single pixels.

## How it works

```
 remo timeline.json ─┐
                     ├─► adapter ─► Scene ─► .jsx ─► After Effects builds the project
 (later) components ─┘             plain JSON      builder runtime (ExtendScript)
```

- **Scene** ([src/ir.ts](src/ir.ts)) is a plain-data description of an After Effects project: footage, comps,
  layers, keyframes, effects, masks, text and expressions. Every source produces a Scene, and one builder turns any
  Scene into After Effects items, so new sources never touch the After Effects side.
- **Builder** ([ae/builder.jsx](ae/builder.jsx)) is ExtendScript (ES3) that runs inside After Effects. The exported
  `.jsx` is the builder plus the Scene, ASCII-only so any system locale reads it correctly.
- **remo adapter** ([src/remo/adapter.ts](src/remo/adapter.ts)) mirrors remo's components number for number:
  the same timings, camera moves, font sizes and line heights, and caption baselines placed with the fonts'
  real ascent and descent, where Chrome puts them.

## Checking it against Remotion

```
npm run compare -- <project folder> [--lang bn] [--frames 0,45,90]
```

This builds the project in After Effects, renders the same frames there and with remo, and scores each pair (SSIM,
1 = identical). By default it checks every shot's middle, every transition's middle, each closing line arriving,
and the first and last frame. It writes side-by-side images (Remotion | After Effects | difference) and a report to
`test-output/<project>/`. It needs After Effects running and the remo player checked out next to this repository
(`../remo`, or `--remo <path>`).

Results for the current version (scored at quarter size, where image-decoding differences disappear):

| project | frames | result |
|---|---|---|
| remo `examples/rickshaw` | 11 | all match (0.990 to 0.997) |
| [fixtures/vertical](fixtures/vertical) (1080x1920) | 11 | all match (0.981 to 0.998) |
| [fixtures/features](fixtures/features) | 16 | 14 match (0.990 to 0.9996); 2 show remo's contained-clip bug |

## Development

```
npm run typecheck
npm run export  -- <project> [--run] [--replace]
npm run compare -- <project>
npm run ae      -- <script.jsx>          run any ExtendScript in the running After Effects and print its result
node tools/inspect.ts "<folder in AE>"   print a built project's layers, timing, keyframes, effects and audio
```

- `src/`: exporter. `ae/builder.jsx`: the After Effects side. `tools/`: comparison, inspection, calibration.
- After Effects needs **Preferences > Scripting & Expressions > Allow Scripts to Write Files and Access Network**
  turned on for the tools (they read results and frames back through files).
- The bridge finds the newest After Effects through the registry; set `AFTERFX` to the path of `AfterFX.exe` to
  choose another.
- After changing the adapter or builder, run `compare` on both fixtures and remo's rickshaw example, and look at
  any flagged frame's side-by-side image.

[CLAUDE.md](CLAUDE.md) has working notes on After Effects scripting quirks found along the way.

## Contributing

Issues and pull requests are welcome, especially reports of projects that don't come across right (with the
`timeline.json` and, if you can, the compare images) and tests on other After Effects versions or on macOS.

## Credits

The fixture images were made by the author with AI image generators (Codex and Gemini). The fixture audio is test
tones generated with ffmpeg.

## License

[MIT](LICENSE) © [Sabbir Hossain](https://sabbirz.com)
