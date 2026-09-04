import { describe, it, expect } from "vitest";
import { advanceBeatSurge, createBeatSurgeState } from "../src/render/scenes/kaleido/index.ts";

// The scene's beat response is a push, not a jump: this pins the two
// properties the user-facing complaint was about — nothing moves in the
// frame the beat fires, and the swell rises from zero rather than stepping.
describe("advanceBeatSurge", () => {
  const DT = 1 / 120;

  it("does not displace the flow on the tick the beat fires", () => {
    const st = createBeatSurgeState();
    advanceBeatSurge(st, 0, true, 1);
    expect(st.phase).toBe(0);
  });

  it("swells smoothly: starts near zero, peaks at ~1, then releases", () => {
    const st = createBeatSurgeState();
    const env: number[] = [];
    let fired = true;
    for (let t = 0; t < 1; t += DT) {
      env.push(advanceBeatSurge(st, DT, fired, 1));
      fired = false;
    }
    expect(env[0]).toBeLessThan(0.25);
    const peak = Math.max(...env);
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThanOrEqual(1.0001);
    expect(env.indexOf(peak)).toBeGreaterThan(2);
    expect(env[env.length - 1]).toBeLessThan(0.05);
  });

  it("integrates to the documented displacement per beat and coasts to rest", () => {
    const st = createBeatSurgeState();
    let fired = true;
    for (let t = 0; t < 3; t += DT) {
      advanceBeatSurge(st, DT, fired, 1);
      fired = false;
    }
    expect(st.phase).toBeGreaterThan(0.55);
    expect(st.phase).toBeLessThan(0.65);
    expect(st.vel).toBeLessThan(1e-3);
  });

  it("scales with the slider and is inert at zero", () => {
    const st = createBeatSurgeState();
    let fired = true;
    let peak = 0;
    for (let t = 0; t < 2; t += DT) {
      peak = Math.max(peak, advanceBeatSurge(st, DT, fired, 0));
      fired = false;
    }
    expect(peak).toBe(0);
    expect(st.phase).toBe(0);
  });
});
