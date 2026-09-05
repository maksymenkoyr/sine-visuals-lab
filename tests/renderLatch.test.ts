import { describe, it, expect } from "vitest";
import { createRenderLatch } from "../src/render/renderLatch.ts";
import type { AnimFrame } from "../src/render/animClock.ts";

// Minimal AnimFrame factory — only dtSec and the one-shot edges vary per
// test; every other field is a fixed, valid placeholder.
function frame(overrides: Partial<AnimFrame> = {}): AnimFrame {
  return {
    dtSec: 1 / 120,
    timeSec: 0,
    flowPhase: 0,
    beatPulse: 0,
    onset: false,
    beatPhase: 0,
    barPhase: 0,
    tempoLock: 0,
    beats: 0,
    onGrid: false,
    low: 0,
    mid: 0,
    high: 0,
    lowPulse: 0,
    midPulse: 0,
    highPulse: 0,
    lowOnset: false,
    midOnset: false,
    highOnset: false,
    sectionIntensity: 0,
    dropPulse: 0,
    dropOnset: false,
    centroid: 0,
    centroidRaw: 0,
    profile: { pulse: 0, tempo: 0, brightness: 0, density: 0, dynamics: 0, attack: 0, loudness: 0 },
    raw: { sectionIntensity: 0, profile: { pulse: 0, tempo: 0, brightness: 0, density: 0, dynamics: 0, attack: 0, loudness: 0 } },
    ...overrides,
  };
}

describe("createRenderLatch", () => {
  it("an edge fired on a tick that never gets consumed survives to the next consume", () => {
    const latch = createRenderLatch();
    latch.accumulate(frame({ onset: true })); // this tick never renders
    latch.accumulate(frame({ onset: false })); // neither does this one
    const rendered = latch.consume(frame({ onset: false }), 20); // this one finally does
    expect(rendered.onset).toBe(true);
  });

  it("several distinct edges across skipped ticks all survive to one consume", () => {
    const latch = createRenderLatch();
    latch.accumulate(frame({ lowOnset: true }));
    latch.accumulate(frame({ dropOnset: true }));
    latch.accumulate(frame({ highOnset: true }));
    const rendered = latch.consume(frame(), 20);
    expect(rendered.lowOnset).toBe(true);
    expect(rendered.dropOnset).toBe(true);
    expect(rendered.highOnset).toBe(true);
    expect(rendered.midOnset).toBe(false);
    expect(rendered.onset).toBe(false);
  });

  it("consume clears the pending set — the next consume starts clean", () => {
    const latch = createRenderLatch();
    latch.accumulate(frame({ onset: true }));
    expect(latch.consume(frame(), 10).onset).toBe(true);
    // No accumulate() call in between: nothing new fired.
    latch.accumulate(frame({ onset: false }));
    expect(latch.consume(frame(), 20).onset).toBe(false);
  });

  it("dtSec on a consumed frame is wall time since the last consume, not the tick's own dtSec", () => {
    const latch = createRenderLatch();
    // Three 8ms ticks (a 120Hz rAF) between two renders 24ms apart, each
    // tick's own dtSec reporting only its own 8ms slice.
    latch.accumulate(frame({ dtSec: 0.008 }));
    const first = latch.consume(frame({ dtSec: 0.008 }), 8);
    expect(first.dtSec).toBeCloseTo(0.008, 6); // first consume: no prior consume to measure since

    latch.accumulate(frame({ dtSec: 0.008 }));
    latch.accumulate(frame({ dtSec: 0.008 }));
    const second = latch.consume(frame({ dtSec: 0.008 }), 24);
    // 24ms - 8ms = 16ms of wall time actually elapsed across the two ticks
    // since the last render, not one tick's 8ms.
    expect(second.dtSec).toBeCloseTo(0.016, 6);
  });

  it("continuous fields (pulses, profile) pass through the latest tick's value unmodified", () => {
    const latch = createRenderLatch();
    latch.accumulate(frame({ beatPulse: 0.4, lowPulse: 0.2 }));
    const rendered = latch.consume(frame({ beatPulse: 0.7, lowPulse: 0.5 }), 10);
    // consume() is given the same (latest) tick's frame it just accumulated
    // in a real loop — its continuous envelopes ride along as-is.
    expect(rendered.beatPulse).toBe(0.7);
    expect(rendered.lowPulse).toBe(0.5);
  });
});
