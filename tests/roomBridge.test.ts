import { describe, expect, it } from "vitest";
import { combineBridges, createRoomBridge } from "../src/net/roomBridge.ts";
import type { OutputBridge, OutputStatus } from "../src/net/outputBridge.ts";
import type { MainPlay, MainPlayStatus } from "../src/net/mainPlay.ts";

/** A MainPlay with the answers set by the test and every call recorded. */
function fakePlay(init: Partial<MainPlayStatus> = {}) {
  const calls: string[] = [];
  let st: MainPlayStatus = { known: true, onAir: true, changedBy: null, ...init };
  let result: "sent" | "glide" | null = "sent";
  const listeners: Array<(s: MainPlayStatus) => void> = [];
  const play: MainPlay = {
    onSnapshot: () => {},
    onScreenKnown: () => {},
    onPatch: () => {},
    onAck: () => {},
    onReject: () => {},
    onDisconnect: () => {},
    onNeedSnapshot: () => {},
    tick: (now) => void calls.push(`tick:${now}`),
    play: (g) => {
      calls.push(`play:${g}`);
      return result;
    },
    take: () => void calls.push("take"),
    status: () => st,
    onStatus: (cb) => {
      listeners.push(cb);
      return () => {};
    },
  };
  return {
    play,
    calls,
    setResult(r: "sent" | "glide" | null) {
      result = r;
    },
    set(s: Partial<MainPlayStatus>) {
      st = { ...st, ...s };
      for (const cb of listeners) cb(st);
    },
  };
}

function setup(init: Partial<MainPlayStatus> = {}) {
  const fp = fakePlay(init);
  const env = { present: true, roomShown: 0 };
  const bridge = createRoomBridge({
    play: fp.play,
    present: () => env.present,
    showRoom: () => void env.roomShown++,
  });
  return { ...fp, bridge, env };
}

describe("createRoomBridge", () => {
  it("is open while another device is online, and never has a Cue", () => {
    const { bridge, env } = setup();
    expect(bridge.status()).toEqual({ open: true, cue: false, differs: false, canCue: false, changedBy: null });
    env.present = false;
    expect(bridge.status().open).toBe(false);
    bridge.setCue(true);
    expect(bridge.status().cue).toBe(false);
  });

  it("differs when this device is not on air, but not before Main is known", () => {
    const { bridge, set } = setup({ onAir: false });
    expect(bridge.status().differs).toBe(true);
    set({ known: false });
    expect(bridge.status().differs).toBe(false);
  });

  it("a closed room never differs or names a change, whatever MainPlay says", () => {
    const { bridge, env, set } = setup({ onAir: false, changedBy: "iPad" });
    expect(bridge.status()).toMatchObject({ open: true, differs: true, changedBy: "iPad" });
    env.present = false;
    set({});
    expect(bridge.status()).toEqual({ open: false, cue: false, differs: false, canCue: false, changedBy: null });
  });

  it("Play goes through MainPlay with the glide, and says whether it glided", () => {
    const { bridge, calls, setResult } = setup();
    setResult("glide");
    expect(bridge.go(4000)).toBe(true);
    setResult("sent");
    expect(bridge.go()).toBe(false);
    setResult(null);
    expect(bridge.go(2000)).toBe(false);
    expect(calls).toEqual(["play:4000", "play:undefined", "play:2000"]);
  });

  it("update ticks MainPlay", () => {
    const { bridge, calls } = setup();
    bridge.update(1234);
    expect(calls).toEqual(["tick:1234"]);
  });

  it("carries changedBy, and Take Main calls MainPlay's take", () => {
    const { bridge, calls, set } = setup();
    set({ onAir: false, changedBy: "iPad" });
    expect(bridge.status().changedBy).toBe("iPad");
    bridge.take?.();
    expect(calls).toEqual(["take"]);
  });

  it("tells listeners when MainPlay's status changes, once per real change", () => {
    const { bridge, set, env } = setup();
    const seen: OutputStatus[] = [];
    bridge.onStatus((s) => seen.push(s));
    bridge.update(1);
    bridge.update(2);
    expect(seen).toEqual([]);
    set({ onAir: false });
    set({ onAir: false });
    expect(seen).toHaveLength(1);
    expect(seen[0].differs).toBe(true);
    env.present = false;
    bridge.update(3);
    expect(seen).toHaveLength(2);
    expect(seen[1].open).toBe(false);
  });

  it("has nothing to push for frames, power or render readouts", () => {
    const { bridge } = setup();
    expect(bridge.outputStatus()).toBeNull();
    bridge.sendPower();
  });

  it("OUTPUT shows the room view", () => {
    const { bridge, env } = setup();
    bridge.open();
    expect(env.roomShown).toBe(1);
  });
});

function fakeBridge(init: OutputStatus) {
  const calls: string[] = [];
  let st = init;
  const listeners: Array<(s: OutputStatus) => void> = [];
  const bridge: OutputBridge = {
    open: () => calls.push("open"),
    status: () => st,
    onStatus: (cb) => listeners.push(cb),
    setCue: (on) => calls.push(`cue:${on}`),
    go: (g) => {
      calls.push(`go:${g}`);
      return !!g;
    },
    update: () => calls.push("update"),
    pushFrame: () => calls.push("frame"),
    sendPower: () => calls.push("power"),
    outputStatus: () => null,
    take: () => void calls.push("take"),
  };
  return {
    bridge,
    calls,
    set(s: OutputStatus) {
      st = s;
      for (const cb of listeners) cb(s);
    },
  };
}

