// A whole EngineReading (src/audio/types.ts) for tests that drive the anim
// clock's levels and hits through FeatureFrame.engine: silence, with the
// fields a test names overridden.

import type { EngineReading } from "../src/audio/types.ts";

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
