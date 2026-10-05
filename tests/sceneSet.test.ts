import { afterEach, describe, expect, it, vi } from "vitest";
import type { SceneSetting } from "../src/render/sceneSettings.ts";
import { getSceneSetting, setSceneSetting } from "../src/render/sceneSettings.ts";
import { applyLook, type SceneLook } from "../src/render/sceneLooks.ts";
import { applyRoomStorage, captureRoomStorage, isRoomKey } from "../src/net/syncedStores.ts";
import {
  AUTOPILOT_EVERY_DEFAULT,
  SET_MAX_CHARS,
  SET_MAX_PADS,
  addCapturedPad,
  addPad,
  capturePad,
  defaultPadName,
  emptySet,
  getAutopilot,
  getSet,
  listPads,
  parseSet,
  removePad,
  removeStoredPad,
  renamePad,
  renameStoredPad,
  serializeSet,
  setAutopilot,
  withAutopilot,
} from "../src/render/sceneSet.ts";

// Vitest runs under environment: "node" — no localStorage global, so the store
// half is exercised as the in-memory cache it is when storage is unavailable.

const FOCUS: SceneSetting = { key: "setFocus", label: "Focus", min: 0, max: 1, step: 0.01, default: 0.5 };
const look = (sceneId: string, focus = 0.3): SceneLook => ({ name: "x", sceneId, manual: { setFocus: focus } });

function filled(n: number): ReturnType<typeof emptySet> {
  let doc = emptySet();
  for (let i = 0; i < n; i++) {
    const r = addPad(doc, look("mesh", i / 10), "neon");
    if (!r.ok) throw new Error(r.reason);
    doc = r.doc;
  }
  return doc;
}

describe("capture", () => {
  it("captures the scene's current look and the palette as a pad", () => {
    setSceneSetting("setScene", FOCUS, 0.8);
    const r = capturePad(emptySet(), "setScene", [FOCUS], "sunset");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pad.paletteId).toBe("sunset");
    expect(r.pad.look.sceneId).toBe("setScene");
    expect(r.pad.look.manual.setFocus).toBe(0.8);
    expect(r.doc.pads).toHaveLength(1);
  });

  it("embeds its own copy: later changes to the scene do not touch the pad", () => {
    setSceneSetting("setCopy", FOCUS, 0.2);
    const r = capturePad(emptySet(), "setCopy", [FOCUS], "neon");
    if (!r.ok) throw new Error("add refused");
    setSceneSetting("setCopy", FOCUS, 0.9);
    expect(r.pad.look.manual.setFocus).toBe(0.2);
  });

  it("applying a pad sets the scene to its look", () => {
    setSceneSetting("setApply", FOCUS, 0.2);
    const r = capturePad(emptySet(), "setApply", [FOCUS], "neon");
    if (!r.ok) throw new Error("add refused");
    setSceneSetting("setApply", FOCUS, 0.9);
    applyLook(r.pad.look, [FOCUS]);
    expect(getSceneSetting("setApply", FOCUS)).toBe(0.2);
  });

  it("names pads by the lowest free number within their scene", () => {
    let doc = emptySet();
    const a = addPad(doc, look("mesh"), "neon");
    if (!a.ok) throw new Error();
    doc = a.doc;
    const b = addPad(doc, look("mesh"), "neon");
    if (!b.ok) throw new Error();
    doc = b.doc;
    expect(doc.pads.map((p) => p.name)).toEqual(["Look 1", "Look 2"]);
    expect(defaultPadName(removePad(doc, doc.pads[0]!.id).pads, "mesh")).toBe("Look 1");
    expect(defaultPadName(doc.pads, "storm")).toBe("Look 1");
  });
});

describe("pad cap", () => {
  it("refuses a pad past SET_MAX_PADS", () => {
    const doc = filled(SET_MAX_PADS);
    expect(doc.pads).toHaveLength(SET_MAX_PADS);
    const r = addPad(doc, look("mesh"), "neon");
    expect(r).toEqual({ ok: false, reason: "full" });
  });

  it("refuses a pad that would make the stored text too big", () => {
    const heavy: SceneLook = { name: "", sceneId: "mesh", manual: {} };
    for (let i = 0; i < 4000; i++) heavy.manual[`setting${i}`] = i / 7;
    let doc = emptySet();
    let reason = "";
    for (let i = 0; i < SET_MAX_PADS; i++) {
      const r = addPad(doc, heavy, "neon");
      if (!r.ok) {
        reason = r.reason;
        break;
      }
      doc = r.doc;
    }
    expect(reason).toBe("tooBig");
    expect(serializeSet(doc).length).toBeLessThanOrEqual(SET_MAX_CHARS);
  });

  it("never hands out an id twice, even after a delete", () => {
    let doc = filled(2);
    const gone = doc.pads[1]!.id;
    doc = removePad(doc, gone);
    const r = addPad(doc, look("mesh"), "neon");
    if (!r.ok) throw new Error();
    expect(r.pad.id).not.toBe(gone);
  });
});

