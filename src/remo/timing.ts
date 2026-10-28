import type { ShotSpec, Timeline } from "./schema.ts";

// Copy of remo's src/timing.ts (remo 0.1.0). Keep in sync: shot times must match the player exactly.

export const DEFAULT_TRANSITION_SECONDS = 0.5;

export type ShotTiming = {
  shot: ShotSpec;
  index: number;
  /** First output frame where this shot is visible (including its incoming transition). */
  from: number;
  durationInFrames: number;
  /** Overlap with the next shot. 0 = hard cut. */
  transitionFrames: number;
};

export const shotFrames = (shot: ShotSpec, fps: number) => Math.max(1, Math.round(shot.seconds * fps));

export function computeTimings(t: Timeline): { shots: ShotTiming[]; totalFrames: number } {
  const durs = t.shots.map((s) => shotFrames(s, t.fps));
  const shots: ShotTiming[] = [];
  let from = 0;
  t.shots.forEach((shot, index) => {
    const next = durs[index + 1];
    let transitionFrames = 0;
    if (next !== undefined && (shot.transition ?? "cut") !== "cut") {
      const want = Math.round((shot.transitionSeconds ?? DEFAULT_TRANSITION_SECONDS) * t.fps);
      // at most half of either neighbour, so a shot's incoming + outgoing transitions never overlap
      transitionFrames = Math.max(0, Math.min(want, Math.floor(durs[index] / 2), Math.floor(next / 2)));
    }
    shots.push({ shot, index, from, durationInFrames: durs[index], transitionFrames });
    from += durs[index] - transitionFrames;
  });
  return { shots, totalFrames: Math.max(1, from) };
}
