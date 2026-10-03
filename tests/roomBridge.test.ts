import { describe, expect, it } from "vitest";
import { combineBridges, createRoomBridge } from "../src/net/roomBridge.ts";
import type { OutputBridge, OutputStatus } from "../src/net/outputBridge.ts";
import type { LookClientMsg } from "../server/lookDoc.ts";

function setup() {
  const sent: LookClientMsg[] = [];
  const env = {
    open: true,
    screens: 1,
    scene: "mesh",
    palette: "neon",
    storage: { "vibe.a": "1" } as Record<string, string>,
  };
  const bridge = createRoomBridge({
    send: (m) => {
      if (!env.open) return false;
      sent.push(m);
      return true;
    },
    screens: () => env.screens,
    look: () => ({ scene: env.scene, palette: env.palette }),
    capture: () => ({ ...env.storage }),
    showRoom: () => {},
  });
  let now = 1000;
  /** One render tick, far enough on that the look is re-read. */
  const tick = (): void => {
    now += 200;
    bridge.update(now);
  };
  return { bridge, env, sent, tick };
}

describe("createRoomBridge", () => {
  it("is not open until the roster lists a screen, and says nothing until then", () => {
    const { bridge, env, sent, tick } = setup();
    env.screens = 0;
    tick();
    expect(bridge.status()).toEqual({ open: false, cue: false, differs: false });
    expect(sent).toEqual([]);
    expect(bridge.go()).toBe(false);
  });

  it("sends the whole look as the program when a screen arrives", () => {
    const { bridge, sent, tick } = setup();
    tick();
    expect(bridge.status().open).toBe(true);
    expect(sent).toEqual([{ type: "lookPatch", n: 1, scene: "mesh", palette: "neon", set: { "vibe.a": "1" } }]);
  });

  it("keeps the screen's program while the preview is tuned, and shows it as differing", () => {
    const { bridge, env, sent, tick } = setup();
    tick();
    env.storage["vibe.a"] = "2";
    tick();
    expect(sent).toHaveLength(1);
    expect(bridge.status().differs).toBe(true);
  });

  it("Cue puts the preview on the screen and follows it live; releasing puts the program back", () => {
    const { bridge, env, sent, tick } = setup();
    tick();
    env.storage["vibe.a"] = "2";
    tick();
    bridge.setCue(true);
    expect(sent[1]).toMatchObject({ type: "lookPatch", set: { "vibe.a": "2" } });
    env.storage["vibe.a"] = "3";
    tick();
    expect(sent[2]).toMatchObject({ set: { "vibe.a": "3" } });
    expect(bridge.status().cue).toBe(true);
    bridge.setCue(false);
    expect(sent[3]).toMatchObject({ set: { "vibe.a": "1" } });
    expect(bridge.status().differs).toBe(true);
  });

  it("Play makes the preview the program, and a plain Play carries no glide", () => {
    const { bridge, env, sent, tick } = setup();
    tick();
    env.storage["vibe.a"] = "2";
    tick();
    expect(bridge.go()).toBe(false);
    expect(sent[1]).toEqual({ type: "lookPatch", n: 2, set: { "vibe.a": "2" } });
    expect(bridge.status().differs).toBe(false);
  });

  it("Play held glides within a scene, and the patch carries the length", () => {
    const { bridge, env, sent, tick } = setup();
    tick();
    env.storage["vibe.a"] = "2";
    tick();
    expect(bridge.go(4000)).toBe(true);
    expect(sent[1]).toMatchObject({ set: { "vibe.a": "2" }, glideMs: 4000 });
  });

  it("never glides across a scene change: that is sent at once", () => {
    const { bridge, env, sent, tick } = setup();
    tick();
    env.scene = "sky";
    tick();
    expect(bridge.go(4000)).toBe(false);
    expect(sent[1]).toEqual({ type: "lookPatch", n: 2, scene: "sky" });
  });

  it("sends everything again after a reconnect or a refusal", () => {
    const { bridge, env, sent, tick } = setup();
    tick();
    bridge.reconnected();
    expect(sent[1]).toEqual({ type: "lookPatch", n: 2, scene: "mesh", palette: "neon", set: { "vibe.a": "1" } });
    bridge.refused();
    env.storage["vibe.a"] = "2";
    tick();
    bridge.setCue(true);
    expect(sent[2]).toEqual({ type: "lookPatch", n: 3, scene: "mesh", palette: "neon", set: { "vibe.a": "2" } });
  });

  it("does not count a look as delivered while the socket is down, and delivers it later", () => {
    const { bridge, env, sent, tick } = setup();
    env.open = false;
    tick();
    expect(sent).toEqual([]);
    env.open = true;
    bridge.reconnected();
    expect(sent).toHaveLength(1);
  });

  it("forgets the program when the last screen leaves and starts over when one returns", () => {
    const { bridge, env, sent, tick } = setup();
    tick();
    env.screens = 0;
    tick();
    expect(bridge.status().open).toBe(false);
    env.storage["vibe.a"] = "9";
    env.screens = 1;
    tick();
    expect(sent[1]).toEqual({ type: "lookPatch", n: 2, scene: "mesh", palette: "neon", set: { "vibe.a": "9" } });
  });

  it("calls status listeners only when the status changes", () => {
    const { bridge, env, tick } = setup();
    const seen: OutputStatus[] = [];
    bridge.onStatus((s) => seen.push(s));
    tick();
    tick();
    expect(seen).toEqual([{ open: true, cue: false, differs: false }]);
    env.storage["vibe.a"] = "2";
    tick();
    expect(seen[1]).toEqual({ open: true, cue: false, differs: true });
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
  const closed: OutputStatus = { open: false, cue: false, differs: false };
  const open: OutputStatus = { open: true, cue: false, differs: false };

  it("is open while any output is, and differs or cues while any does", () => {
    const a = fakeBridge(closed);
    const b = fakeBridge({ open: true, cue: true, differs: true });
    expect(combineBridges([a.bridge, b.bridge]).status()).toEqual({ open: true, cue: true, differs: true });
    expect(combineBridges([a.bridge, fakeBridge(closed).bridge]).status()).toEqual(closed);
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
    b.set({ open: true, cue: false, differs: false });
    a.set(open);
    expect(seen).toEqual([open]);
  });
});
