// A whole EngineReading (src/audio/types.ts) for tests that drive the anim
// clock's levels and hits through FeatureFrame.engine: silence, with the
// fields a test names overridden.

import type { EngineReading } from "../src/audio/types.ts";

/** The engine hit ratio whose Graded height (hitStandout at its default knee)
 *  is `standout`: lets a test set each hit's height. */
export function ratioForStandout(standout: number): number {
  return 1 - Math.log(1 - Math.min(standout, 1 - 1e-9));
}

export function engineReading(overrides: Partial<EngineReading> = {}): EngineReading {
  return {
    low: 0,
    mid: 0,
    high: 0,
    kick: 0,
    snare: 0,
    hat: 0,
    surge: 0,
    surgeKind: "kick",
    blocked: false,
    music: false,
    confidence: 0,
    beatTime: 0,
    downbeatTime: 0,
    downbeatConfidence: 0,
    updates: 0,
    ...overrides,
  };
}
