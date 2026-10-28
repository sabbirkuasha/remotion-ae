# remotion-ae

Turn a Remotion video into an After Effects project you can keep editing: shots become comps, captions stay
editable text, camera moves and transitions become keyframes.

Phase 1 supports projects made with the [remo](../remo) player (`timeline.json`). See [docs/](docs/goal.md)
for the goal, the plan and progress.

## Use

```
npm install
npm run export -- <remo project folder> [--lang bn]
```

This writes `<project>/renders/after-effects.jsx`. In After Effects choose **File > Scripts > Run Script File...**
and pick it. The script builds everything inside a folder named after the project, in the project that is open,
and opens the main comp. **Edit > Undo** removes it again in one step.

Keep the `.jsx` inside the project's `renders/` folder: it finds the images, clips and audio relative to itself,
so the whole project folder can be moved to another machine.

With After Effects already running, `npm run export -- <project> --run` builds it straight away.

## What you get

| In remo | In After Effects |
|---|---|
| shot | a precomp in `Shots/`, placed at its time in the main comp |
| image + motion | image layer with scale/position keyframes |
| `fit: contain` | the contained image over a blurred, darkened copy (Gaussian Blur + Levels) |
| clip | footage layer, offset by `clipStart`, with its sound on or off |
| `color` | solid layer |
| caption | text layer + a rounded box that resizes itself when you edit the text (padding: the box's sliders) |
| closing `lines` | one text layer per line, fading and rising in |
| fade / slide / wipe / flash | opacity, position, Linear Wipe and a warm white solid, all keyframed |
| warm-sweep | the next shot revealed through a Gradient Ramp matte, with a screened glow band |
| music, voiceovers | audio layers with levels (and the music fade-out) |
| Bangla | Nirmala UI for Bangla characters, South Asian text engine |

Fonts: Segoe UI, Georgia and Nirmala UI (all part of Windows).

## Check it against Remotion

```
npm run compare -- <remo project>
```

Renders the same frames with remo and with After Effects and writes side-by-side images and a similarity
score per frame to `test-output/<project>/`. Needs After Effects running, `../remo` with its dependencies installed,
and ffmpeg. In After Effects, turn on Preferences > Scripting & Expressions > "Allow Scripts to Write Files
and Access Network".
