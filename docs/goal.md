# Goal

**remotion-ae turns a Remotion video into an After Effects project that an editor can keep working on.**

Remotion videos are React code. After Effects has no way to open them, and no existing tool converts one into
the other (the only official bridge goes the other way: AE → Lottie → Remotion). remotion-ae fills that gap.

## What "done" means

1. **It looks the same.** Frames rendered by After Effects match the frames Remotion renders, checked with an
   automatic side-by-side comparison, not by eye alone.
2. **It is editable, not baked.** Shots are real comps, text is real text, camera moves and transitions are
   keyframes, effects are standard AE effects. Nothing is flattened into a video unless it cannot be expressed.
3. **It is one step for the user.** One command produces a script; running it in After Effects builds the whole
   project (and one Undo removes it again).
4. **It degrades honestly.** Anything that can't be translated is reported, never silently dropped.

## Scope over time

- **First:** projects made with the remo player (`timeline.json`), because the whole edit is plain data.
  This is the proving ground for the After Effects side.
- **Then:** any Remotion project, through remotion-ae components that render normally in Remotion and also
  describe themselves for After Effects, plus a render-to-layers fallback for content they can't describe.

See [plan.md](plan.md) for the phases and [progress.md](progress.md) for where things stand.
