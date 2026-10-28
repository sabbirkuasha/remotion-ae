import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";

const IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]); // IEND chunk type + CRC

/** True once a PNG is completely written (ends with its IEND chunk). */
export function pngComplete(file: string): boolean {
  if (!existsSync(file)) return false;
  const size = statSync(file).size;
  if (size < IEND.length) return false;
  const fd = openSync(file, "r");
  try {
    const tail = Buffer.alloc(IEND.length);
    readSync(fd, tail, 0, IEND.length, size - IEND.length);
    return tail.equals(IEND);
  } finally {
    closeSync(fd);
  }
}

/** comp.saveFrameToPng returns before the file is written: wait for all of them. Returns the ones still missing. */
export async function waitForPngs(files: string[], timeoutMs = 120_000): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let missing = files;
  while ((missing = missing.filter((f) => !pngComplete(f))).length && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  return missing;
}
