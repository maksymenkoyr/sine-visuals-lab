import { describe, expect, it } from "vitest";
import { createLookReplica } from "../src/net/lookSync.ts";
import type { LookDoc } from "../server/lookDoc.ts";

describe("createLookReplica", () => {
  const doc = (storage: Record<string, string>, scene = "plume", palette = "neon"): LookDoc => ({
    scene,
    palette,
    storage,
  });

  it("starts empty at revision zero", () => {
    const r = createLookReplica();
    expect(r.doc()).toBeNull();
    expect(r.rev()).toBe(0);
  });

  it("a snapshot replaces the document and revision", () => {
    const r = createLookReplica();
    r.onSnapshot(3, doc({ "vibe.drives": "1" }));
    expect(r.doc()).toEqual(doc({ "vibe.drives": "1" }));
    expect(r.rev()).toBe(3);
    r.onSnapshot(1, doc({ "vibe.hitAmount": "2" })); // a wiped room restarts the count
    expect(r.doc()).toEqual(doc({ "vibe.hitAmount": "2" }));
    expect(r.rev()).toBe(1);
    r.onSnapshot(0, null);
    expect(r.doc()).toBeNull();
    expect(r.rev()).toBe(0);
  });

  it("sanitises what it is handed", () => {
    const r = createLookReplica();
    r.onSnapshot(1, {
      scene: "plume",
      palette: "neon",
      storage: { "vibe.drives": "1", "not.vibe": "x", "vibe.num": 5 },
    } as unknown as LookDoc);
    expect(r.doc()?.storage).toEqual({ "vibe.drives": "1" });
  });

  it("applies the next patch and reports what changed", () => {
    const r = createLookReplica();
    r.onSnapshot(2, doc({ "vibe.drives": "1", "vibe.hitAmount": "2" }));
    const res = r.onPatch(3, { scene: "storm", set: { "vibe.drives": "9" }, del: ["vibe.hitAmount"] });
    expect(res.status).toBe("applied");
    if (res.status !== "applied") return;
    expect(res.doc).toEqual(doc({ "vibe.drives": "9" }, "storm"));
    expect(res.changed).toEqual({ scene: "storm", set: { "vibe.drives": "9" }, del: ["vibe.hitAmount"] });
    expect(r.doc()).toEqual(res.doc);
    expect(r.rev()).toBe(3);
  });

  it("changed holds only what actually differed", () => {
    const r = createLookReplica();
    r.onSnapshot(1, doc({ "vibe.drives": "1" }));
    const res = r.onPatch(2, { scene: "plume", set: { "vibe.drives": "1", "vibe.hitAmount": "2" } });
    expect(res.status === "applied" && res.changed).toEqual({ set: { "vibe.hitAmount": "2" } });
  });

  it("calls a patch it has seen stale, and a skipped one a gap", () => {
    const r = createLookReplica();
    r.onSnapshot(5, doc({ "vibe.drives": "1" }));
    expect(r.onPatch(5, { set: { "vibe.drives": "x" } })).toEqual({ status: "stale" });
    expect(r.onPatch(2, { set: { "vibe.drives": "x" } })).toEqual({ status: "stale" });
    expect(r.onPatch(7, { set: { "vibe.drives": "x" } })).toEqual({ status: "gap" });
    expect(r.doc()?.storage["vibe.drives"]).toBe("1");
    expect(r.rev()).toBe(5);
  });

  it("builds a first document from patches on an empty room", () => {
    const r = createLookReplica();
    r.onSnapshot(0, null);
    const res = r.onPatch(1, { scene: "plume", palette: "neon", set: { "vibe.drives": "1" } });
    expect(res.status).toBe("applied");
    expect(r.doc()).toEqual(doc({ "vibe.drives": "1" }));
  });

  it("a patch that would not fit asks for a resync", () => {
    const r = createLookReplica();
    r.onSnapshot(1, doc({}));
    const big = "x".repeat(60000);
    const set: Record<string, string> = {};
    for (let i = 0; i < 4; i++) set[`vibe.big${i}`] = big;
    expect(r.onPatch(2, { set })).toEqual({ status: "gap" });
  });
});
