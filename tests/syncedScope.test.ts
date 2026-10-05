import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRIVATE_KEYS,
  ROOM_EXCLUDED_PREFIXES,
  VOLATILE_PREFIXES,
  applyRoomStorage,
  applySyncedStorage,
  captureRoomStorage,
  captureSyncedStorage,
  isRoomKey,
  registerSyncedStore,
} from "../src/net/syncedStores.ts";
import { validLookKey } from "../server/lookDoc.ts";

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

// Every `vibe.` key the code writes, classified: true = part of the room look,
// false = one device's own. The scan below keeps this complete, so a store
// added next year has to be sorted into one list or the other.
const CLASSIFIED: Record<string, boolean> = {
  // Look state: what a scene looks like.
  "vibe.sceneSettings": true,
  "vibe.sceneAuto": true,
  "vibe.sceneMaster": true,
  "vibe.sceneExpansion": true,
  "vibe.sceneExpansionShape": true,
  "vibe.drives": true,
  "vibe.sensitivity": true,
  "vibe.expansion": true,
  "vibe.smoothing": true,
  "vibe.acceleration": true, // legacy names of the Expansion store
  "vibe.dynamics": true,
  "vibe.bandSplit": true,
  "vibe.bandFader.": true, // prefix: one key per fader
  "vibe.beatGrid": true,
  "vibe.hitAmount": true,
  "vibe.hitKnee": true,
  "vibe.hitLoudness": true,
  "vibe.hitFloor": true,
  "vibe.hitTailBeat": true,
  "vibe.hitTailLow": true,
  "vibe.hitTailMid": true,
  "vibe.hitTailHigh": true,
  // The Set card's pads and Autopilot dials: a shelf, but one a paired phone must get.
  "vibe.set": true,
  // Rewritten by the laptop's own analysis (the extractor), so it stays there.
  "vibe.silenceGate": false,
  "vibe.silenceGateClosed": false,
  "vibe.silenceGateOpen": false,
  "vibe.silenceGateAuto": false,
  "vibe.autoGain": false,
  "vibe.autoGainAuto": false,
  // This device's own chrome and choices.
  "vibe.deviceId": false,
  "vibe.keyTips": false,
  "vibe.panelFolds": false,
  "vibe.hitTailLinked": false,
  "vibe.hiddenInputs": false,
  "vibe.bakeToast": false,
  "vibe.audioSource": false,
  "vibe.audioInputDevice": false,
  "vibe.quality": false,
  "vibe.powerMode": false,
  "vibe.output.": false,
  "vibe.output.quality": false,
  "vibe.output.powerMode": false,
  "vibe.output.resolution": false,
  "vibe.preview.": false,
  "vibe.preview.quality": false,
  "vibe.preview.size": false,
  "vibe.preview.resolution": false,
  // A library and a dev tool, not the look on screen; and the panel's own chrome.
  "vibe.looks": false,
  "vibe.devPins": false,
  "vibe.panelBlur": false,
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "private") continue; // the paid scenes' checkout is not this repo's
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("isRoomKey", () => {
  it("classifies every key the code names", () => {
    for (const k of Object.keys(CLASSIFIED)) {
      // A trailing dot is a prefix: ask about a key under it.
      const probe = k.endsWith(".") ? `${k}x` : k;
      expect(isRoomKey(probe), k).toBe(CLASSIFIED[k]);
    }
  });

  it("covers every vibe. key literal in src, so a new store has to be classified", () => {
    const root = fileURLToPath(new URL("../src", import.meta.url));
    const found = new Set<string>();
    for (const file of sourceFiles(root)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
        const re = /["'`](vibe\.[A-Za-z][A-Za-z0-9_.]*)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) found.add(m[1]);
      }
    }
    expect(found.size).toBeGreaterThan(0);
    const unclassified = Array.from(found).filter((k) => !(k in CLASSIFIED));
    expect(unclassified).toEqual([]);
  });

  it("keeps every svl. key out of a look, whatever it is", () => {
    for (const k of ["svl.usageMe", "svl.hostRoom", "svl.controllerSession", "svl.tvSession", "svl.pendingAdopt"]) {
      expect(isRoomKey(k), k).toBe(false);
    }
  });

  it("only ever accepts vibe. keys, so prototype-style names cannot be keys", () => {
    for (const k of ["", "vibe", "__proto__", "constructor", "prototype", "toString", "hasOwnProperty"]) {
      expect(isRoomKey(k), k).toBe(false);
    }
  });

  it("rejects every private key, volatile prefix and excluded prefix", () => {
    for (const k of PRIVATE_KEYS) expect(isRoomKey(k), k).toBe(false);
    for (const p of VOLATILE_PREFIXES) expect(isRoomKey(`${p}Whatever`), p).toBe(false);
    for (const p of ROOM_EXCLUDED_PREFIXES) expect(isRoomKey(`${p}Whatever`), p).toBe(false);
  });

  it("pins the pairing sessions as private (they hold room secrets)", () => {
    for (const k of ["svl.hostRoom", "svl.controllerSession", "svl.tvSession", "svl.pendingAdopt"]) {
      expect(PRIVATE_KEYS.has(k), k).toBe(true);
    }
  });

  it("only passes keys the room itself would accept in a look", () => {
    for (const k of Object.keys(CLASSIFIED)) {
      if (!CLASSIFIED[k]) continue;
      const probe = k.endsWith(".") ? `${k}3` : k;
      expect(validLookKey(probe), probe).toBe(true);
    }
    expect(validLookKey("vibe.bandFader.5")).toBe(true);
  });
});

