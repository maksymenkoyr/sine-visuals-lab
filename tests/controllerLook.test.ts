import { describe, expect, it } from "vitest";
import { createControllerLook, type ControllerLook, type ControllerLookDevice } from "../src/net/controllerLook.ts";
import { createLookSync, type LookSync } from "../src/net/lookSync.ts";
import type { LookClientMsg, LookDoc } from "../server/lookDoc.ts";

// A phone: the palettes and scenes its build has, and what it shows now.
interface Phone {
  palettes: string[];
  scenes: string[];
  palette: string;
  scene: string;
  storage: Record<string, string>;
  log: string[];
}

function phone(over: Partial<Phone> = {}): Phone {
  return { palettes: ["neon", "ember"], scenes: ["mesh", "sky"], palette: "neon", scene: "mesh", storage: {}, log: [], ...over };
}

function deviceOf(p: Phone, look: () => ControllerLook): ControllerLookDevice {
  return {
    paletteId: () => p.palette,
    canShowPalette: (id) => p.palettes.includes(id),
    showPalette(id) {
      p.log.push(`palette:${id}`);
      p.palette = id;
      look().notePalette(id); // app.ts: applyPalette
    },
    showScene(id) {
      if (!p.scenes.includes(id) || id === p.scene) return;
      p.log.push(`scene:${id}`);
      p.scene = id;
      look().noteScene(id); // app.ts: applyScene
    },
    captureStorage: () => ({ ...p.storage }),
    applyStorage(storage) {
      p.log.push("storage");
      p.storage = { ...storage };
    },
  };
}

interface Rig {
  p: Phone;
  look: ControllerLook;
  sync: LookSync;
  sent: LookClientMsg[];
}

function rig(over: Partial<Phone> = {}): Rig {
  const p = phone(over);
  const sent: LookClientMsg[] = [];
  const ref: { look: ControllerLook | null } = { look: null };
  const look = createControllerLook(deviceOf(p, () => ref.look as ControllerLook));
  ref.look = look;
  const sync = createLookSync({ read: look.io.read, write: look.io.write, send: (m) => (sent.push(m), true) });
  return { p, look, sync, sent };
}

const doc = (scene: string, palette: string, storage: Record<string, string> = {}): LookDoc => ({ scene, palette, storage });

describe("createControllerLook", () => {
  it("reads the device's own look until the room or the phone has said otherwise", () => {
    const r = rig({ palette: "ember" });
    expect(r.look.io.read()).toEqual({ scene: "", palette: "ember", storage: {} });
  });

  it("shows the room's palette and scene, storage first", () => {
    const r = rig();
    r.look.io.write(doc("sky", "ember", { "vibe.x": "1" }));
    expect(r.p.log).toEqual(["storage", "palette:ember", "scene:sky"]);
    expect(r.look.io.read()).toEqual({ scene: "sky", palette: "ember", storage: { "vibe.x": "1" } });
  });

  it("an empty scene or palette is no opinion", () => {
    const r = rig({ palette: "ember" });
    r.look.io.write(doc("", ""));
    expect(r.look.io.read()).toEqual({ scene: "", palette: "ember", storage: {} });
    expect(r.p.log).toEqual(["storage"]);
  });

  it("remembers the room's palette when this build has no such palette", () => {
    const r = rig();
    r.look.io.write(doc("mesh", "aurora"));
    expect(r.p.palette).toBe("neon");
    expect(r.look.io.read().palette).toBe("aurora");
  });

  it("remembers the room's scene when this phone cannot mount it", () => {
    const r = rig();
    r.look.io.write(doc("storm", "neon"));
    expect(r.p.scene).toBe("mesh");
    expect(r.look.io.read().scene).toBe("storm");
  });

  it("follows the phone's own picks afterwards", () => {
    const r = rig();
    r.look.io.write(doc("storm", "aurora"));
    r.look.notePalette("ember");
    r.look.noteScene("sky");
    expect(r.look.io.read()).toMatchObject({ scene: "sky", palette: "ember" });
  });
});

describe("a phone that cannot show the room's palette", () => {
  it("does not publish its own palette over the room's after another controller changes it", () => {
    const r = rig();
    r.sync.onSnapshot(4, doc("mesh", "neon"));
    r.sync.tick();
    expect(r.sent).toEqual([]);

    r.sync.onPatch(5, { palette: "aurora" }); // a newer build's palette
    r.sync.tick();
    expect(r.p.palette).toBe("neon");
    expect(r.sent).toEqual([]);
  });

  it("does not publish it after a reconnect either", () => {
    const r = rig();
    r.sync.onSnapshot(4, doc("mesh", "aurora"));
    r.sync.tick();
    r.sync.onDisconnect();
    r.sync.onSnapshot(6, doc("mesh", "aurora"));
    r.sync.tick();
    expect(r.sent).toEqual([]);
  });

  it("still publishes a palette the phone's own user picks", () => {
    const r = rig();
    r.sync.onSnapshot(4, doc("mesh", "aurora"));
    r.look.notePalette("ember");
    r.p.palette = "ember";
    r.sync.tick();
    expect(r.sent).toEqual([{ type: "lookPatch", n: 1, palette: "ember" }]);
  });

  it("takes a palette it can show, and publishes nothing for it", () => {
    const r = rig();
    r.sync.onSnapshot(4, doc("mesh", "neon"));
    r.sync.onPatch(5, { palette: "ember" });
    r.sync.tick();
    expect(r.p.palette).toBe("ember");
    expect(r.sent).toEqual([]);
  });
});

describe("a phone that cannot mount the room's scene", () => {
  it("does not publish its fallback scene over the room's", () => {
    const r = rig();
    r.sync.onSnapshot(4, doc("storm", "neon"));
    r.sync.tick();
    r.sync.onPatch(5, { scene: "plume" });
    r.sync.tick();
    expect(r.p.scene).toBe("mesh");
    expect(r.sent).toEqual([]);
  });
});
