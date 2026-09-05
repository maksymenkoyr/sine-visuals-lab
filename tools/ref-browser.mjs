// Shared browser launch for the reference-video tools (ref-hear.mjs,
// ref-shoot.mjs): a Chromium whose "microphone" is a ref bundle's audio.wav,
// with the instant that playback started recorded as window.__micT0 so
// the bundle's t=0 is known in performance.now() terms.
//
// How the fake mic works: --use-file-for-fake-audio-capture plays the wav
// as the capture device from the moment the capture starts, i.e. when the
// app's getUserMedia({audio}) resolves. An init script wraps getUserMedia
// and stamps performance.now() then. Everything the tools time is measured
// from that stamp; the wav is 48 kHz mono s16 (tools/ref-scan.py writes it
// that way because that is the format Chromium's file source reads).
//
// openScene() lands on a scene, clicks once (the gesture that starts the
// mic — the app never opens audio on its own), waits for the stamp, and
// hides everything but the canvas so a screenshot is just the render.
import { chromium } from "playwright";

export async function launchWithMic(wav, { width = 960, height = 540 } = {}) {
  const browser = await chromium.launch({
    channel: "chromium",
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}%noloop`,
      "--autoplay-policy=no-user-gesture-required",
      "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist",
    ],
  });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height }, permissions: ["microphone"] });
  await ctx.addInitScript(() => {
    const md = navigator.mediaDevices;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => {
      const s = await orig(c);
      if (c && c.audio && !window.__micT0) window.__micT0 = performance.now();
      return s;
    };
  });
  return { browser, ctx };
}

/** Opens `scene` on the dev server at `port`, starts the mic, hides the
 *  chrome. Returns the page once window.__micT0 is set. */
export async function openScene(ctx, { port, scene, quality = "high" }) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message.slice(0, 500)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/8787|ERR_CONNECTION_REFUSED|403/.test(m.text())) console.log("CONSOLE", m.text().slice(0, 300));
  });
  await page.goto(`https://localhost:${port}/?quality=${quality}#/v/${scene}`, { waitUntil: "load" });
  await page.waitForTimeout(800);
  const vp = page.viewportSize();
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForFunction(() => window.__micT0 > 0, null, { timeout: 8000 });
  const hash = await page.evaluate(() => location.hash);
  if (!hash.includes(scene)) console.log(`WARNING: page is at ${hash}, not the requested scene`);
  await page.addStyleTag({ content: "body > :not(canvas) { visibility: hidden !important; }" });
  return page;
}

/** Resolves (in-page) once bundle time `targetMs` minus `leadMs` has
 *  passed; returns the bundle time actually reached. */
export function waitUntil(page, targetMs, leadMs = 0) {
  return page.evaluate(
    ({ targetMs, leadMs }) =>
      new Promise((r) => {
        const tick = () => {
          const now = performance.now() - window.__micT0;
          if (now >= targetMs - leadMs) r(now);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    { targetMs, leadMs },
  );
}