describe("combineBridges", () => {
  const closed: OutputStatus = { open: false, cue: false, differs: false, canCue: false };
  const open: OutputStatus = { open: true, cue: false, differs: false, canCue: true };
  const room: OutputStatus = { open: true, cue: false, differs: false, canCue: false };

  it("is open while any output is, and differs or cues while any does", () => {
    const a = fakeBridge(closed);
    const b = fakeBridge({ open: true, cue: true, differs: true, canCue: true });
    expect(combineBridges([a.bridge, b.bridge]).status()).toEqual({ open: true, cue: true, differs: true, canCue: true, changedBy: null });
    expect(combineBridges([a.bridge, fakeBridge(closed).bridge]).status()).toEqual({ ...closed, changedBy: null });
  });

  it("sends Play to the open outputs only, and reports a glide if any glided", () => {
    const a = fakeBridge(closed);
    const b = fakeBridge(open);
    const both = combineBridges([a.bridge, b.bridge]);
    expect(both.go(3000)).toBe(true);
    expect(a.calls).toEqual([]);
    expect(b.calls).toEqual(["go:3000"]);
  });

  it("holds Cue on the open outputs but lets go on every one", () => {
    const a = fakeBridge(closed);
    const b = fakeBridge(open);
    const both = combineBridges([a.bridge, b.bridge]);
    both.setCue(true);
    expect([a.calls, b.calls]).toEqual([[], ["cue:true"]]);
    both.setCue(false);
    expect([a.calls, b.calls]).toEqual([["cue:false"], ["cue:true", "cue:false"]]);
  });

  it("can cue only while an open output can, and names who changed Main", () => {
    const pop = fakeBridge({ ...closed, canCue: true }); // a closed pop-out never offers Cue
    const rm = fakeBridge({ ...room, changedBy: "iPad" });
    const both = combineBridges([pop.bridge, rm.bridge]);
    expect(both.status()).toMatchObject({ open: true, canCue: false, changedBy: "iPad" });
    pop.set({ ...open });
    expect(both.status()).toMatchObject({ canCue: true, changedBy: "iPad" });
  });

  it("a closed differing room does not keep the combined bar on differs after Play", () => {
    // pop-out open and showing the preview after Play; the room (nobody online) still differs
    const pop = fakeBridge({ ...open });
    const fp = setup({ onAir: false });
    fp.env.present = false;
    const both = combineBridges([pop.bridge, fp.bridge]);
    expect(both.status().differs).toBe(false);
    both.go();
    expect(both.status()).toMatchObject({ open: true, differs: false, changedBy: null });
    expect(fp.calls).not.toContain("play:undefined");
  });

  it("takes the first changedBy that is set", () => {
    const a = fakeBridge({ ...room, changedBy: null });
    const b = fakeBridge({ ...room, changedBy: "iPad" });
    const c = fakeBridge({ ...room, changedBy: "Laptop" });
    expect(combineBridges([a.bridge, b.bridge, c.bridge]).status().changedBy).toBe("iPad");
  });

  it("Take Main reaches every output that has a take", () => {
    const a = fakeBridge(open);
    const b = fakeBridge(room);
    const noTake = fakeBridge(room);
    delete noTake.bridge.take;
    combineBridges([a.bridge, b.bridge, noTake.bridge]).take?.();
    expect([a.calls, b.calls, noTake.calls]).toEqual([["take"], ["take"], []]);
  });

  it("holds Cue only on an open output that can cue, never on the room", () => {
    const pop = fakeBridge(open);
    const rm = fakeBridge(room);
    const both = combineBridges([pop.bridge, rm.bridge]);
    both.setCue(true);
    expect([pop.calls, rm.calls]).toEqual([["cue:true"], []]);
  });

  it("Play reaches the pop-out and the room together", () => {
    const pop = fakeBridge(open);
    const rm = fakeBridge(room);
    combineBridges([pop.bridge, rm.bridge]).go(2000);
    expect([pop.calls, rm.calls]).toEqual([["go:2000"], ["go:2000"]]);
  });

  it("opens, and takes frames and power, from the first output", () => {
    const a = fakeBridge(closed);
    const b = fakeBridge(open);
    const both = combineBridges([a.bridge, b.bridge]);
    both.open();
    both.sendPower();
    expect([a.calls, b.calls]).toEqual([["open", "power"], []]);
  });

  it("tells a status listener once per real change", () => {
    const a = fakeBridge(closed);
    const b = fakeBridge(closed);
    const seen: OutputStatus[] = [];
    combineBridges([a.bridge, b.bridge]).onStatus((s) => seen.push(s));
    b.set(open);
    b.set({ ...open });
    a.set(open);
    expect(seen).toEqual([{ ...open, changedBy: null }]);
  });
});
