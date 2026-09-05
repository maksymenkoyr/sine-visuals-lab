import { describe, it, expect } from "vitest";
import { advanceBeatSurge, createBeatSurgeState } from "../src/render/scenes/kaleido/index.ts";

// The scene's beat response is a push, not a jump: this pins the two
// properties the user-facing complaint was about — nothing moves in the
// frame the beat fires, and the swell rises from zero rather than stepping —
// and that Surge ease only changes how long that takes, never how far.
describe("advanceBeatSurge", () => {
  const DT = 1 / 120;

  function run(seconds: number, amount: number, ease: number) {
    const st = createBeatSurgeState();
    const env: number[] = [];
    let fired = true;
    for (let t = 0; t < seconds; t += DT) {
      env.push(advanceBeatSurge(st, DT, fired, amount, ease));
      fired = false;
    }
    return { st, env };
  }

  it("does not displace the flow on the tick the beat fires", () => {
    const st = createBeatSurgeState();
    advanceBeatSurge(st, 0, true, 1, 0.5);
    expect(st.phase).toBe(0);
  });

  it.each([0, 0.5, 1])("swells smoothly at ease %s: starts near zero, peaks at ~1, then releases", (ease) => {
    const { env } = run(5, 1, ease);
    expect(env[0]).toBeLessThan(0.5);
    const peak = Math.max(...env);
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThanOrEqual(1.0001);
    expect(env.indexOf(peak)).toBeGreaterThan(1);
    expect(env[env.length - 1]).toBeLessThan(0.05);
  });

  it("integrates to the same displacement per beat at any ease, and coasts to rest", () => {
    for (const ease of [0, 0.5, 1]) {
      const { st } = run(6, 1, ease);
      expect(st.phase).toBeGreaterThan(0.55);
      expect(st.phase).toBeLessThan(0.65);
      expect(st.vel).toBeLessThan(1e-3);
    }
  });

  it("softer ease takes longer to peak and longer to release", () => {
    const snappy = run(3, 1, 0).env;
    const soft = run(3, 1, 1).env;
    const peakAt = (e: number[]) => e.indexOf(Math.max(...e));
    const settledAt = (e: number[]) => e.findIndex((v, i) => i > peakAt(e) && v < 0.1);
    expect(peakAt(soft)).toBeGreaterThan(peakAt(snappy));
    expect(settledAt(soft)).toBeGreaterThan(settledAt(snappy));
  });

  it("scales with the slider and is inert at zero", () => {
    const { st, env } = run(2, 0, 0.5);
    expect(Math.max(...env)).toBe(0);
    expect(st.phase).toBe(0);
  });
});
