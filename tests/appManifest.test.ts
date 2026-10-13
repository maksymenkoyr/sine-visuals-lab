import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PRODUCT_NAME } from "../src/brand.ts";
import { appManifest } from "../vite-app-manifest-plugin.ts";

const CHANNELS = ["stable", "insider", "preview", "dev"] as const;
/** About how many characters iOS shows under a home-screen icon before it
 *  cuts the label with an ellipsis. */
const LAUNCHER_LABEL_MAX = 12;

const pngSize = (src: string): string => {
  const png = fs.readFileSync(new URL(`../public${src}`, import.meta.url));
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
};

describe("appManifest", () => {
  it("names Stable plainly and tells every other channel apart from it", () => {
    expect(appManifest("stable").name).toBe(PRODUCT_NAME);
    expect(new Set(CHANNELS.map((c) => appManifest(c).name)).size).toBe(CHANNELS.length);
    expect(new Set(CHANNELS.map((c) => appManifest(c).short_name)).size).toBe(CHANNELS.length);
  });

  it("keeps every home-screen label short enough not to be cut", () => {
    for (const c of CHANNELS) expect(appManifest(c).short_name.length).toBeLessThanOrEqual(LAUNCHER_LABEL_MAX);
  });

  it("points at icon files that exist at the sizes it states", () => {
    for (const icon of appManifest("stable").icons) expect(pngSize(icon.src)).toBe(icon.sizes);
  });

  it("carries the 192px and 512px plain icons Chrome needs to offer Install", () => {
    const plain = appManifest("stable").icons.filter((i) => i.purpose === "any").map((i) => i.sizes);
    expect(plain).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("offers a maskable icon for launchers that crop icons to their own shape", () => {
    expect(appManifest("stable").icons.some((i) => i.purpose === "maskable")).toBe(true);
  });

  it("installs the whole site from its root", () => {
    const m = appManifest("stable");
    expect([m.start_url, m.scope]).toEqual(["/", "/"]);
  });
});
