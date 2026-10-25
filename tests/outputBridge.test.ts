import { describe, it, expect, vi } from "vitest";
import { createOutputBridge, OUTPUT_OPEN_GRACE_MS, type Transport } from "../src/net/outputBridge.ts";
import { NO_EFFECTS } from "../src/render/heldEffects.ts";
import { OUTPUT_PRESENCE_TIMEOUT_MS, type OutputPower, type OutputRenderStatus, type ToMain, type ToOutput } from "../src/net/outputSync.ts";

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

// A non-default resolution and cast mode, so the expectations below also show they travel.
const POWER: OutputPower = { quality: "mid", mode: "auto", resolution: 0.5, cast: "soft" };

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

  it("sendState posts a state message carrying the given state, only while an output is open", () => {
    const { bridge, posted, receive } = setup();
    const next = { scene: "mesh", palette: "mono", storage: {}, params: { sens: 1, exp: 1, smoothing: 1 } };
    expect(bridge.sendState?.(next)).toBe(false);
    expect(posted).toEqual([]);
    receive({ t: "hello", haveState: false });
    posted.length = 0;
    expect(bridge.sendState?.(next, 2000)).toBe(true);
    expect(posted).toEqual([{ t: "state", state: next, glideMs: 2000 }]);
  });

  it("looks reports NEXT as the main window's look now and LIVE as what the output holds", () => {
    let scene = "spectrum";
    const t = fakeTransport();
    const bridge = createOutputBridge({
      transport: t.transport,
      look: () => ({ scene, palette: "neon" }),
      storage,
      power: () => POWER,
    });
    expect(bridge.looks?.()).toEqual({ next: null, live: null });
    t.receive({ t: "hello", haveState: false });
    scene = "mesh";
    const looks = bridge.looks?.();
    expect(looks?.next?.scene).toBe("mesh");
    expect(looks?.live?.scene).toBe("spectrum");
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
  const FRAME = { time: 1, bands: new Float32Array(4), energy: 0.5, level: 0.4, hats: 0, lead: 0, onset: false, pulseOnset: false, bpm: 120, onsetPhase: 0, engine: null };
  const PARAMS = { sens: 1, exp: 1, smoothing: 1 };
  const GATE = { closed: 0.2, open: 0.3 };
  const frames = (posted: ToOutput[]) => posted.filter((m): m is Extract<ToOutput, { t: "frame" }> => m.t === "frame");

  it("sends gate while the output follows the preview, next to the params", () => {
    const { bridge, posted, receive } = setup();
    receive({ t: "hello", haveState: false });
    posted.length = 0;
    bridge.pushFrame(FRAME, { gate: GATE }, PARAMS);
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
    bridge.pushFrame(FRAME, { gate: GATE }, PARAMS);
    const [m] = frames(t.posted);
    expect(m.f.p).toBeUndefined();
    expect(m.f.gate).toEqual(GATE);
  });
});

describe("outputBridge keeps to one output window", () => {
  /** A bridge on a clock the test moves, whose window.open is a counter. */
  function setupOpen() {
    const t = fakeTransport();
    let nowMs = 10_000;
    let opened = 0;
    const bridge = createOutputBridge({
      transport: t.transport,
      look: () => ({ scene: "spectrum", palette: "neon" }),
      storage,
      power: () => POWER,
      openWindow: () => {
        opened++;
      },
      now: () => nowMs,
    });
    const advance = (ms: number) => {
      nowMs += ms;
    };
    return { ...t, bridge, opened: () => opened, advance };
  }
  const raises = (posted: ToOutput[]) => posted.filter((m) => m.t === "raise").length;

  it("asks a window still loading to come forward instead of opening a second", () => {
    const { bridge, posted, opened, advance } = setupOpen();
    bridge.open();
    expect(opened()).toBe(1);
    advance(OUTPUT_OPEN_GRACE_MS - 1);
    bridge.open();
    expect(opened()).toBe(1);
    expect(raises(posted)).toBe(1);
  });

  it("asks an output whose heartbeat is current to come forward, one it did not open too", () => {
    const { bridge, posted, receive, opened, advance } = setupOpen();
    receive({ t: "hello", haveState: true }); // e.g. this window reloaded, the output stayed
    advance(OUTPUT_PRESENCE_TIMEOUT_MS - 1);
    bridge.open();
    expect(opened()).toBe(0);
    expect(raises(posted)).toBe(1);
  });

  it("opens again once the output said goodbye", () => {
    const { bridge, receive, opened } = setupOpen();
    bridge.open();
    receive({ t: "hello", haveState: false });
    receive({ t: "bye" });
    bridge.open();
    expect(opened()).toBe(2);
  });

  it("opens again once the heartbeat lapsed (a crashed output says no goodbye)", () => {
    const { bridge, receive, opened, advance } = setupOpen();
    bridge.open();
    receive({ t: "hello", haveState: false });
    advance(Math.max(OUTPUT_OPEN_GRACE_MS, OUTPUT_PRESENCE_TIMEOUT_MS));
    bridge.open();
    expect(opened()).toBe(2);
  });

  it("opens again once the grace is over when the window never said hello", () => {
    const { bridge, opened, advance } = setupOpen();
    bridge.open();
    advance(OUTPUT_OPEN_GRACE_MS);
    bridge.open();
    expect(opened()).toBe(2);
  });

  it("does not take another main window's messages for an output", () => {
    const { bridge, receive } = setupOpen();
    receive({ t: "raise" } as unknown as ToMain);
    expect(bridge.status().open).toBe(false);
  });

  it("opens the output page noopener, so it gets a renderer process of its own", () => {
    const open = vi.fn((_url: string, _name: string, _features: string) => null);
    vi.stubGlobal("window", { open });
    vi.stubGlobal("location", { search: "" });
    try {
      setup().bridge.open();
      expect(open).toHaveBeenCalledTimes(1);
      const [url, , features] = open.mock.calls[0];
      expect(url).toBe("/output.html");
      expect(features.split(",")).toContain("noopener");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("outputBridge thumbnails", () => {
  it("asks for thumbnails once, repeats the request while wanted, and passes each thumb to its listener", () => {
    const t = fakeTransport();
    const bridge = createOutputBridge({
      transport: t.transport,
      look: () => ({ scene: "spectrum", palette: "neon" }),
      storage,
      power: () => POWER,
      now: () => 10_000,
    });
    t.receive({ t: "status", s: status });
    const thumbs = () => t.posted.filter((m) => m.t === "thumbs");
    const seen: unknown[] = [];
    bridge.onThumb?.((bmp) => seen.push(bmp));
    bridge.setThumbs?.(true);
    expect(thumbs()).toEqual([{ t: "thumbs", on: true }]);
    bridge.setThumbs?.(true);
    bridge.update(10_000);
    expect(thumbs()).toHaveLength(1);
    bridge.update(11_000);
    expect(thumbs()).toEqual([{ t: "thumbs", on: true }, { t: "thumbs", on: true }]);
    const bmp = { close() {} } as unknown as ImageBitmap;
    t.receive({ t: "thumb", bmp });
    expect(seen).toEqual([bmp]);
    bridge.setThumbs?.(false);
    expect(thumbs().at(-1)).toEqual({ t: "thumbs", on: false });
  });
});
