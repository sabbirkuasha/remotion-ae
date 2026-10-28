# remotion-ae: export Remotion projects to After Effects

Built in phases; the user defines what each phase covers. Keep `docs/` current:
`docs/goal.md` (what and why), `docs/plan.md` (phases, architecture), `docs/progress.md` (dated log, decisions,
what is waiting on the user). Update progress.md whenever a piece of work lands.

## Layout

```
src/ir.ts            Scene: plain-data AE project (footage, comps, layers, keyframes, effects, text). The contract.
ae/builder.jsx       ExtendScript (ES3) that builds a Scene inside After Effects
src/jsx.ts           Scene -> self-contained .jsx (builder + data, ASCII only)
src/remo/            remo adapter: timeline.json -> Scene (schema.ts/timing.ts are copies of remo's; keep in sync)
src/capture/         any Remotion project -> Scene: chrome.ts (DevTools client), remotion-page.ts (open a
                     composition in render mode, seek frames), page.js (in-page tracker/measurer), capture.ts
ae/RemotionImporter.jsx   the After Effects panel (ScriptUI): runs capture-cli in the background (hidden, via a VBScript
                     launcher), polls its --progress status file, builds the result with $.evalFile
src/install-panel.ts copies the panel into each AE's Scripts/ScriptUI Panels, with the remotion-ae path filled in;
                     --app-dir copies remotion-ae there first, --uninstall removes it; elevates through UAC if needed
packaging/           Install.cmd / Uninstall.cmd: the double-click setup in the release download
tools/package.ts     builds the release download dist/remotion-ae-<version>-windows.zip (ae/, src/, the .cmd files)
.github/workflows/release.yml   on a v* tag: typecheck, package, attach the zip to the GitHub release
src/bridge.ts        run a .jsx in the running After Effects and get the result back
tools/compare.ts     render the same frames in Remotion (via ../remo) and AE, score them, write side-by-sides
tools/inspect.ts     print a built project's structure (layers, timing, keyframes, effects, audio levels)
tools/calibrate-blur.ts   how AE_BLUR_PER_CSS_BLUR was found; tools/purge.jsx frees AE's caches
fixtures/            test projects (features: every remo feature; vertical: 1080x1920)
```

## Commands

```
npm run capture -- <remotion project> --composition <id> [--run] [--replace]      any Remotion project -> AE
npm run capture -- <remotion project> --list [--progress status.json]             list compositions
npm run install-panel                                                           install the AE panel
node tools/test-panel.ts <remotion project> [composition]                       drive the panel end to end in AE
npm run compare-capture -- <remotion project> --composition <id> [--every 15]    captured vs Remotion, test-output/<id>/
npm run export  -- <remo project> [--lang bn] [--out f.jsx] [--run] [--replace]   remo timeline -> AE script
npm run compare -- <remo project> [--lang bn] [--frames 0,45]                    Remotion vs AE, test-output/<name>/
npm run ae      -- <script.jsx>                                                  run any script in AE
npm run package                                                                 release zip in dist/
npm run typecheck
```

Most users install from the GitHub release zip (README "Install"), not a clone. The panel and capture must keep
working from it: no runtime dependencies in that path (zod is only for the remo exporter), nothing outside
`ae/` and `src/`. A release is a `v<version>` tag matching package.json; the workflow builds and publishes it.

After changing the adapter or builder: `npm run typecheck`, then `npm run compare` on `../remo/examples/rickshaw`,
`fixtures/features` and `fixtures/vertical`, and look at the flagged images in `test-output/<name>/compare/`.
The "view" score (quarter size) is the one that matters; "pixel" differs a little anyway because Chrome and AE
decode and resample images differently.

## Driving After Effects

The bridge (Windows) uses the newest After Effects listed in the registry
(`HKLM\SOFTWARE\Adobe\After Effects\<version>\InstallPath`); `AFTERFX` overrides the path to `AfterFX.exe`.
Don't scan drive letters for it: checks on network/RDP drives can hang. Developed against After Effects 2026 (26.5),
usually already running.

- A script's last expression is its result; a thrown error comes back with file and line.
- Dialogs are suppressed while it runs. A timeout usually means a modal dialog is open in AE.
- Check things visually with `comp.saveFrameToPng(seconds, new File(path))` and Read the PNG. It returns before
  the file is written: wait for complete PNGs (`tools/png.ts`). Purge afterwards (`tools/purge.jsx`), or AE's RAM
  cache grows by gigabytes per run.
- Panel gotchas: `system.callSystem` returns nothing for commands wrapped in `cmd /c` (call executables directly);
  it also blocks AE, so long jobs start hidden through `wscript` + a one-line VBScript and are polled with
  `app.scheduleTask`. Find node.exe by scanning PATH (this machine uses Volta: C:\Program Files\Volta\node.exe);
  `where node` returns nothing inside AE. Use `cmd /v:on` + `!errorlevel!` for exit codes.
- Capture gotchas (see docs/progress.md 2026-10-29): MutationObserver callbacks consume records; visibility
  rules need the `#remotion-canvas` id for specificity; never hide `<defs>`/clip paths; blend modes only mix inside
  their isolated group. Debug in-page state with `window.__ae.debug(ids)` and small probe scripts that use
  `openComposition()`.
- Known remo bug: contained clips (and contained stills with `motion: "none"`) are hidden behind remo's own
  backdrop, so `fixtures/features` frames 0 and 45 are expected to differ until remo is fixed.
- Scripts run in the user's open project. Clean up what tests create (compare uses `replace` to swap its own
  folder), and never save or close the user's project.
- ExtendScript is ES3: no `JSON`, `let`/`const`, arrow functions, `Array.prototype.indexOf/forEach`;
  write `obj["in"]` for reserved words. Property objects go stale when their layer gets new properties:
  re-fetch them instead of keeping references.
- The default font in AE is whatever the user used last: always set fonts explicitly.
- Requires AE Preferences > Scripting & Expressions > "Allow Scripts to Write Files and Access Network" (on).
- Prefer the Bash tool for long runs here; PowerShell sessions have hung on long pipelines.
