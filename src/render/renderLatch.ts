import type { AnimFrame } from "./animClock.ts";

// app.ts/tv.ts advance the anim clock on every rAF tick, but scene.render()
// is gated behind shouldRenderFrame() (framePace.ts, 60fps cap / 30 on the
// floor preset). A one-shot edge on AnimFrame (onset/lowOnset/midOnset/
// highOnset/dropOnset) is true for exactly one tick — on a 120Hz display, or
// any display at the floor preset, roughly half those ticks never reach
// scene.render() at all, so the edge is silently dropped. Separately,
// anim.dtSec is the rAF tick interval, not the time since the scene last
// drew, so anything a scene integrates with it (caustics' ripple pool and
// drift phase, dancers' choreographer) advances slower than wall time
// whenever ticks outrun the render cap.
//
// This sits between animClock.advance() and scene.render(): accumulate()
// runs every tick and ORs each edge into a pending set; consume() runs only
// on a tick that's actually about to render, and returns the AnimFrame a
// scene should see — every pending edge folded in, dtSec replaced with wall
// seconds since the last consume, and the pending set cleared. A scene that
// only reads AnimFrame's one-shot fields (never FeatureFrame's) can no
// longer miss one, regardless of render cap or refresh rate.
//
// Modeled on jitterBuffer.ts's consumeOnsetIfDue — the same "hold a flag
// until someone consumes it" shape, here local to one device's render loop
// instead of a network room's playout clock.
//
// chladni.ts and meshGrid.ts already sidestep the dtSec half of this by
// deriving their own dt from frame.time deltas instead of anim.dtSec — see
// chladni.ts's file header. They predate this latch and don't need it, but
// a future simplification could fold them onto anim.dtSec now that it's
// render-accurate too.
export interface RenderLatch {
  /** Call once per rAF tick, right after animClock.advance(), with that
   *  tick's raw AnimFrame — whether or not this tick will render. */
  accumulate(anim: AnimFrame): void;
  /** Call only on a tick that passed shouldRenderFrame(), with the same
   *  AnimFrame just accumulated and the current timestamp. Returns the
   *  AnimFrame to pass to scene.render(): one-shot edges are the OR of
   *  every tick since the last consume, dtSec is wall seconds since the
   *  last consume, and the pending set is cleared. */
  consume(anim: AnimFrame, nowMs: number): AnimFrame;
}

export function createRenderLatch(): RenderLatch {
  let pendingOnset = false;
  let pendingLowOnset = false;
  let pendingMidOnset = false;
  let pendingHighOnset = false;
  let pendingDropOnset = false;
  let lastConsumeMs: number | null = null;

  return {
    accumulate(anim: AnimFrame): void {
      pendingOnset ||= anim.onset;
      pendingLowOnset ||= anim.lowOnset;
      pendingMidOnset ||= anim.midOnset;
      pendingHighOnset ||= anim.highOnset;
      pendingDropOnset ||= anim.dropOnset;
    },

    consume(anim: AnimFrame, nowMs: number): AnimFrame {
      // First consume: nothing to measure since, so fall back to this
      // tick's own dtSec rather than a huge or undefined gap.
      const dtSec = lastConsumeMs === null ? anim.dtSec : Math.max(1e-4, (nowMs - lastConsumeMs) / 1000);
      lastConsumeMs = nowMs;

      const merged: AnimFrame = {
        ...anim,
        dtSec,
        onset: pendingOnset,
        lowOnset: pendingLowOnset,
        midOnset: pendingMidOnset,
        highOnset: pendingHighOnset,
        dropOnset: pendingDropOnset,
      };

      pendingOnset = false;
      pendingLowOnset = false;
      pendingMidOnset = false;
      pendingHighOnset = false;
      pendingDropOnset = false;

      return merged;
    },
  };
}