describe("rename and delete", () => {
  it("renames a pad, trimmed", () => {
    const doc = filled(2);
    const id = doc.pads[1]!.id;
    const next = renamePad(doc, id, "  Drop  ");
    expect(next.pads[1]!.name).toBe("Drop");
    expect(next.pads[0]!.name).toBe(doc.pads[0]!.name);
  });

  it("keeps the name on a blank or unchanged rename", () => {
    const doc = filled(1);
    expect(renamePad(doc, doc.pads[0]!.id, "   ")).toBe(doc);
    expect(renamePad(doc, doc.pads[0]!.id, doc.pads[0]!.name)).toBe(doc);
  });

  it("deletes a pad and keeps the others in order", () => {
    const doc = filled(3);
    const next = removePad(doc, doc.pads[1]!.id);
    expect(next.pads.map((p) => p.id)).toEqual([doc.pads[0]!.id, doc.pads[2]!.id]);
    expect(removePad(next, "nope")).toBe(next);
  });
});

describe("serialize / parse", () => {
  it("round-trips pads, palettes and the autopilot dials", () => {
    let doc = filled(2);
    doc = renamePad(doc, doc.pads[0]!.id, "Drop");
    doc = withAutopilot(doc, { on: true, everyBars: 32, order: "shuffle" });
    const back = parseSet(serializeSet(doc));
    expect(back.pads.map((p) => [p.id, p.name, p.paletteId, p.look.sceneId, p.look.manual])).toEqual(
      doc.pads.map((p) => [p.id, p.name, p.paletteId, p.look.sceneId, p.look.manual]),
    );
    expect(back.next).toBe(doc.next);
    expect(back.autopilot).toEqual({ on: true, everyBars: 32, order: "shuffle" });
  });

  it("reads anything unreadable as an empty Set", () => {
    for (const raw of [null, "", "{", "[]", '{"v":9,"pads":[]}', '{"v":1}']) expect(parseSet(raw).pads).toEqual([]);
  });

  it("drops a pad whose look no longer decodes and clamps a planted store", () => {
    const parsed = JSON.parse(serializeSet(filled(1)));
    const good = parsed.pads[0];
    parsed.pads.push({ id: "p99", name: "bad", palette: "neon", look: "###" });
    for (let i = 0; i < 20; i++) parsed.pads.push({ ...good, id: `q${i}` });
    parsed.autopilot = { on: "yes", everyBars: 5, order: "sideways" };
    const doc = parseSet(JSON.stringify(parsed));
    expect(doc.pads.length).toBeLessThanOrEqual(SET_MAX_PADS);
    expect(doc.pads.some((p) => p.id === "p99")).toBe(false);
    expect(doc.autopilot).toEqual({ on: false, everyBars: AUTOPILOT_EVERY_DEFAULT, order: "inOrder" });
  });
});

describe("the store", () => {
  it("adds, renames and deletes through the cache", () => {
    setSceneSetting("setStore", FOCUS, 0.4);
    const r = addCapturedPad("setStore", [FOCUS], "neon");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(listPads().some((p) => p.id === r.pad.id)).toBe(true);
    renameStoredPad(r.pad.id, "Chorus");
    expect(getSet().pads.find((p) => p.id === r.pad.id)?.name).toBe("Chorus");
    removeStoredPad(r.pad.id);
    expect(listPads().some((p) => p.id === r.pad.id)).toBe(false);
  });

  it("keeps the autopilot dials, refusing a value outside the list", () => {
    setAutopilot({ on: true, everyBars: 8 });
    expect(getAutopilot()).toMatchObject({ on: true, everyBars: 8 });
    setAutopilot({ everyBars: 7 });
    expect(getAutopilot().everyBars).toBe(AUTOPILOT_EVERY_DEFAULT);
    setAutopilot({ on: false });
  });
});

describe("reaching a paired phone", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeStorage(init: Record<string, string> = {}) {
    const m = new Map<string, string>(Object.entries(init));
    return {
      m,
      get length() {
        return m.size;
      },
      key: (i: number) => [...m.keys()][i] ?? null,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  }

  it("is part of the room's look, so a phone is sent it", () => {
    expect(isRoomKey("vibe.set")).toBe(true);
  });

  it("re-seeds from a room snapshot: the pads a laptop played show up on the phone", () => {
    const laptop = filled(2);
    const phone = fakeStorage();
    vi.stubGlobal("localStorage", phone);
    applyRoomStorage({ "vibe.set": serializeSet(laptop) }, phone);
    expect(listPads().map((p) => p.id)).toEqual(laptop.pads.map((p) => p.id));
    expect(captureRoomStorage(phone)["vibe.set"]).toBe(serializeSet(laptop));
    // And a snapshot without it empties the phone's Set, as for any other store.
    applyRoomStorage({}, phone);
    expect(listPads()).toEqual([]);
  });
});
