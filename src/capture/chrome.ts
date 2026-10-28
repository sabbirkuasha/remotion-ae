// Headless Chrome over the DevTools protocol (Node's built-in WebSocket, no extra dependencies).
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

// Close to Remotion's own flags, so captured frames render like `remotion render`.
const FLAGS = [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--hide-scrollbars",
  "--mute-audio",
  "--no-first-run",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--force-color-profile=srgb",
  "--font-render-hinting=none",
  "--allow-running-insecure-content",
  "--no-proxy-server",
];

export class Chrome {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Map<string, ((params: any) => void)[]>();
  private proc: ChildProcess;
  private profile: string;
  private constructor(proc: ChildProcess, profile: string) {
    this.proc = proc;
    this.profile = profile;
  }

  static async launch(executable: string): Promise<Chrome> {
    const profile = mkdtempSync(path.join(tmpdir(), "remotion-ae-chrome-"));
    const proc = spawn(executable, [...FLAGS, "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const chrome = new Chrome(proc, profile);
    const browserUrl = await new Promise<string>((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error(`Chrome did not start: ${buf.slice(-500)}`)), 30_000);
      proc.stderr!.on("data", (d) => {
        buf += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      proc.on("exit", (code) => reject(new Error(`Chrome exited (${code}): ${buf.slice(-500)}`)));
    });
    // talk to the first page target directly
    const port = new URL(browserUrl).port;
    const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("Chrome has no page target");
    chrome.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      chrome.ws.addEventListener("open", resolve);
      chrome.ws.addEventListener("error", () => reject(new Error("could not connect to Chrome")));
    });
    chrome.ws.addEventListener("message", (ev) => chrome.onMessage(String(ev.data)));
    return chrome;
  }

  private onMessage(data: string) {
    const msg = JSON.parse(data);
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message} ${msg.error.data ?? ""}`));
      else p.resolve(msg.result);
    } else if (msg.method) {
      for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
    }
  }

  send<T = any>(method: string, params: object = {}): Promise<T> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, fn: (params: any) => void) {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn]);
  }

  /** Evaluate an expression in the page; returns its (JSON) value, awaiting promises. Page errors are thrown here. */
  async evaluate<T = any>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`in page: ${d.exception?.description ?? d.text}`);
    }
    return r.result.value as T;
  }

  async close() {
    try {
      this.ws.close();
    } catch {}
    this.proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(this.profile, { recursive: true, force: true });
  }
}
