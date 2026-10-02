import { describe, it, expect } from "vitest";
import { createOutputBridge, type Transport } from "../src/net/outputBridge.ts";
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
    expect(posted[posted.length - 1]).toEqual({ t: "power", power: POWER });
    // A heartbeat from a window that has its state only re-sends power.
    posted.length = 0;
    receive({ t: "hello", haveState: true });
    expect(posted.map((m) => m.t)).toEqual(["power"]);
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

  it("a goodbye clears the status", () => {
    const { bridge, receive } = setup();
    receive({ t: "status", s: status });
    receive({ t: "bye" });
    expect(bridge.outputStatus()).toBeNull();
    expect(bridge.status().open).toBe(false);
  });
});
