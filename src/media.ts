import { spawnSync } from "node:child_process";

export type MediaInfo = { width?: number; height?: number; seconds?: number };

const cache = new Map<string, MediaInfo>();

/** Size and length of an image, video or audio file (ffprobe). */
export function probe(file: string): MediaInfo {
  const hit = cache.get(file);
  if (hit) return hit;
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file],
    { encoding: "utf8" },
  );
  if (r.error) throw new Error(`ffprobe is needed to read media files (${r.error.message})`);
  if (r.status !== 0) throw new Error(`ffprobe could not read ${file}: ${r.stderr.trim()}`);
  const data = JSON.parse(r.stdout);
  const video = (data.streams ?? []).find((s: { codec_type: string }) => s.codec_type === "video");
  const seconds = parseFloat(data.format?.duration);
  const info: MediaInfo = {
    width: video?.width,
    height: video?.height,
    seconds: Number.isFinite(seconds) ? seconds : undefined,
  };
  cache.set(file, info);
  return info;
}
