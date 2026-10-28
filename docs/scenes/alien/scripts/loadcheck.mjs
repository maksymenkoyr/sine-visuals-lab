// node loadcheck.mjs <outPrefix> [--port P] [--loop N] [--dpr 2] [--gallery] [--nodecode]
// Opens Alien (or the gallery, then Alien) at 1512x945 and the given DPR, logs
// every /media/ request, times decodeAlienMesh() in the page (the first run,
// then warm ones), and screenshots the scene to <outPrefix>.png.
import { chromium } from "../../../../node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const out = args[0];
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("port", "5431");
const loop = opt("loop", null);
const dpr = Number(opt("dpr", "2"));
const gallery = args.includes("--gallery");
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1512, height: 945 }, deviceScaleFactor: dpr });
const page = await ctx.newPage();
const media = [];
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith("/media/")) media.push(u.pathname);
});
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
const q = `audio=synthetic&bpm=128${loop !== null ? `&loop=${loop}` : ""}`;
if (gallery) {
  await page.goto(`https://localhost:${port}/?${q}`);
  await page.waitForTimeout(4000);
  console.log("gallery media:", JSON.stringify(media));
}
await page.goto(`https://localhost:${port}/?${q}#/v/alien`);
await page.waitForTimeout(6000);
console.log("media requests:", JSON.stringify(media));
const decode = args.includes("--nodecode") ? null : await page.evaluate(async () => {
  const { decodeAlienMesh, MESH_URL } = await import("/src/render/scenes/alien/meshFile.ts");
  const buf = await (await fetch(MESH_URL)).arrayBuffer();
  const ms = [];
  for (let i = 0; i < 7; i++) {
    const t = performance.now();
    decodeAlienMesh(buf.slice(0));
    ms.push(performance.now() - t);
  }
  return ms.map((m) => +m.toFixed(1));
});
console.log("decode ms (first, then warm):", JSON.stringify(decode));
await page.screenshot({ path: `${out}.png` });
console.log(`${out}.png`);
console.log(errors.filter((e) => !e.includes("8787") && !e.includes("403")).slice(0, 10).join("\n"));
await browser.close();
