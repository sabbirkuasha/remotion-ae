// Run ExtendScript inside the running After Effects and get its result back (Windows: AfterFX.exe -r).
// The script's last expression is its result; a thrown error is re-thrown here with file and line.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asciiLiteral } from "./jsx.ts";

/**
 * AFTERFX if set, else the newest installed version according to the registry
 * (HKLM\SOFTWARE\Adobe\After Effects\<version>\InstallPath). Scanning drives instead can hang on network drives.
 */
export function findAfterEffects(): string {
  if (process.env.AFTERFX) return process.env.AFTERFX;
  const found = afterEffectsInstalls();
  if (!found.length) throw new Error("After Effects not found; set AFTERFX to the path of AfterFX.exe");
  return found[0].exe;
}

/** Installed After Effects versions, newest first: version, AfterFX.exe and its "Support Files" folder. */
export function afterEffectsInstalls(): { version: number; exe: string; supportDir: string }[] {
  const r = spawnSync("reg", ["query", "HKLM\\SOFTWARE\\Adobe\\After Effects", "/s", "/v", "InstallPath"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const found: { version: number; exe: string; supportDir: string }[] = [];
  for (const m of (r.stdout ?? "").matchAll(/After Effects\\([\d.]+)\s+InstallPath\s+REG_SZ\s+(.+)/g)) {
    const supportDir = m[2].trim();
    const exe = join(supportDir, "AfterFX.exe");
    if (existsSync(exe)) found.push({ version: parseFloat(m[1]), exe, supportDir });
  }
  return found.sort((a, b) => b.version - a.version);
}

const RUNS = fileURLToPath(new URL("../.runs/", import.meta.url));

const jsxPath = (p: string) => p.replace(/\\/g, "/");

export async function runScript(script: string, { timeoutSec = 120 } = {}): Promise<string> {
  const file = resolve(script);
  if (!existsSync(file)) throw new Error(`no such script: ${file}`);
  const afterEffects = findAfterEffects();
  mkdirSync(RUNS, { recursive: true });
  const id = `${Date.now()}_${process.pid}`;
  const resultPath = join(RUNS, `${id}.json`);
  const wrapperPath = join(RUNS, `${id}.jsx`);
  writeFileSync(
    wrapperPath,
    `(function () {
  function q(s) {
    return '"' + String(s).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"')
      .replace(/\\r/g, "\\\\r").replace(/\\n/g, "\\\\n").replace(/\\t/g, "\\\\t") + '"';
  }
  var body;
  app.beginSuppressDialogs();
  try {
    var value = $.evalFile(new File(${asciiLiteral(jsxPath(file))}));
    body = '{"ok":true,"value":' + q(value) + '}';
  } catch (e) {
    body = '{"ok":false,"error":' + q(e.toString()) + ',"line":' + q(e.line) + ',"file":' + q(e.fileName) + '}';
  }
  app.endSuppressDialogs(false);
  var tmp = new File(${asciiLiteral(jsxPath(resultPath + ".tmp"))});
  tmp.encoding = "UTF-8";
  tmp.open("w");
  tmp.write(body);
  tmp.close();
  tmp.rename(${asciiLiteral(basename(resultPath))});
})();
`,
  );

  spawn(afterEffects, ["-r", wrapperPath], { detached: true, stdio: "ignore" }).unref();

  const deadline = Date.now() + timeoutSec * 1000;
  try {
    while (!existsSync(resultPath)) {
      if (Date.now() > deadline) {
        throw new Error(
          `no result from After Effects after ${timeoutSec}s: check AE for an open dialog, and that ` +
            `"Allow Scripts to Write Files and Access Network" is on`,
        );
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    if (!result.ok) throw new Error(`After Effects: ${result.error}\n  at ${result.file}:${result.line}`);
    return result.value as string;
  } finally {
    rmSync(resultPath, { force: true });
    rmSync(wrapperPath, { force: true });
  }
}

/** Write ExtendScript source to a temp file and run it. */
export async function runSource(source: string, options?: { timeoutSec?: number }): Promise<string> {
  mkdirSync(RUNS, { recursive: true });
  const file = join(RUNS, `src_${Date.now()}_${process.pid}.jsx`);
  writeFileSync(file, source);
  try {
    return await runScript(file, options);
  } finally {
    rmSync(file, { force: true });
  }
}
