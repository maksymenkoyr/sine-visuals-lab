import { describe, expect, it } from "vitest";
import { createMidiController, MIDI_MAP_KEY, type MidiEnv } from "../src/ui/midiInput.ts";
import { sceneTargetId, type KeySpec } from "../src/ui/midiMap.ts";

/** A controller with fakes for everything outside it: storage, the scene on
 *  screen, a rAF that runs when told, and a fake MIDI access whose input the
 *  test can fire messages on. */
function setup(opts: { stored?: string; scene?: string; noMidi?: boolean; denied?: boolean; granted?: boolean } = {}) {
  const store = new Map<string, string>();
  if (opts.stored) store.set(MIDI_MAP_KEY, opts.stored);
  const keys: Array<[string, KeySpec]> = [];
  const applied: Array<[string, number]> = [];
  const frames: Array<() => void> = [];
  let scene = opts.scene ?? "storm";
  let requests = 0;
  const input = { name: "Pad Controller", state: "connected", onmidimessage: null as null | ((e: { data: Uint8Array }) => void) };
  const inputs = new Map([["a", input]]);
  const access = { inputs, onstatechange: null as null | (() => void) };
  const env: MidiEnv = {
    requestAccess: opts.noMidi
      ? undefined
      : async () => {
          requests++;
          if (opts.denied) throw new Error("denied");
          return access as unknown as MIDIAccess;
        },
    permissionGranted: async () => opts.granted === true,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    currentSceneId: () => scene,
    applyCc: (t, v) => applied.push([t, v]),
    dispatchKey: (type, key) => keys.push([type, key]),
    schedule: (fn) => frames.push(fn),
  };
  const midi = createMidiController(env);
  const send = (...bytes: number[]) => input.onmidimessage?.({ data: new Uint8Array(bytes) });
  const flush = () => frames.splice(0).forEach((f) => f());
  return { midi, store, keys, applied, send, flush, requests: () => requests, setScene: (s: string) => (scene = s), access, input };
}

const speed = sceneTargetId("storm", "speed");
const ccMap = JSON.stringify([{ kind: "cc", ch: 1, cc: 21, target: speed, label: "Storm · Speed" }]);
const noteMap = JSON.stringify([{ kind: "note", ch: 10, note: 36, key: "q", code: "KeyQ" }]);

describe("connecting", () => {
  it("never asks for MIDI until connect, and reports support", async () => {
    const t = setup();
    expect(t.requests()).toBe(0);
    expect(t.midi.snapshot()).toMatchObject({ supported: true, connected: false, devices: [] });
    await t.midi.connect();
    expect(t.requests()).toBe(1);
    expect(t.midi.snapshot()).toMatchObject({ connected: true, devices: ["Pad Controller"] });
  });

  it("is unsupported where the browser has no Web MIDI", async () => {
    const t = setup({ noMidi: true });
    expect(t.midi.snapshot().supported).toBe(false);
    await t.midi.connect();
    await t.midi.autoConnect();
    expect(t.requests()).toBe(0);
  });

  it("explains a refusal and can be tried again", async () => {
    const t = setup({ denied: true });
    await t.midi.connect();
    expect(t.midi.snapshot().connected).toBe(false);
    expect(t.midi.snapshot().notice).toMatch(/blocked/);
  });

  it("reconnects on a later load only when the permission is already granted", async () => {
    const no = setup({ granted: false });
    await no.midi.autoConnect();
    expect(no.requests()).toBe(0);
    const yes = setup({ granted: true });
    await yes.midi.autoConnect();
    expect(yes.requests()).toBe(1);
    expect(yes.midi.snapshot().connected).toBe(true);
  });

  it("follows a device being unplugged and plugged in", async () => {
    const t = setup();
    await t.midi.connect();
    t.input.state = "disconnected";
    t.access.onstatechange?.();
    expect(t.midi.snapshot().devices).toEqual([]);
    t.input.state = "connected";
    t.access.onstatechange?.();
    expect(t.midi.snapshot().devices).toEqual(["Pad Controller"]);
  });

  it("blinks for notes and controllers but not for clock", async () => {
    const t = setup();
    await t.midi.connect();
    let blinks = 0;
    t.midi.onActivity(() => blinks++);
    t.send(0xf8, 0, 0);
    t.send(0xfe, 0, 0);
    expect(blinks).toBe(0);
    t.send(0xb0, 1, 1);
    t.send(0x90, 60, 100);
    expect(blinks).toBe(2);
  });
});

describe("a knob", () => {
  it("moves its slider once per frame with the latest value", async () => {
    const t = setup({ stored: ccMap });
    await t.midi.connect();
    t.send(0xb0, 21, 10);
    t.send(0xb0, 21, 50);
    t.send(0xb0, 21, 90);
    expect(t.applied).toEqual([]);
    t.flush();
    expect(t.applied).toEqual([[speed, 90]]);
  });

  it("ignores other knobs and other channels", async () => {
    const t = setup({ stored: ccMap });
    await t.midi.connect();
    t.send(0xb0, 22, 90);
    t.send(0xb1, 21, 90);
    t.flush();
    expect(t.applied).toEqual([]);
  });

  it("acts only while its scene is on screen", async () => {
    const t = setup({ stored: ccMap, scene: "mesh" });
    await t.midi.connect();
    t.send(0xb0, 21, 64);
    t.flush();
    expect(t.applied).toEqual([]);
    t.setScene("storm");
    t.send(0xb0, 21, 64);
    t.flush();
    expect(t.applied).toEqual([[speed, 64]]);
  });

  it("drives a Master dial in any scene", async () => {
    const t = setup({
      scene: "mesh",
      stored: JSON.stringify([{ kind: "cc", ch: 1, cc: 7, target: "master/scale", label: "Master · Scale" }]),
    });
    await t.midi.connect();
    t.send(0xb0, 7, 127);
    t.flush();
    expect(t.applied).toEqual([["master/scale", 127]]);
  });
});

