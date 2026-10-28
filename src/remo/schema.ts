import { z } from "zod";

// Copy of remo's src/schema.ts (remo 0.1.0, Remotion 4.0.534). Keep in sync with the player.

export const MOTIONS = ["none", "zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down"] as const;
export const TRANSITIONS = ["cut", "fade", "slide-left", "slide-right", "slide-up", "slide-down", "wipe", "warm-sweep", "flash"] as const;
export const FITS = ["cover", "contain"] as const;

export const shotSchema = z.object({
  id: z.string().min(1),
  /** How long the shot is on screen, before transition overlap. */
  seconds: z.number().positive(),
  /** Still image, path relative to the project's assets/ folder (or an https URL). */
  image: z.string().optional(),
  /** Video clip (e.g. MiniMax image-to-video). When set it replaces the image. */
  clip: z.string().optional(),
  /** Skip this many seconds at the start of the clip. */
  clipStart: z.number().min(0).optional(),
  /** Volume of the clip's own sound (e.g. MiniMax sound effects), 0-1. Default 0: muted. */
  clipVolume: z.number().min(0).max(1).optional(),
  /** Voiceover line for this shot (audio file). Starts with the shot and may run on into the next one. */
  voiceover: z.string().optional(),
  /** Seconds after the shot starts before its voiceover begins. Default 0. */
  voiceoverDelay: z.number().min(0).optional(),
  /** Camera move on a still image. Default zoom-in. Ignored for clips. */
  motion: z.enum(MOTIONS).optional(),
  /** cover = fill the frame (crops), contain = whole image over a blurred backdrop. Default cover. */
  fit: z.enum(FITS).optional(),
  /** Solid colour (CSS) when there is no image or clip, e.g. "black" for a hold on black. */
  color: z.string().optional(),
  caption: z.string().optional(),
  /** Lines that appear one at a time, centred, and stay until the shot ends (closing titles). */
  lines: z.array(z.string()).optional(),
  /** Transition INTO THE NEXT shot. Default cut. */
  transition: z.enum(TRANSITIONS).optional(),
  transitionSeconds: z.number().positive().optional(),
  /** Free-text notes: story beat, prompts. Not rendered. */
  beat: z.string().optional(),
  imagePrompt: z.string().optional(),
  videoPrompt: z.string().optional(),
});

export const timelineSchema = z.object({
  title: z.string().optional(),
  fps: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  shots: z.array(shotSchema),
  audio: z
    .object({
      music: z.string().optional(),
      musicVolume: z.number().min(0).max(1).optional(),
      voiceover: z.string().optional(),
      voiceoverVolume: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export type Timeline = z.infer<typeof timelineSchema>;
export type ShotSpec = z.infer<typeof shotSchema>;
