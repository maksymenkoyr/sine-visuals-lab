import { describe, it, expect } from "vitest";
import { diffLooks, dropRowText, takeRow, type LookRow } from "../src/net/lookDiff.ts";
import type { OutputState } from "../src/net/outputSync.ts";

const params = { sens: 1, exp: 1, smoothing: 1 };
const look = (storage: Record<string, string> = {}, scene = "spectrum", palette = "neon"): OutputState => ({
  scene,
  palette,
  storage,
  params,
});
const json = (v: unknown) => JSON.stringify(v);

describe("diffLooks", () => {
  it("gives no rows for identical looks", () => {
    const s = { "vibe.sceneMaster": "1", "vibe.sceneSettings": json({ spectrum: { bars: 4 } }) };
    expect(diffLooks(look(s), look({ ...s }))).toEqual([]);
  });

  it("a different scene is one row, even when the storage differs too", () => {
    const next = look({ "vibe.sceneMaster": "1.4" }, "mesh");
    const live = look({ "vibe.sceneMaster": "1" }, "spectrum");
    expect(diffLooks(next, live)).toEqual([{ id: "scene", kind: "scene", from: "spectrum", to: "mesh" }]);
  });

  it("a palette change is its own row", () => {
    expect(diffLooks(look({}, "spectrum", "mono"), look({}, "spectrum", "neon"))).toEqual([
      { id: "palette", kind: "palette", from: "neon", to: "mono" },
    ]);
  });

  it("two changed settings in one scope are two entry rows with their values", () => {
    const next = look({ "vibe.sceneSettings": json({ spectrum: { bars: 8, glow: 2 } }) });
    const live = look({ "vibe.sceneSettings": json({ spectrum: { bars: 4, glow: 2 } }) });
    const rows = diffLooks(next, live);
    expect(rows).toEqual([
      {
        id: "e:vibe.sceneSettings|spectrum|bars",
        kind: "entry",
        storageKey: "vibe.sceneSettings",
        scope: "spectrum",
        key: "bars",
        from: 4,
        to: 8,
      },
    ]);
    const twice = diffLooks(next, look({ "vibe.sceneSettings": json({ spectrum: { bars: 4, glow: 1 } }) }));
    expect(twice.map((r) => r.id)).toEqual([
      "e:vibe.sceneSettings|spectrum|bars",
      "e:vibe.sceneSettings|spectrum|glow",
    ]);
  });

  it("a setting present only in NEXT has no from", () => {
    const next = look({ "vibe.sceneSettings": json({ spectrum: { bars: 8 } }) });
    const live = look({ "vibe.sceneSettings": json({}) });
    expect(diffLooks(next, live)).toEqual([
      {
        id: "e:vibe.sceneSettings|spectrum|bars",
        kind: "entry",
        storageKey: "vibe.sceneSettings",
        scope: "spectrum",
        key: "bars",
        from: undefined,
        to: 8,
      },
    ]);
  });

  it("a drive entry change is an entry row under vibe.drives", () => {
    const next = look({ "vibe.drives": json({ spectrum: { bars: { source: "kick" } } }) });
    const live = look({ "vibe.drives": json({ spectrum: { bars: { source: "level" } } }) });
    expect(diffLooks(next, live)).toEqual([
      {
        id: "e:vibe.drives|spectrum|bars",
        kind: "entry",
        storageKey: "vibe.drives",
        scope: "spectrum",
        key: "bars",
        from: { source: "level" },
        to: { source: "kick" },
      },
    ]);
  });

  it("a plain key change is one key row with the raw texts", () => {
    expect(diffLooks(look({ "vibe.sceneMaster": "1.4" }), look({ "vibe.sceneMaster": "1" }))).toEqual([
      { id: "k:vibe.sceneMaster", kind: "key", storageKey: "vibe.sceneMaster", from: "1", to: "1.4" },
    ]);
  });

  it("ignores shelf keys and volatile keys", () => {
    const next = look({ "vibe.set": "[1]", "vibe.looks": "x", "vibe.silenceGateOpen": "0.9" });
    const live = look({ "vibe.set": "[]", "vibe.looks": "", "vibe.silenceGateOpen": "0.1" });
    expect(diffLooks(next, live)).toEqual([]);
  });

  it("reads unreadable LIVE nested text as empty, so every NEXT entry shows", () => {
    const next = look({ "vibe.sceneSettings": json({ spectrum: { bars: 8 } }) });
    const live = look({ "vibe.sceneSettings": "{not json" });
    const rows = diffLooks(next, live);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "entry", scope: "spectrum", key: "bars", from: undefined, to: 8 });
  });
});

