import { afterEach, describe, expect, it } from "vitest";
import {
  createTour,
  mixWeight,
  nextOpenView,
  stepTour,
  MIX_BEATS,
  PHRASE_BEATS,
  PHRASE_WAIT_SEC,
  type TourInput,
  type TourState,
} from "../src/render/scenes/longplay/tour.ts";
import { LONGPLAY_SETTINGS, VIEWS } from "../src/render/scenes/longplay/index.ts";
import { getSceneSetting, isProLocked, setSceneSetting, type SceneSetting } from "../src/render/sceneSettings.ts";
import { setProUnlocked } from "../src/render/pro.ts";

const DT = 1 / 60;
const BPM = 120;

/** Runs the tour for `sec` seconds at a steady tempo, returning the state. */
function run(s: TourState, sec: number, from: { time: number; beats: number }, over: Partial<TourInput> = {}) {
  const steps = Math.round(sec / DT);
  for (let i = 0; i < steps; i++) {
    from.time += DT;
    from.beats += (DT * BPM) / 60;
    stepTour(s, {
      timeSec: from.time,
      dtSec: DT,
      beats: from.beats,
      pick: 0,
      auto: true,
      holdSec: 10,
      count: 3,
      locked: () => false,
      ...over,
    });
  }
  return s;
}

describe("longplay tour", () => {
  it("holds a view for Hold, then mixes to the next on a phrase start", () => {
    const clock = { time: 0, beats: 0.5 };
    const s = run(createTour(0, 0.5), 9.9, clock);
    expect(s.mixing).toBe(false);
    expect(s.cur).toBe(0);
    // Hold ran out at 10 s; the next phrase start is beat 32, at 15.75 s.
    run(s, 5.7, clock);
    expect(s.mixing).toBe(false);
    run(s, 0.3, clock);
    expect(s.mixing).toBe(true);
    expect(s.next).toBe(1);
    expect(Math.floor(s.mixStartBeat / PHRASE_BEATS) * PHRASE_BEATS).toBe(32);
  });

  it("finishes a mix in two bars and starts holding the new view", () => {
    const clock = { time: 0, beats: 0.5 };
    const s = run(createTour(0, 0.5), 16.3, clock);
    expect(s.mixing).toBe(true);
    run(s, ((MIX_BEATS * 60) / BPM) * 0.5, clock);
    expect(mixWeight(s)).toBeGreaterThan(0.2);
    expect(mixWeight(s)).toBeLessThan(0.8);
    run(s, (MIX_BEATS * 60) / BPM, clock);
    expect(s.mixing).toBe(false);
    expect(s.cur).toBe(1);
    expect(s.heldSec).toBeLessThan(3);
  });

  it("mixes anyway when no beat clock is running", () => {
    const clock = { time: 0, beats: 0 };
    const s = createTour(0, 0);
    // beats frozen: step manually with beats = 0
    for (let i = 0; i < Math.round((10 + PHRASE_WAIT_SEC + 0.2) / DT); i++) {
      clock.time += DT;
      stepTour(s, { timeSec: clock.time, dtSec: DT, beats: 0, pick: 0, auto: true, holdSec: 10, count: 3, locked: () => false });
    }
    expect(s.mixing).toBe(true);
  });

  it("does nothing by itself with Auto change off", () => {
    const s = run(createTour(2, 0), 60, { time: 0, beats: 0 }, { auto: false, pick: 2 });
    expect(s.cur).toBe(2);
    expect(s.mixing).toBe(false);
  });

  it("mixes to a hand pick at once", () => {
    const clock = { time: 0, beats: 0 };
    const s = run(createTour(0, 0), 1, clock, { auto: false });
    run(s, DT, clock, { auto: false, pick: 2 });
    expect(s.mixing).toBe(true);
    expect(s.next).toBe(2);
    run(s, 5, clock, { auto: false, pick: 2 });
    expect(s.cur).toBe(2);
  });

  it("never tours to a locked view, and leaves one that becomes locked", () => {
    const locked = (i: number) => i === 1;
    expect(nextOpenView(0, 3, locked)).toBe(2);
    expect(nextOpenView(2, 3, locked)).toBe(0);
    expect(nextOpenView(0, 2, (i) => i === 1)).toBe(0);
    const s = createTour(1, 0);
    stepTour(s, { timeSec: DT, dtSec: DT, beats: 0, pick: 0, auto: true, holdSec: 10, count: 3, locked });
    expect(s.cur).toBe(0);
  });
});

describe("Pro options", () => {
  const SPEC: SceneSetting = {
    key: "view",
    label: "View",
    type: "enum",
    options: ["Free", "Paid"],
    proOptions: ["Paid"],
    min: 0,
    max: 1,
    step: 1,
    default: 0,
  };
  afterEach(() => setProUnlocked(true));

  it("can't store or read back a locked option", () => {
    setProUnlocked(false);
    expect(isProLocked(SPEC, 1)).toBe(true);
    expect(isProLocked(SPEC, 0)).toBe(false);
    setSceneSetting("pro-test", SPEC, 1);
    expect(getSceneSetting("pro-test", SPEC)).toBe(0);
  });

  it("is selectable once Pro is unlocked", () => {
    setProUnlocked(true);
    setSceneSetting("pro-test-2", SPEC, 1);
    expect(getSceneSetting("pro-test-2", SPEC)).toBe(1);
    setProUnlocked(false);
    // a value stored while unlocked reads back as the free default once locked
    expect(getSceneSetting("pro-test-2", SPEC)).toBe(0);
  });

  it("every Long Play view's default is a free view", () => {
    const view = LONGPLAY_SETTINGS.find((s) => s.key === "view")!;
    expect(view.options).toEqual(VIEWS.map((v) => v.name));
    expect(view.proOptions ?? []).not.toContain(view.options![view.default]);
    for (const name of ["Tunnel", "Reactor", "Ocean"]) expect(view.proOptions ?? []).not.toContain(name);
  });
});
