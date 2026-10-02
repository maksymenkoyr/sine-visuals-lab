import { describe, expect, it } from "vitest";
import {
  LOOK_LIMITS,
  applyLookPatch,
  diffLook,
  docBytes,
  emptyLookDoc,
  isEmptyPatch,
  sanitizeLookDoc,
  sanitizeLookPatch,
  utf8Length,
  validLookId,
  validLookKey,
  type LookDoc,
} from "../server/lookDoc.ts";

function doc(storage: Record<string, string>, scene = "mesh", palette = "neon"): LookDoc {
  return { scene, palette, storage };
}

describe("validLookKey", () => {
  it("accepts vibe.* keys the stores actually use", () => {
    expect(validLookKey("vibe.sceneSettings")).toBe(true);
    expect(validLookKey("vibe.bandFader.3")).toBe(true);
    expect(validLookKey("vibe.strain@a:b-c")).toBe(true);
  });

  it("rejects names that could poison a plain object", () => {
    expect(validLookKey("__proto__")).toBe(false);
    expect(validLookKey("constructor")).toBe(false);
    expect(validLookKey("prototype")).toBe(false);
    expect(validLookKey("toString")).toBe(false);
  });

  it("requires something after the vibe. prefix", () => {
    expect(validLookKey("vibe.")).toBe(false);
    expect(validLookKey("vibe")).toBe(false);
    expect(validLookKey("svl.hostRoom")).toBe(false);
    expect(validLookKey("xvibe.a")).toBe(false);
  });

  it("rejects odd characters, non-strings and over-long keys", () => {
    expect(validLookKey("vibe.a b")).toBe(false);
    expect(validLookKey("vibe.a\n")).toBe(false);
    expect(validLookKey("vibe.a/b")).toBe(false);
    expect(validLookKey(5)).toBe(false);
    expect(validLookKey(null)).toBe(false);
    expect(validLookKey("vibe." + "a".repeat(LOOK_LIMITS.maxKeyChars))).toBe(false);
    expect(validLookKey(("vibe." + "a".repeat(LOOK_LIMITS.maxKeyChars)).slice(0, LOOK_LIMITS.maxKeyChars))).toBe(true);
  });
});

describe("validLookId", () => {
  it("accepts scene and palette ids", () => {
    expect(validLookId("mesh")).toBe(true);
    expect(validLookId("physarum2")).toBe(true);
    expect(validLookId("a-b_c.d@e")).toBe(true);
  });

  it("rejects empty, odd and over-long ids", () => {
    expect(validLookId("")).toBe(false);
    expect(validLookId("a b")).toBe(false);
    expect(validLookId("<script>")).toBe(false);
    expect(validLookId(undefined)).toBe(false);
    expect(validLookId("a".repeat(LOOK_LIMITS.maxIdChars))).toBe(true);
    expect(validLookId("a".repeat(LOOK_LIMITS.maxIdChars + 1))).toBe(false);
  });
});

describe("utf8Length", () => {
  const enc = new TextEncoder();
  it("matches TextEncoder for one-, two-, three- and four-byte characters", () => {
    for (const s of ["", "abc", "é", "日本語", "😀", "a😀b€é"]) {
      expect(utf8Length(s)).toBe(enc.encode(s).length);
    }
  });

  it("counts a lone surrogate like the replacement character", () => {
    for (const s of ["\ud800", "a\udc00b", "\ud800a", "😀\ud83d"]) {
      expect(utf8Length(s)).toBe(enc.encode(s).length);
    }
  });
});

describe("docBytes", () => {
  it("sums ids, keys and values in UTF-8 bytes", () => {
    expect(docBytes(emptyLookDoc())).toBe(0);
    expect(docBytes(doc({ "vibe.a": "é" }, "ab", "c"))).toBe(2 + 1 + 6 + 2);
  });
});

