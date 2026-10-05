import { describe, it, expect } from "vitest";
import { createOutputBridge, type Transport } from "../src/net/outputBridge.ts";
import { NO_EFFECTS } from "../src/render/heldEffects.ts";
import type { OutputPower, OutputRenderStatus, ToMain, ToOutput } from "../src/net/outputSync.ts";

function fakeTransport() {
  const posted: ToOutput[] = [];
  let cb: (m: ToMain) => void = () => undefined;
  const transport: Transport<ToOutput, ToMain> = {
    post: (m) => void posted.push(m),
    onMessage: (f) => void (cb = f),
  };
  return { transport, posted, receive: (m: ToMain) => cb(m) };
}

const storage = { getItem: () => null, key: () => null, length: 0 };
const status: OutputRenderStatus = {
  preset: "high",
  recommended: "mid",
  fps: 60,
  level: 0,
  maxLevel: 4,
  fraction: 1,
  standingDown: false,
  bufferWidth: 1920,
  bufferHeight: 1080,
};

// A non-default resolution, so the expectations below also show it travels.
const POWER: OutputPower = { quality: "mid", mode: "auto", resolution: 0.5 };

function setup() {
  const t = fakeTransport();
  const bridge = createOutputBridge({
    transport: t.transport,
    look: () => ({ scene: "spectrum", palette: "neon" }),
    storage,
    power: () => POWER,
  });
  return { ...t, bridge };
}

describe("outputBridge status and power", () => {
  it("a status message opens the output and is readable, without re-sending state", () => {
    const { bridge, posted, receive } = setup();
    expect(bridge.outputStatus()).toBeNull();
    receive({ t: "status", s: status });
    expect(bridge.status().open).toBe(true);
    expect(bridge.outputStatus()).toEqual(status);
    expect(posted).toEqual([]);
  });

  it("a hello sends the state and then the output's power", () => {
    const { posted, receive } = setup();
    receive({ t: "hello", haveState: false });
    expect(posted[0].t).toBe("state");
    expect(posted[posted.length - 2]).toEqual({ t: "power", power: POWER });
    // A heartbeat from a window that has its state only re-sends power and effects.
    posted.length = 0;
    receive({ t: "hello", haveState: true });
    expect(posted.map((m) => m.t)).toEqual(["power", "effects"]);
  });

  it("sendEffects posts only while an output is open, and every heartbeat reply repeats the last set", () => {
    const { bridge, posted, receive } = setup();
    const held = { ...NO_EFFECTS, freeze: true };
    bridge.sendEffects(held);
    expect(posted).toEqual([]);
    receive({ t: "hello", haveState: false });
    expect(posted[posted.length - 1]).toEqual({ t: "effects", effects: held });
    posted.length = 0;
    bridge.sendEffects(NO_EFFECTS);
    expect(posted).toEqual([{ t: "effects", effects: NO_EFFECTS }]);
    posted.length = 0;
    receive({ t: "hello", haveState: true });
    expect(posted[posted.length - 1]).toEqual({ t: "effects", effects: NO_EFFECTS });
  });

  it("a Play with a glide length keeps it across a scene change, for the output's crossfade", () => {
    let scene = "spectrum";
    const t = fakeTransport();
    const bridge = createOutputBridge({
      transport: t.transport,
      look: () => ({ scene, palette: "neon" }),
      storage,
      power: () => POWER,
    });
    t.receive({ t: "hello", haveState: false });
    t.posted.length = 0;
    scene = "mesh";
    expect(bridge.go(3000)).toBe(true);
    const state = t.posted.find((m) => m.t === "state");
    expect(state && state.t === "state" && state.glideMs).toBe(3000);
    expect(state && state.t === "state" && state.state.scene).toBe("mesh");
  });

  it("a Play pressed while presence had lapsed reaches the output when it returns", () => {
    let scene = "spectrum";
    const t = fakeTransport();
    const bridge = createOutputBridge({
      transport: t.transport,
      look: () => ({ scene, palette: "neon" }),
      storage,
      power: () => POWER,
    });
    t.receive({ t: "hello", haveState: false }); // output seeded with spectrum
    t.posted.length = 0;
    bridge.update(performance.now() + 4000); // no heartbeat for over 3 s
    expect(bridge.status().open).toBe(false);
    scene = "mesh";
    bridge.go(); // dropped: nobody is listening
    expect(t.posted).toEqual([]);
    t.receive({ t: "hello", haveState: true }); // the output is back, with its state
    const states = t.posted.filter((m) => m.t === "state");
    expect(states).toHaveLength(1);
    expect(states[0].t === "state" && states[0].state.scene).toBe("mesh");
  });

  it("sendPower posts only while an output is open", () => {
    const { bridge, posted, receive } = setup();
    bridge.sendPower();
    expect(posted).toEqual([]);
    receive({ t: "status", s: status });
    bridge.sendPower();
    expect(posted).toEqual([{ t: "power", power: POWER }]);
  });

  it("can cue while the window is open, and not after it leaves", () => {
    const { bridge, receive } = setup();
    expect(bridge.status().canCue).toBe(false);
    receive({ t: "status", s: status });
    expect(bridge.status().canCue).toBe(true);
    receive({ t: "bye" });
    expect(bridge.status().canCue).toBe(false);
  });

  it("a status change in canCue reaches listeners", () => {
    const { bridge, receive } = setup();
    const seen: boolean[] = [];
    bridge.onStatus((s) => seen.push(s.canCue));
    receive({ t: "hello", haveState: false });
    bridge.update(performance.now());
    expect(seen).toEqual([true]);
  });

  it("a goodbye clears the status", () => {
    const { bridge, receive } = setup();
    receive({ t: "status", s: status });
    receive({ t: "bye" });
    expect(bridge.outputStatus()).toBeNull();
    expect(bridge.status().open).toBe(false);
  });
});

describe("outputBridge frames carry the controller's gate marks", () => {
  const FRAME = { time: 1, bands: new Float32Array(4), energy: 0.5, level: 0.4, onset: false, pulseOnset: false, bpm: 120, onsetPhase: 0 };
  const PARAMS = { sens: 1, exp: 1, smoothing: 1 };
  const GATE = { closed: 0.2, open: 0.3 };
  const frames = (posted: ToOutput[]) => posted.filter((m): m is Extract<ToOutput, { t: "frame" }> => m.t === "frame");

  it("sends gate while the output follows the preview, next to the params", () => {
    const { bridge, posted, receive } = setup();
    receive({ t: "hello", haveState: false });
    posted.length = 0;
    bridge.pushFrame(FRAME, { beatRatio: null, wavePeak: null, gate: GATE }, PARAMS);
    const [m] = frames(posted);
    expect(m.f.gate).toEqual(GATE);
    expect(m.f.p).toEqual(PARAMS);
  });

  it("still sends gate while the output holds its own look and p is left off", () => {
    let scene = "spectrum";
    const t = fakeTransport();
    const bridge = createOutputBridge({
      transport: t.transport,
      look: () => ({ scene, palette: "neon" }),
      storage,
      power: () => POWER,
    });
    t.receive({ t: "hello", haveState: false });
    scene = "mesh"; // the preview moves on; the output keeps what it was sent
    bridge.update(1000);
    expect(bridge.status().differs).toBe(true);
    t.posted.length = 0;
    bridge.pushFrame(FRAME, { beatRatio: null, wavePeak: null, gate: GATE }, PARAMS);
    const [m] = frames(t.posted);
    expect(m.f.p).toBeUndefined();
    expect(m.f.gate).toEqual(GATE);
  });
});
