import { describe, expect, it } from "vitest";
import { planBoot } from "../src/net/bootPlan.ts";
import { newKey } from "../src/net/pairing.ts";
import { joinUrlFor } from "../src/ui/joinScreen.ts";

const ORIGIN = "https://example.test";
const K = newKey();
const N = newKey();

describe("joinUrlFor", () => {
  it("host: a device that should supply the mic for the room", () => {
    expect(joinUrlFor("ABCD", "host", {}, ORIGIN)).toBe(`${ORIGIN}/?room=ABCD&role=host`);
  });

  it("renderer: the spectator invite, with the key only when there is one", () => {
    expect(joinUrlFor("ABCD", "renderer", {}, ORIGIN)).toBe(`${ORIGIN}/?room=ABCD`);
    expect(joinUrlFor("ABCD", "renderer", { key: K }, ORIGIN)).toBe(`${ORIGIN}/?room=ABCD&k=${K}`);
  });

  it("controller: room, role, then the key", () => {
    expect(joinUrlFor("ABCD", "controller", { key: K }, ORIGIN)).toBe(`${ORIGIN}/?room=ABCD&role=controller&k=${K}`);
  });

  it("adopt: the TV's slot and nonce", () => {
    expect(joinUrlFor("WXYZ", "adopt", { nonce: N }, ORIGIN)).toBe(`${ORIGIN}/?adopt=WXYZ&n=${N}`);
  });

  it("leaves out a secret it wasn't given, and ignores the one for another kind", () => {
    expect(joinUrlFor("ABCD", "controller", {}, ORIGIN)).toBe(`${ORIGIN}/?room=ABCD&role=controller`);
    expect(joinUrlFor("WXYZ", "adopt", {}, ORIGIN)).toBe(`${ORIGIN}/?adopt=WXYZ`);
    expect(joinUrlFor("ABCD", "controller", { nonce: N }, ORIGIN)).toBe(`${ORIGIN}/?room=ABCD&role=controller`);
    expect(joinUrlFor("WXYZ", "adopt", { key: K }, ORIGIN)).toBe(`${ORIGIN}/?adopt=WXYZ`);
  });

  it("puts the query before any hash a caller adds for the router", () => {
    for (const url of [
      joinUrlFor("ABCD", "host", {}, ORIGIN),
      joinUrlFor("ABCD", "renderer", { key: K }, ORIGIN),
      joinUrlFor("ABCD", "controller", { key: K }, ORIGIN),
      joinUrlFor("WXYZ", "adopt", { nonce: N }, ORIGIN),
    ]) {
      expect(url).not.toContain("#");
      const parsed = new URL(`${url}#/v/mesh`);
      expect(parsed.hash).toBe("#/v/mesh");
      expect(parsed.search).not.toBe("");
    }
  });

  it("encodes anything outside the key alphabet rather than splitting the query", () => {
    const url = joinUrlFor("ABCD", "controller", { key: "a&b=c#d" }, ORIGIN);
    expect(new URL(url).searchParams.get("k")).toBe("a&b=c#d");
    expect(new URL(url).hash).toBe("");
  });
});

describe("a link is read back as what it was built for", () => {
  const search = (url: string): string => new URL(url).search;

  it("host", () => {
    expect(planBoot(search(joinUrlFor("ABCD", "host", {}, ORIGIN)), null)).toEqual({ kind: "host-join", room: "ABCD" });
  });

  it("renderer", () => {
    expect(planBoot(search(joinUrlFor("ABCD", "renderer", { key: K }, ORIGIN)), null)).toEqual({
      kind: "renderer",
      room: "ABCD",
      key: K,
    });
  });

  it("controller", () => {
    expect(planBoot(search(joinUrlFor("ABCD", "controller", { key: K }, ORIGIN)), null)).toEqual({
      kind: "controller",
      room: "ABCD",
      key: K,
      keyFromUrl: true,
    });
  });

  it("adopt", () => {
    expect(planBoot(search(joinUrlFor("WXYZ", "adopt", { nonce: N }, ORIGIN)), null)).toEqual({
      kind: "adopt",
      slot: "WXYZ",
      nonce: N,
    });
  });
});