describe("takeRow", () => {
  const next = look({ "vibe.sceneSettings": json({ spectrum: { bars: 8, glow: 2 } }) });
  const live = look({ "vibe.sceneSettings": json({ spectrum: { bars: 4, glow: 1 } }) });
  const barsRow = diffLooks(next, live).find((r) => r.id === "e:vibe.sceneSettings|spectrum|bars") as LookRow;

  it("takes one entry from NEXT and leaves the other as LIVE had it", () => {
    const out = takeRow(live, next, barsRow);
    expect(JSON.parse(out.storage["vibe.sceneSettings"])).toEqual({ spectrum: { bars: 8, glow: 1 } });
    const rows = diffLooks(next, out).map((r) => r.id);
    expect(rows).not.toContain(barsRow.id);
    expect(rows).toEqual(["e:vibe.sceneSettings|spectrum|glow"]);
  });

  it("does not mutate its inputs", () => {
    const nextBefore = json(next);
    const liveBefore = json(live);
    takeRow(live, next, barsRow);
    expect(json(next)).toBe(nextBefore);
    expect(json(live)).toBe(liveBefore);
  });

  it("a scene row gives NEXT itself, and a palette row takes NEXT's palette", () => {
    const n = look({}, "mesh", "mono");
    const l = look({}, "spectrum", "neon");
    const [sceneRow] = diffLooks(n, l);
    expect(takeRow(l, n, sceneRow)).toBe(n);
    const paletteRow = diffLooks(look({}, "spectrum", "mono"), l)[0];
    expect(takeRow(l, look({}, "spectrum", "mono"), paletteRow).palette).toBe("mono");
  });

  it("a key row removes the key when NEXT has none", () => {
    const n = look({});
    const l = look({ "vibe.sceneMaster": "1" });
    const [row] = diffLooks(n, l);
    expect(takeRow(l, n, row).storage).toEqual({});
  });
});

describe("dropRowText", () => {
  const next = look({ "vibe.sceneSettings": json({ spectrum: { bars: 8, glow: 2 } }), "vibe.sceneMaster": "1.4" });
  const live = look({ "vibe.sceneSettings": json({ spectrum: { bars: 4, glow: 2 } }), "vibe.sceneMaster": "1" });

  it("an entry row gives NEXT's text with LIVE's entry put back", () => {
    const row = diffLooks(next, live)[0];
    const text = dropRowText(next, live, row);
    expect(JSON.parse(text as string)).toEqual({ spectrum: { bars: 4, glow: 2 } });
  });

  it("a key row gives LIVE's raw text, null when LIVE has none", () => {
    const row = diffLooks(next, live).find((r) => r.kind === "key") as LookRow;
    expect(dropRowText(next, live, row)).toBe("1");
    const onlyNext = look({ "vibe.sceneMaster": "1.4" });
    const rowNew = diffLooks(onlyNext, look({}))[0];
    expect(dropRowText(onlyNext, look({}), rowNew)).toBeNull();
  });

  it("a scene or palette row gives undefined", () => {
    const [sceneRow] = diffLooks(look({}, "mesh"), look({}, "spectrum"));
    expect(dropRowText(look({}, "mesh"), look({}, "spectrum"), sceneRow)).toBeUndefined();
  });

  it("after writing the text into NEXT's storage, the row is gone from the list", () => {
    const rows = diffLooks(next, live);
    const entry = rows.find((r) => r.kind === "entry") as LookRow;
    const text = dropRowText(next, live, entry);
    const dropped = look({ ...next.storage, "vibe.sceneSettings": text as string });
    const left = diffLooks(dropped, live).map((r) => r.id);
    expect(left).not.toContain(entry.id);
    expect(left).toContain("k:vibe.sceneMaster");
  });

  it("dropping the only entry in a scope removes the scope, and an empty object removes the key", () => {
    const n = look({ "vibe.sceneSettings": json({ spectrum: { bars: 8 } }) });
    const l = look({ "vibe.sceneSettings": json({}) });
    const [row] = diffLooks(n, l);
    expect(dropRowText(n, l, row)).toBeNull();
  });
});