describe("isEmptyPatch", () => {
  it("is empty only when nothing is set, deleted or renamed", () => {
    expect(isEmptyPatch({})).toBe(true);
    expect(isEmptyPatch({ set: {}, del: [] })).toBe(true);
    expect(isEmptyPatch({ scene: "mesh" })).toBe(false);
    expect(isEmptyPatch({ set: { "vibe.a": "1" } })).toBe(false);
    expect(isEmptyPatch({ del: ["vibe.a"] })).toBe(false);
  });
});

describe("sanitizeLookPatch", () => {
  it("passes a clean patch and drops fields that are not part of it", () => {
    const r = sanitizeLookPatch({
      type: "lookPatch",
      n: 4,
      rev: 9,
      scene: "mesh",
      palette: "neon",
      set: { "vibe.a": "1" },
      del: ["vibe.b"],
    });
    expect(r).toEqual({ ok: true, patch: { scene: "mesh", palette: "neon", set: { "vibe.a": "1" }, del: ["vibe.b"] } });
  });

  it("accepts an empty patch (a no-op the room acks)", () => {
    const r = sanitizeLookPatch({ type: "lookPatch", n: 1 });
    expect(r).toEqual({ ok: true, patch: {} });
  });

  it("normalises empty set and del away and de-duplicates del", () => {
    const r = sanitizeLookPatch({ set: {}, del: [] });
    expect(r).toEqual({ ok: true, patch: {} });
    const d = sanitizeLookPatch({ del: ["vibe.a", "vibe.b", "vibe.a"] });
    expect(d).toEqual({ ok: true, patch: { del: ["vibe.a", "vibe.b"] } });
  });

  it("rejects non-objects and wrongly typed fields as shape", () => {
    for (const raw of [null, undefined, "x", 5, [], { scene: 5 }, { scene: "" }, { palette: null }, { set: [] }, { set: "x" }, { del: "vibe.a" }, { del: [1] }]) {
      expect(sanitizeLookPatch(raw)).toEqual({ ok: false, reason: "shape" });
    }
  });

  it("rejects invalid keys and non-string values as shape", () => {
    expect(sanitizeLookPatch({ set: { "vibe.a": 1 } })).toEqual({ ok: false, reason: "shape" });
    expect(sanitizeLookPatch({ set: { "svl.x": "1" } })).toEqual({ ok: false, reason: "shape" });
    expect(sanitizeLookPatch({ del: ["constructor"] })).toEqual({ ok: false, reason: "shape" });
    // JSON.parse makes __proto__ an own property, which Object.keys sees.
    const parsed = JSON.parse('{"set":{"__proto__":"x"}}');
    expect(sanitizeLookPatch(parsed)).toEqual({ ok: false, reason: "shape" });
  });

  it("rejects a key in both set and del as shape", () => {
    expect(sanitizeLookPatch({ set: { "vibe.a": "1" }, del: ["vibe.a"] })).toEqual({ ok: false, reason: "shape" });
  });

  it("rejects an over-large value and too many entries as size", () => {
    const big = "x".repeat(LOOK_LIMITS.maxValueBytes + 1);
    expect(sanitizeLookPatch({ set: { "vibe.a": big } })).toEqual({ ok: false, reason: "size" });
    const ok = "x".repeat(LOOK_LIMITS.maxValueBytes);
    expect(sanitizeLookPatch({ set: { "vibe.a": ok } }).ok).toBe(true);

    const many: Record<string, string> = {};
    for (let i = 0; i <= LOOK_LIMITS.maxKeys; i++) many["vibe.k" + i] = "1";
    expect(sanitizeLookPatch({ set: many })).toEqual({ ok: false, reason: "size" });
    const manyDel: string[] = [];
    for (let i = 0; i <= LOOK_LIMITS.maxKeys; i++) manyDel.push("vibe.k" + i);
    expect(sanitizeLookPatch({ del: manyDel })).toEqual({ ok: false, reason: "size" });
  });

  it("measures a value in UTF-8 bytes, not characters", () => {
    const wide = "€".repeat(Math.floor(LOOK_LIMITS.maxValueBytes / 3) + 1);
    expect(wide.length).toBeLessThan(LOOK_LIMITS.maxValueBytes);
    expect(sanitizeLookPatch({ set: { "vibe.a": wide } })).toEqual({ ok: false, reason: "size" });
  });
});

