# remotion-ae

**Turn a Remotion video into an After Effects project you can keep editing.**

[Remotion](https://www.remotion.dev) videos are React code, and After Effects can't open them. The only official
bridge goes the other way (After Effects → Lottie → Remotion). remotion-ae goes from Remotion to After Effects:
pick a Remotion project in an After Effects panel, click Import, and the animation is rebuilt as real comps,
layers, keyframes and masks, not as a flattened render.

- **For After Effects users:** a panel inside After Effects. No terminal, no Remotion knowledge needed.
- **For Remotion developers:** one command that writes an After Effects script your designers can run.

Windows only for now (macOS is planned).

## Install

You need **Windows 10 or 11**, **After Effects** (tested with After Effects 2026) and **Node.js** (free; the
panel uses it to read Remotion projects). Setup takes about five minutes.

1. **Install Node.js.** Go to [nodejs.org](https://nodejs.org), download the **LTS** version (22.18 or newer)
   and run the installer with its default settings.
2. **Download remotion-ae.** Open the [latest release](https://github.com/sabbirkuasha/remotion-ae/releases/latest)
   and, under **Assets**, click **`remotion-ae-<version>-windows.zip`**. (Not "Source code": that is the
   developer version.)
3. **Extract it.** Right-click the downloaded zip > **Extract All…** > Extract.
4. **Run the installer.** In the extracted folder, double-click **`Install.cmd`**.
   - Windows may warn about a downloaded file: click **More info > Run anyway** (or **Run**).
   - If After Effects is installed under Program Files, Windows asks for administrator permission to add the
     panel: click **Yes**.
   - The window ends with **Done**. Press a key to close it. The downloaded folder can be deleted now.
5. **Allow scripts to write files.** In After Effects: **Edit > Preferences > Scripting & Expressions**, turn on
   **Allow Scripts to Write Files and Access Network**, click OK.
6. **Restart After Effects** and open **Window > Remotion Importer.jsx**. Dock the panel wherever you like.

The installer copies remotion-ae to `%LOCALAPPDATA%\remotion-ae` and adds `Remotion Importer.jsx` to every
installed After Effects version (`…\Support Files\Scripts\ScriptUI Panels`).

**Update:** download the new release and run its `Install.cmd`. It replaces the old version; your imports are
not affected.

**Uninstall:** run `Uninstall.cmd` from any release download, then restart After Effects. (By hand: delete
`%LOCALAPPDATA%\remotion-ae` and `Remotion Importer.jsx` in After Effects' `Scripts\ScriptUI Panels` folder.)

## Import an animation

You need the Remotion project's folder (the one with `package.json`, from whoever made the animation).

1. In After Effects, open the project you want to import into (or start a new one).
2. Open **Window > Remotion Importer.jsx**.
3. **Project:** click **Browse…** and choose the Remotion project's folder.
   The first time, the panel may say the project's dependencies are not installed: click
   **Install the project's dependencies** and wait a few minutes (needs internet). Reading the project the
   first time also takes a little longer while Remotion downloads the browser it renders with.
4. **Composition:** pick the animation from the list (the list is read from the project).
5. **Quality:** 2x is sharp and the default; 3x if you plan to scale layers up a lot.
6. Click **Import into this project.** A progress bar follows the export (about a minute for a 9-second
   animation). The layers then appear in the open project.

**Edit > Undo** removes an import in one step. Leave **Replace an earlier import** off unless you want the
previous import of that composition (and any edits to it) replaced.

The layer images are written to `out/after-effects/` inside the Remotion project, and the After Effects project
uses them as footage: keep that folder with the project.

### What you get

- **Layers:** every element that moves, appears or disappears becomes a layer, named after its `<Sequence>`
  (as in the Remotion Studio timeline). A sequence with several layers becomes a precomp. Everything that never
  changes is one "Static" layer at the bottom.
- **Motion:** position, scale, rotation and opacity keyframes around the element's transform origin.
- **Timing:** in and out points from when each element is on screen.
- **Masks and blend modes:** animated clip paths become animated masks; blend modes become After Effects blend
  modes.
- **Artwork:** each layer's look is a transparent image rendered by Chrome at 2x, so it looks exactly like
  Remotion.

For now the artwork is an image (editable shapes and text come later), eased motion gets a keyframe per frame
(simplified later), and HTML elements get position only (SVG gets full transforms). See [Status](#status).

### Troubleshooting

| The panel says / you see | Do this |
|---|---|
| Windows warns before running `Install.cmd` | Normal for a downloaded script: **More info > Run anyway**. |
| "Node.js is not installed" or "too old" | Install the LTS version from [nodejs.org](https://nodejs.org), then restart After Effects. |
| "Turn on … Allow Scripts to Write Files and Access Network" | Step 5 of [Install](#install). |
| No **Remotion Importer.jsx** in the Window menu | Restart After Effects. Still missing: run `Install.cmd` again and check it printed `installed:` for your version. |
| "could not write …" during install | Run `Install.cmd` again and click **Yes** at the administrator prompt. |
| "remotion-ae was not found at …" | Run `Install.cmd` from the download again. |
| "That folder has no package.json" | Choose the project's main folder, the one that contains `package.json`. |
| The import fails | The panel shows the last lines of the error. Please [open an issue](https://github.com/sabbirkuasha/remotion-ae/issues) with them. |

## Status

The goal is **any Remotion animation, unchanged**: the person who made it runs one export, and an After Effects
user takes it from there without learning Remotion.

| Phase | What it covers | State |
|---|---|---|
| 1 | Projects made with **remo**, a Remotion player driven by a `timeline.json` | working, verified against Remotion renders |
| 2 | **Any Remotion project**: capture every element on every frame while it plays, rebuild it as layers | working on the first real project (SSIM 0.9998+); more test projects next |
| 3–5 | Clean eased keyframes, editable vectors and text, a video fallback for canvas/WebGL, audio | planned |
| 6 | **three.js** scenes rebuilt in After Effects 3D: camera, lights, models, animation | planned |

Details: [docs/goal.md](docs/goal.md), [docs/plan.md](docs/plan.md), [docs/progress.md](docs/progress.md).

## Command line (for Remotion developers)

The panel runs the same export; you can also run it yourself and hand the script to an After Effects user.

```
git clone https://github.com/sabbirkuasha/remotion-ae.git
cd remotion-ae
npm install
npm run capture -- <remotion project> --composition <id> [--entry src/index.ts] [--out dir] [--scale 2] [--run] [--replace]
npm run capture -- <remotion project> --list
```

This writes `<remotion project>/out/after-effects/<id>.jsx` plus `layers/`. In After Effects: **File > Scripts >
Run Script File…** and pick the `.jsx`. Keep `layers/` next to it.

The Remotion project needs its own `npm install` (capture uses the project's Remotion version). Capture opens
the composition the way `remotion render` does and steps through every frame. `--run` builds it right away in
the running After Effects; `--replace` makes the script delete an earlier import of the same composition first.

To use the panel from a clone instead of a release, run `npm run install-panel`. The panel then points at the
clone, so `git pull` updates it.

## remo projects

remo is a Remotion player whose whole edit is a `timeline.json`. Its projects export without capture:

```
npm run export -- my-video/        →  my-video/renders/after-effects.jsx
```

### What you get in After Effects (remo)

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

### Exporting (remo)

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

Besides Node.js and After Effects, the remo exporter needs:
- **ffmpeg** on the PATH (`ffprobe` reads image and video sizes and lengths while exporting).
- **Fonts**: Segoe UI, Georgia and Nirmala UI, the fonts remo uses. They come with Windows. On a Mac, After
  Effects substitutes other fonts and text sizes and line breaks will differ.

### The remo project format

remo is a separate project. Exporting doesn't need it installed, only the project folder:

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

### Limitations (remo)

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
 any Remotion project ─► capture ─┐
                                   ├─► Scene ─► .jsx ─► After Effects builds the project
 remo timeline.json ──► adapter ──┘   plain JSON   builder runtime (ExtendScript)
```

- **Scene** ([src/ir.ts](src/ir.ts)) is a plain-data description of an After Effects project: footage, comps,
  layers, keyframes, effects, masks, text and expressions. Every source produces a Scene, and one builder turns any
  Scene into After Effects items, so new sources never touch the After Effects side.
- **Builder** ([ae/builder.jsx](ae/builder.jsx)) is ExtendScript (ES3) that runs inside After Effects. The exported
  `.jsx` is the builder plus the Scene, ASCII-only so any system locale reads it correctly.
- **Capture** ([src/capture/](src/capture)) bundles the project with its own Remotion, opens the composition in
  headless Chrome in render mode, steps through every frame and measures every element.
- **remo adapter** ([src/remo/adapter.ts](src/remo/adapter.ts)) mirrors remo's components number for number:
  the same timings, camera moves, font sizes and line heights, and caption baselines placed with the fonts'
  real ascent and descent, where Chrome puts them.
- **Panel** ([ae/RemotionImporter.jsx](ae/RemotionImporter.jsx)) runs capture in the background with Node.js,
  follows its progress, and builds the result into the open project.

## Checking it against Remotion

```
npm run compare -- <remo project> [--lang bn] [--frames 0,45,90]
npm run compare-capture -- <remotion project> --composition <id> [--every 15]
```

These build the project in After Effects, render the same frames there and with Remotion, and score each pair
(SSIM, 1 = identical). They write side-by-side images (Remotion | After Effects | difference) and a report to
`test-output/<project>/`. They need After Effects running; `compare` also needs the remo player checked out next
to this repository (`../remo`, or `--remo <path>`).

Results for the current version (scored at quarter size, where image-decoding differences disappear):

| project | frames | result |
|---|---|---|
| remo `examples/rickshaw` | 11 | all match (0.990 to 0.997) |
| [fixtures/vertical](fixtures/vertical) (1080x1920) | 11 | all match (0.981 to 0.998) |
| [fixtures/features](fixtures/features) | 16 | 14 match (0.990 to 0.9996); 2 show remo's contained-clip bug |
| a real Illustrator design animated in Remotion (capture) | 68 | all match (0.9998 to 1.0000) |

## Development

```
npm run typecheck
npm run export  -- <project> [--run] [--replace]
npm run compare -- <project>
npm run ae      -- <script.jsx>          run any ExtendScript in the running After Effects and print its result
node tools/inspect.ts "<folder in AE>"   print a built project's layers, timing, keyframes, effects and audio
node tools/test-panel.ts <remotion project> [composition]   drive the panel end to end in After Effects
npm run package                          build the release download, dist/remotion-ae-<version>-windows.zip
```

- `src/`: exporter and capture. `ae/`: the After Effects side (builder and panel). `tools/`: comparison,
  inspection, calibration, packaging. `packaging/`: `Install.cmd` and `Uninstall.cmd` for the download.
- After Effects needs **Preferences > Scripting & Expressions > Allow Scripts to Write Files and Access Network**
  turned on for the tools (they read results and frames back through files).
- The bridge finds the newest After Effects through the registry; set `AFTERFX` to the path of `AfterFX.exe` to
  choose another.
- After changing the adapter or builder, run `compare` on both fixtures and remo's rickshaw example, and look at
  any flagged frame's side-by-side image.

[CLAUDE.md](CLAUDE.md) has working notes on After Effects scripting quirks found along the way.

### Releasing a new version

1. Set `"version"` in `package.json` (for example `0.2.0`) and commit.
2. Tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.

The [Release workflow](.github/workflows/release.yml) then type-checks, builds
`remotion-ae-0.2.0-windows.zip`, and publishes the release with the zip and install notes. Creating the release
on github.com with a new `v…` tag works too: the zip is added to it. To try a build without publishing, run the
workflow by hand (Actions > Release > Run workflow) and download the zip from the run's artifacts.

## Contributing

Issues and pull requests are welcome, especially reports of projects that don't come across right (with the
Remotion project or `timeline.json` and, if you can, the compare images) and tests on other After Effects
versions or on macOS.

## Credits

The fixture images were made by the author with AI image generators (Codex and Gemini). The fixture audio is test
tones generated with ffmpeg.

## License

[MIT](LICENSE) © [Sabbir Hossain](https://sabbirz.com)
