// The social/OG preview image: one clean 1200x630 frame of a shipped scene,
// captured headlessly from the dev server so it shows what the site actually
// renders. Committed to public/ (crawlers — Facebook, Slack, iMessage — fetch
// og:image once, from the deployed URL; nothing regenerates it at build time).
//
//   node tools/make-og.mjs [sceneId]     # defaults to caustics -> public/og.jpg
//
// Re-run after a look change to a scene you care about, or swap the default
// scene for a different one. The app is pinned (?quality=, dev-only) so a
// SwiftShader capture matches what the flags below draw on any machine, and
// the chrome is hidden by hand — the mark and buttons belong to the app, not
// to a preview card.
import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const sceneId = process.argv[2] ?? "caustics";
const outPath = path.join(root, "public", "og.jpg");
const PORT = 5198;

const server = await createServer({
  root,
  configFile: false,
  logLevel: "silent",
  server: { port: PORT, strictPort: true },
});
await server.listen();
const base = `http://localhost:${PORT}`;

const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

const url = `${base}/?audio=synthetic&bpm=124&quality=high#/v/${sceneId}`;
console.log(`capturing ${url}`);
await page.goto(url, { waitUntil: "load", timeout: 60000 });
// Any residual tap-to-start overlay dies on the first click; the click itself
// lands on the canvas (scene chrome sits in the corners).
await page.mouse.click(600, 315);
// Let the scene warm through auto-tune and settle into steady state.
await page.waitForTimeout(6000);

await page.evaluate(() => {
  // Everything the app mounts except the frame itself: scene chrome, the
  // gallery behind it, and the dev-only tuning toasts — this captures from a
  // dev server, so those exist here and never in prod.
  for (const el of document.body.children) if (el.id !== "gl") el.style.display = "none";
});
await page.waitForTimeout(300);

// JPEG, not PNG: a dark noisy gradient PNG runs ~700KB, the same frame as a
// JPEG q86 is a fraction of that — link previews truncate/blur oversized images.
await page.screenshot({ path: outPath, type: "jpeg", quality: 86 });
console.log(`wrote public/og.jpg (${fs.statSync(outPath).size} B)`);

await browser.close();
await server.close();