describe("a pad", () => {
  it("presses and releases its key, and a velocity-0 note on is a release", async () => {
    const t = setup({ stored: noteMap });
    await t.midi.connect();
    t.send(0x99, 36, 100);
    t.send(0x99, 36, 0);
    t.send(0x99, 36, 100);
    t.send(0x89, 36, 0);
    expect(t.keys.map(([type]) => type)).toEqual(["keydown", "keyup", "keydown", "keyup"]);
    expect(t.keys[0][1]).toMatchObject({ key: "q", code: "KeyQ" });
  });

  it("does not send a keyup for a pad that was never down", async () => {
    const t = setup({ stored: noteMap });
    await t.midi.connect();
    t.send(0x89, 36, 0);
    expect(t.keys).toEqual([]);
  });

  it("lets go of a held key when the controller is unplugged", async () => {
    const t = setup({ stored: noteMap });
    await t.midi.connect();
    t.send(0x99, 36, 100);
    t.input.state = "disconnected";
    t.access.onstatechange?.();
    expect(t.keys.map(([type]) => type)).toEqual(["keydown", "keyup"]);
  });
});

describe("learning", () => {
  const key = (init: Partial<KeyboardEvent>) => init as KeyboardEvent;

  it("learns a knob onto a slider, saves it, and stops", async () => {
    const t = setup();
    await t.midi.connect();
    t.midi.toggleLearn();
    t.midi.pickTarget({ id: speed, label: "Storm · Speed" });
    t.send(0xb0, 21, 33);
    const s = t.midi.snapshot();
    expect(s.learn.step).toBe("idle");
    expect(s.mappings).toEqual([{ kind: "cc", ch: 1, cc: 21, target: speed, label: "Storm · Speed" }]);
    expect(s.notice).toBe("Mapped CC 21 ch 1 → Storm · Speed");
    expect(t.store.get(MIDI_MAP_KEY)).toContain('"cc":21');
    // It acts like any mapping from now on.
    t.send(0xb0, 21, 64);
    t.flush();
    expect(t.applied).toEqual([[speed, 64]]);
  });

  it("does not drive an old mapping while learning", async () => {
    const t = setup({ stored: ccMap });
    await t.midi.connect();
    t.midi.toggleLearn();
    t.send(0xb0, 21, 64);
    t.flush();
    expect(t.applied).toEqual([]);
  });

  it("learns a pad onto the key just pressed, and takes that key from the app", async () => {
    const t = setup();
    await t.midi.connect();
    t.midi.toggleLearn();
    expect(t.midi.learnKey(key({ key: "q", code: "KeyQ" }))).toBe(true);
    expect(t.midi.learnKeyUp(key({ code: "KeyQ" }))).toBe(true);
    t.send(0x99, 36, 100);
    expect(t.midi.snapshot().mappings).toEqual([{ kind: "note", ch: 10, note: 36, key: "q", code: "KeyQ" }]);
    expect(t.keys).toEqual([]); // the learning hit is not also a keypress
    t.send(0x89, 36, 0);
    expect(t.keys).toEqual([]);
  });

  it("can learn Option (Play) and Space, but not a chord", async () => {
    const t = setup();
    await t.midi.connect();
    t.midi.toggleLearn();
    expect(t.midi.learnKey(key({ key: "Alt", code: "AltLeft", altKey: true }))).toBe(true);
    expect(t.midi.learnKey(key({ key: "å", code: "KeyA", altKey: true }))).toBe(false);
    expect(t.midi.learnKey(key({ key: "r", code: "KeyR", metaKey: true }))).toBe(false);
    t.send(0x99, 40, 90);
    expect(t.midi.snapshot().mappings[0]).toMatchObject({ key: "Alt", code: "AltLeft" });
  });

  it("leaves keys alone when not learning, passes Tab, and cancels on Escape", async () => {
    const t = setup();
    await t.midi.connect();
    expect(t.midi.learnKey(key({ key: "q", code: "KeyQ" }))).toBe(false);
    t.midi.toggleLearn();
    expect(t.midi.learnKey(key({ key: "Tab", code: "Tab" }))).toBe(false);
    expect(t.midi.learnKey(key({ key: "Escape", code: "Escape" }))).toBe(true);
    expect(t.midi.snapshot().learn.step).toBe("idle");
    expect(t.midi.learnKey(key({ key: "q", code: "KeyQ" }))).toBe(false);
  });

  it("deletes a mapping and keeps the store in step", () => {
    const t = setup({ stored: ccMap });
    expect(t.midi.snapshot().mappings).toHaveLength(1);
    t.midi.removeAt(0);
    expect(t.midi.snapshot().mappings).toEqual([]);
    expect(t.store.get(MIDI_MAP_KEY)).toBe("[]");
  });

  it("starts from whatever the store holds, junk included", () => {
    expect(setup({ stored: "not json" }).midi.snapshot().mappings).toEqual([]);
  });
});