describe("scoped capture", () => {
  it("reads only the keys the scope accepts", () => {
    const live = fakeStorage({
      "vibe.sceneSettings": "{}",
      "vibe.looks": "[]",
      "vibe.devPins": "{}",
      "vibe.preview.resolution": "1",
      "vibe.silenceGateClosed": "0.1",
      "vibe.bandFader.2": "{}",
      "svl.usageMe": "1",
    });
    expect(captureRoomStorage(live)).toEqual({ "vibe.sceneSettings": "{}", "vibe.bandFader.2": "{}" });
  });

  it("without a scope still mirrors everything but the private keys", () => {
    const live = fakeStorage({
      "vibe.sceneSettings": "{}",
      "vibe.looks": "[]",
      "vibe.silenceGateClosed": "0.1",
      "vibe.deviceId": "abc",
      "svl.tvSession": "{}",
    });
    expect(captureSyncedStorage(live)).toEqual({
      "vibe.sceneSettings": "{}",
      "vibe.looks": "[]",
      "vibe.silenceGateClosed": "0.1",
    });
  });

  it("a custom scope narrows the read", () => {
    const live = fakeStorage({ a: "1", b: "2" });
    expect(captureSyncedStorage(live, (k) => k === "b")).toEqual({ b: "2" });
  });
});

describe("scoped apply", () => {
  it("writes and removes only room keys, whatever the snapshot carries", () => {
    const dev = fakeStorage({
      "vibe.sceneSettings": "old",
      "vibe.sceneAuto": "stale",
      "vibe.looks": "[the phone's saved looks]",
      "vibe.deviceId": "me",
      "svl.controllerSession": "secret",
    });
    applyRoomStorage(
      {
        "vibe.sceneSettings": "new",
        "vibe.looks": "[planted]",
        "vibe.deviceId": "planted",
        "svl.tvSession": "planted",
        "vibe.output.quality": "planted",
        "vibe.drives": "{}",
      },
      dev,
    );
    expect(dev.m.get("vibe.sceneSettings")).toBe("new");
    expect(dev.m.get("vibe.drives")).toBe("{}");
    expect(dev.m.has("vibe.sceneAuto")).toBe(false); // absent from the snapshot -> reset
    expect(dev.m.get("vibe.looks")).toBe("[the phone's saved looks]");
    expect(dev.m.get("vibe.deviceId")).toBe("me");
    expect(dev.m.get("svl.controllerSession")).toBe("secret");
    expect(dev.m.has("svl.tvSession")).toBe(false);
    expect(dev.m.has("vibe.output.quality")).toBe(false);
  });

  it("without a scope sets any key it is handed, as the pop-out relies on", () => {
    const priv = fakeStorage({ "vibe.stale": "x", "vibe.deviceId": "keep" });
    applySyncedStorage({ "vibe.looks": "[]", "other.key": "1" }, priv);
    expect(priv.m.get("vibe.looks")).toBe("[]");
    expect(priv.m.get("other.key")).toBe("1");
    expect(priv.m.has("vibe.stale")).toBe(false);
    expect(priv.m.get("vibe.deviceId")).toBe("keep");
  });

  it("a hook that throws does not stop the others", () => {
    const priv = fakeStorage();
    const ran: string[] = [];
    registerSyncedStore("t.first", () => void ran.push("first"));
    registerSyncedStore("t.boom", () => {
      throw new Error("a store that cannot re-read");
    });
    registerSyncedStore("t.last", () => void ran.push("last"));
    expect(() => applyRoomStorage({}, priv)).not.toThrow();
    expect(ran).toContain("first");
    expect(ran).toContain("last");
  });
});
