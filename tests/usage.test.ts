import { describe, expect, it } from "vitest";
import { deviceClass, isBotUserAgent, parseUsageEvent, usageDataPoint } from "../server/usage.ts";

describe("parseUsageEvent", () => {
  it("accepts a well-formed event", () => {
    expect(parseUsageEvent({ e: "start", s: "mesh", src: "mic", me: 0 })).toEqual({ e: "start", s: "mesh", src: "mic", me: 0 });
  });

  it("drops unknown kinds, sources and me values", () => {
    expect(parseUsageEvent({ e: "load", s: "mesh", src: "mic", me: 0 })).toBeNull();
    expect(parseUsageEvent({ e: "start", s: "mesh", src: "synthetic", me: 0 })).toBeNull();
    expect(parseUsageEvent({ e: "start", s: "mesh", src: "mic", me: true })).toBeNull();
  });

  it("drops scene ids that aren't plain slugs", () => {
    expect(parseUsageEvent({ e: "scene", s: "<script>", src: "mic", me: 0 })).toBeNull();
    expect(parseUsageEvent({ e: "scene", s: "x".repeat(41), src: "mic", me: 0 })).toBeNull();
    expect(parseUsageEvent({ e: "scene", s: "", src: "mic", me: 0 })).toBeNull();
  });

  it("drops non-objects", () => {
    expect(parseUsageEvent(null)).toBeNull();
    expect(parseUsageEvent("start")).toBeNull();
  });
});

describe("user agents", () => {
  it("treats crawlers, headless browsers and a missing UA as bots", () => {
    expect(isBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 HeadlessChrome/140.0")).toBe(true);
    expect(isBotUserAgent("")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0 Safari/537.36")).toBe(false);
  });

  it("classes phones as mobile", () => {
    expect(deviceClass("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile/15E148")).toBe("mobile");
    expect(deviceClass("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0")).toBe("desktop");
  });
});

it("keeps the blob order tools/usage.mjs queries by", () => {
  const point = usageDataPoint({ e: "start", s: "mesh", src: "display", me: 1 }, "PT", "Mozilla/5.0 (Windows NT 10.0)");
  expect(point.blobs).toEqual(["start", "mesh", "display", "me", "PT", "desktop"]);
});