describe("applyLookPatch", () => {
  const base = doc({ "vibe.a": "1", "vibe.b": "2" });

  it("applies scene, palette, set and del without touching the input", () => {
    const frozen = JSON.stringify(base);
    const r = applyLookPatch(base, { scene: "storm", palette: "ice", set: { "vibe.a": "9", "vibe.c": "3" }, del: ["vibe.b"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc).toEqual(doc({ "vibe.a": "9", "vibe.c": "3" }, "storm", "ice"));
    expect(r.effective).toEqual({ scene: "storm", palette: "ice", set: { "vibe.a": "9", "vibe.c": "3" }, del: ["vibe.b"] });
    expect(JSON.stringify(base)).toBe(frozen);
  });

  it("is idempotent: replaying a patch changes nothing", () => {
    const patch = { scene: "storm", set: { "vibe.a": "9" }, del: ["vibe.b"] };
    const once = applyLookPatch(base, patch);
    if (!once.ok) throw new Error("first apply failed");
    const twice = applyLookPatch(once.doc, patch);
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect(twice.effective).toBeNull();
    expect(twice.doc).toEqual(once.doc);
  });

  it("reports a no-op as effective null and returns the same document", () => {
    const r = applyLookPatch(base, { scene: "mesh", set: { "vibe.a": "1" }, del: ["vibe.zzz"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.effective).toBeNull();
    expect(r.doc).toBe(base);
    const empty = applyLookPatch(base, {});
    expect(empty.ok && empty.effective).toBeNull();
  });

  it("lists only the entries that changed", () => {
    const r = applyLookPatch(base, { set: { "vibe.a": "1", "vibe.b": "changed" }, del: ["vibe.nope"] });
    expect(r.ok && r.effective).toEqual({ set: { "vibe.b": "changed" } });
  });

  it("lets a set win over a del of the same key and ignores keys the sanitiser would refuse", () => {
    const r = applyLookPatch(base, { set: { "vibe.a": "7" }, del: ["vibe.a", "__proto__", "constructor"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.storage).toEqual({ "vibe.a": "7", "vibe.b": "2" });
    expect(r.effective).toEqual({ set: { "vibe.a": "7" } });
    const poisoned = applyLookPatch(base, { set: JSON.parse('{"__proto__":"x"}') });
    expect(poisoned.ok && poisoned.effective).toBeNull();
  });

  it("refuses a result over the document size and leaves the input alone", () => {
    const frozen = JSON.stringify(base);
    const a = "x".repeat(LOOK_LIMITS.maxValueBytes);
    const r = applyLookPatch(base, { set: { "vibe.big1": a, "vibe.big2": a } });
    expect(r).toEqual({ ok: false, reason: "size" });
    expect(JSON.stringify(base)).toBe(frozen);
  });

  it("refuses a result over the key count and leaves the input alone", () => {
    const full: Record<string, string> = {};
    for (let i = 0; i < LOOK_LIMITS.maxKeys; i++) full["vibe.k" + i] = "1";
    const d = doc(full);
    const frozen = JSON.stringify(d);
    expect(applyLookPatch(d, { set: { "vibe.extra": "1" } })).toEqual({ ok: false, reason: "size" });
    expect(JSON.stringify(d)).toBe(frozen);
    // Swapping one key for another stays within the count.
    expect(applyLookPatch(d, { set: { "vibe.extra": "1" }, del: ["vibe.k0"] }).ok).toBe(true);
  });
});

describe("diffLook", () => {
  const a = doc({ "vibe.a": "1", "vibe.b": "2", "vibe.c": "3" });

  it("is null when nothing differs", () => {
    expect(diffLook(a, doc({ ...a.storage }))).toBeNull();
  });

  it("reports the minimal set, del, scene and palette", () => {
    const b = doc({ "vibe.a": "1", "vibe.b": "changed", "vibe.d": "4" }, "storm", "ice");
    expect(diffLook(a, b)).toEqual({ scene: "storm", palette: "ice", set: { "vibe.b": "changed", "vibe.d": "4" }, del: ["vibe.c"] });
  });

  it("round-trips: applying the diff to a yields b", () => {
    const cases = [
      doc({}, "mesh", "neon"),
      doc({ "vibe.x": "1" }, "storm", "ice"),
      doc({ "vibe.a": "9", "vibe.e": "5" }, "mesh", "fire"),
      doc({ ...a.storage }, "mesh", "neon"),
    ];
    for (const b of cases) {
      const patch = diffLook(a, b);
      if (patch === null) {
        expect(b).toEqual(a);
        continue;
      }
      const r = applyLookPatch(a, patch);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.doc).toEqual(b);
    }
  });

  it("treats an empty scene or palette as no opinion", () => {
    const b = doc({ ...a.storage }, "", "");
    expect(diffLook(a, b)).toBeNull();
  });

  it("lists keys in sorted order so equal diffs serialise identically", () => {
    const x = diffLook(doc({}), doc({ "vibe.b": "1", "vibe.a": "1" }));
    const y = diffLook(doc({}), doc({ "vibe.a": "1", "vibe.b": "1" }));
    expect(JSON.stringify(x)).toBe(JSON.stringify(y));
    const d = diffLook(doc({ "vibe.b": "1", "vibe.a": "1" }), doc({}));
    expect(d?.del).toEqual(["vibe.a", "vibe.b"]);
  });

  it("produces patches the sanitiser accepts", () => {
    const b = doc({ "vibe.a": "1", "vibe.q": "z" }, "storm", "ice");
    const patch = diffLook(a, b);
    expect(patch).not.toBeNull();
    expect(sanitizeLookPatch(patch)).toEqual({ ok: true, patch });
  });
});

describe("sanitizeLookDoc", () => {
  it("returns null for anything that is not an object", () => {
    for (const raw of [null, undefined, "x", 5, []]) expect(sanitizeLookDoc(raw)).toBeNull();
  });

  it("keeps a clean document", () => {
    const d = doc({ "vibe.a": "1" });
    expect(sanitizeLookDoc(d)).toEqual(d);
  });

  it("defaults missing or invalid ids and storage to empty", () => {
    expect(sanitizeLookDoc({})).toEqual(emptyLookDoc());
    expect(sanitizeLookDoc({ scene: "a b", palette: 3, storage: "x" })).toEqual(emptyLookDoc());
  });

  it("drops invalid keys and non-string or oversize values, keeping the rest", () => {
    const raw = JSON.parse(
      JSON.stringify({
        scene: "mesh",
        palette: "neon",
        storage: {
          "vibe.ok": "1",
          "svl.nope": "2",
          "vibe.num": 3,
          "vibe.big": "x".repeat(LOOK_LIMITS.maxValueBytes + 1),
        },
      }).replace('"vibe.ok"', '"__proto__":"p","vibe.ok"'),
    );
    expect(sanitizeLookDoc(raw)).toEqual(doc({ "vibe.ok": "1" }));
  });

  it("never exceeds the key count or document size", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < LOOK_LIMITS.maxKeys + 20; i++) many["vibe.k" + i] = "1";
    const r = sanitizeLookDoc({ scene: "mesh", palette: "neon", storage: many });
    expect(r).not.toBeNull();
    expect(Object.keys(r!.storage).length).toBe(LOOK_LIMITS.maxKeys);

    const v = "x".repeat(LOOK_LIMITS.maxValueBytes);
    const heavy = sanitizeLookDoc({ storage: { "vibe.a": v, "vibe.b": v } });
    expect(heavy).not.toBeNull();
    expect(docBytes(heavy!)).toBeLessThanOrEqual(LOOK_LIMITS.maxDocBytes);
    expect(Object.keys(heavy!.storage)).toEqual(["vibe.a"]);
  });
});
