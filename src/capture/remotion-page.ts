// Open a Remotion composition in headless Chrome in render mode, the same way `remotion render` does, using the
// project's own Remotion packages; then seek it frame by frame.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Chrome } from "./chrome.ts";

export type CompositionMeta = { id: string; width: number; height: number; fps: number; durationInFrames: number };

export type OpenComposition = {
  chrome: Chrome;
  meta: CompositionMeta;
  /** Show this frame and wait until Remotion says it is ready (delayRender cleared, fonts loaded). */
  seek(frame: number): Promise<void>;
  close(): Promise<void>;
};

// Where Remotion projects usually keep their entry file (what `remotion studio` looks for without a config).
const ENTRY_CANDIDATES = ["src/index.ts", "src/index.tsx", "src/index.js", "src/index.jsx", "remotion/index.ts", "remotion/index.tsx", "remotion/index.js"];

/** The project's entry file: the one given, else the first usual location that exists. */
export function findEntry(projectDir: string, entry?: string): string {
  if (entry) return entry;
  const found = ENTRY_CANDIDATES.find((e) => existsSync(path.join(projectDir, e)));
  if (!found) throw new Error(`no Remotion entry file found in ${projectDir} (looked for ${ENTRY_CANDIDATES.join(", ")})`);
  return found;
}

function projectRequire(projectDir: string): NodeRequire {
  if (!existsSync(path.join(projectDir, "package.json"))) throw new Error(`${projectDir} is not a Node project (no package.json)`);
  if (!existsSync(path.join(projectDir, "node_modules", "remotion"))) {
    throw new Error(`${projectDir} has no node_modules/remotion; install the project's dependencies first (npm install)`);
  }
  return createRequire(path.join(projectDir, "package.json"));
}

/** Bundle the project with its own Remotion bundler; returns the bundle folder. */
async function bundleProject(req: NodeRequire, projectDir: string, entry: string | undefined): Promise<string> {
  const { bundle } = req("@remotion/bundler");
  return bundle({ entryPoint: path.resolve(projectDir, findEntry(projectDir, entry)), rootDir: projectDir });
}

/** The compositions a project defines. */
export async function listCompositions(projectDir: string, entry?: string): Promise<CompositionMeta[]> {
  const req = projectRequire(projectDir);
  const { getCompositions } = req("@remotion/renderer");
  const serveUrl = await bundleProject(req, projectDir, entry);
  const comps: CompositionMeta[] = await getCompositions(serveUrl, { inputProps: {}, logLevel: "error" });
  return comps.map(({ id, width, height, fps, durationInFrames }) => ({ id, width, height, fps, durationInFrames }));
}

async function findChrome(req: NodeRequire, projectDir: string): Promise<string> {
  const { ensureBrowser } = req("@remotion/renderer");
  const status = await ensureBrowser();
  if (status?.path && existsSync(status.path)) return status.path;
  const fallback = path.join(projectDir, "node_modules", ".remotion", "chrome-headless-shell", "win64", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
  if (existsSync(fallback)) return fallback;
  throw new Error("no Chrome found; run `npx remotion browser ensure` in the project");
}

export async function openComposition(
  projectDir: string,
  entryPoint: string | undefined,
  compositionId: string,
  { scale = 1, log = (s: string) => console.log(s) } = {},
): Promise<OpenComposition> {
  const req = projectRequire(projectDir);
  const { selectComposition, RenderInternals } = req("@remotion/renderer");
  const { NoReactInternals } = req("remotion/no-react");

  log("bundling the project...");
  const bundleDir = await bundleProject(req, projectDir, entryPoint);
  const composition = await selectComposition({ serveUrl: bundleDir, id: compositionId, inputProps: {}, logLevel: "error" });
  const meta: CompositionMeta = {
    id: compositionId,
    width: composition.width,
    height: composition.height,
    fps: composition.fps,
    durationInFrames: composition.durationInFrames,
  };
  const props = NoReactInternals.serializeJSONWithSpecialTypes({ data: composition.props, indent: undefined, staticBase: null }).serializedString;

  const server = await RenderInternals.prepareServer({
    webpackConfigOrServeUrl: bundleDir,
    port: null,
    remotionRoot: projectDir,
    offthreadVideoThreads: 2,
    logLevel: "error",
    indent: false,
    offthreadVideoCacheSizeInBytes: null,
    binariesDirectory: null,
    forceIPv4: false,
    sampleRate: 48000,
  });

  const chrome = await Chrome.launch(await findChrome(req, projectDir));
  chrome.on("Runtime.exceptionThrown", (p) => log(`page error: ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text}`));
  await chrome.send("Page.enable");
  await chrome.send("Runtime.enable");
  await chrome.send("Emulation.setDeviceMetricsOverride", { width: meta.width, height: meta.height, deviceScaleFactor: scale, mobile: false });
  // the globals remotion render sets before the page loads (set-props-and-env.js)
  await chrome.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.remotion_puppeteerTimeout = 30000;
      window.remotion_isMainTab = true;
      window.remotion_mediaCacheSizeInBytes = null;
      window.remotion_initialMemoryAvailable = null;
      window.remotion_sampleRate = 48000;
      if (window.process === undefined) window.process = {};
      if (window.process.env === undefined) window.process.env = {};
      window.process.env.NODE_ENV = 'production';
      window.remotion_broadcastChannel = new BroadcastChannel("remotion-video-frame-extraction");
      window.remotion_inputProps = ${JSON.stringify(props)};
      window.remotion_initialFrame = 0;
      window.remotion_attempt = 1;
      window.remotion_proxyPort = ${server.offthreadPort};
      window.remotion_audioEnabled = false;
      window.remotion_videoEnabled = true;
      window.remotion_logLevel = 'error';`,
  });
  await chrome.send("Page.navigate", { url: server.serveUrl });

  const until = async (expression: string, what: string, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = await chrome.evaluate(expression).catch(() => null);
      if (v === true) return;
      if (typeof v === "string") throw new Error(`Remotion cancelled the render: ${v.split("\n")[0]}`);
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 15));
    }
  };
  const ready = `window.remotion_renderReady === true ? true : (window.remotion_cancelledError ?? false)`;

  await until("typeof window.getStaticCompositions === 'function'", "the Remotion bundle to load");
  await chrome.evaluate(`window.remotion_setBundleMode(${JSON.stringify({
    type: "composition",
    compositionName: compositionId,
    serializedResolvedPropsWithSchema: props,
    compositionDurationInFrames: meta.durationInFrames,
    compositionFps: meta.fps,
    compositionHeight: meta.height,
    compositionWidth: meta.width,
    compositionDefaultCodec: "h264",
    compositionDefaultOutName: null,
    compositionDefaultVideoImageFormat: null,
    compositionDefaultPixelFormat: null,
    compositionDefaultProResProfile: null,
    compositionDefaultSampleRate: null,
  })})`);
  await until(ready, "the composition to render");

  return {
    chrome,
    meta,
    async seek(frame: number) {
      await until(ready, `frame ${frame}`);
      await chrome.evaluate(`window.remotion_setFrame(${frame}, ${JSON.stringify(compositionId)}, 1)`);
      await until(ready, `frame ${frame}`);
      await chrome.evaluate("document.fonts.ready.then(() => true)");
    },
    async close() {
      await chrome.close();
      await server.closeServer();
    },
  };
}
