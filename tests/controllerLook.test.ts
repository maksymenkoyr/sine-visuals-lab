import { describe, expect, it } from "vitest";
import { createControllerLook, type ControllerLook, type ControllerLookDevice } from "../src/net/controllerLook.ts";
import { createMainPlay, type MainPlay } from "../src/net/mainPlay.ts";
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
  /** The phone's side of the room's Main, over this phone's look. */
  main: MainPlay;
  sent: LookClientMsg[];
}

function rig(over: Partial<Phone> = {}): Rig {
  const p = phone(over);
  const sent: LookClientMsg[] = [];
  const ref: { look: ControllerLook | null } = { look: null };
  const look = createControllerLook(deviceOf(p, () => ref.look as ControllerLook));
  ref.look = look;
  const main = createMainPlay({
    send: (m) => (sent.push(m), true),
    capture: look.io.read,
    apply: (d) => look.io.write(d),
    screen: () => "main",
    isOwner: false,
    nameOf: () => null,
  });
  return { p, look, main, sent };
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
  it("does not play its own palette over the room's after another device changes it", () => {
    const r = rig();
    r.main.onSnapshot(4, doc("mesh", "neon"));
    r.main.tick(1000);
    expect(r.main.play()).toBeNull();

    r.main.onPatch(5, { palette: "aurora" }); // a newer build's palette
    r.main.tick(2000);
    expect(r.p.palette).toBe("neon");
    expect(r.main.status().onAir).toBe(true);
    expect(r.main.play()).toBeNull();
    expect(r.sent).toEqual([]);
  });

  it("does not play it after a reconnect either", () => {
    const r = rig();
    r.main.onSnapshot(4, doc("mesh", "aurora"));
    r.main.onDisconnect();
    r.main.onSnapshot(6, doc("mesh", "aurora"));
    expect(r.main.play()).toBeNull();
    expect(r.sent).toEqual([]);
  });

  it("still plays a palette the phone's own user picks", () => {
    const r = rig();
    r.main.onSnapshot(4, doc("mesh", "aurora"));
    r.look.notePalette("ember");
    r.p.palette = "ember";
    expect(r.main.play()).toBe("sent");
    expect(r.sent).toEqual([{ type: "lookPatch", n: 1, palette: "ember" }]);
  });

  it("takes a palette it can show, and plays nothing for it", () => {
    const r = rig();
    r.main.onSnapshot(4, doc("mesh", "neon"));
    r.main.onPatch(5, { palette: "ember" });
    expect(r.p.palette).toBe("ember");
    expect(r.main.play()).toBeNull();
    expect(r.sent).toEqual([]);
  });
});

describe("a phone that cannot mount the room's scene", () => {
  it("does not play its fallback scene over the room's", () => {
    const r = rig();
    r.main.onSnapshot(4, doc("storm", "neon"));
    expect(r.main.play()).toBeNull();
    r.main.onPatch(5, { scene: "plume" });
    expect(r.p.scene).toBe("mesh");
    expect(r.main.play()).toBeNull();
    expect(r.sent).toEqual([]);
  });
});
