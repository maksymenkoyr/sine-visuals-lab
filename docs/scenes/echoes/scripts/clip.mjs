// Records Echoes' canvas on a real song from a fixed moment, at default settings
// but for the Shape, so two builds can be compared at the same beats.
//   node clip.mjs --port P --wav song.wav --shape 6 --out out.webm [--from 12] [--seconds 8] [--settings JSON]
import { writeFileSync } from "node:fs";
import { launchWithMic, openScene } from "../../../../tools/ref-browser.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port");
const wav = opt("--wav");
const shape = Number(opt("--shape"));
const out = opt("--out");
const fromSec = Number(opt("--from", "12"));
const seconds = Number(opt("--seconds", "8"));
const settings = JSON.parse(opt("--settings", "{}"));

const { browser, ctx } = await launchWithMic(wav, { width: 960, height: 540 });
try {
  const page = await openScene(ctx, { port, scene: "echoes" });
  await page.waitForTimeout(1500);
  await page.evaluate((s) => window.__viz.setParams({ scene: "echoes", autoPin: true, settings: s }), { ...settings, shape });
  const b64 = await page.evaluate(
    ({ fromMs, ms }) =>
      new Promise((resolve, reject) => {
        const gl = document.getElementById("gl");
        const wait = () => {
          if (performance.now() - window.__micT0 < fromMs) return requestAnimationFrame(wait);
          const rec = new MediaRecorder(gl.captureStream(60), { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 16_000_000 });
          const parts = [];
          rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
          rec.onerror = reject;
          rec.onstop = async () => {
            const buf = await new Blob(parts, { type: "video/webm" }).arrayBuffer();
            let s = "";
            const u = new Uint8Array(buf);
            for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
            resolve(btoa(s));
          };
          rec.start();
          setTimeout(() => rec.stop(), ms);
        };
        wait();
      }),
    { fromMs: fromSec * 1000, ms: seconds * 1000 },
  );
  writeFileSync(out, Buffer.from(b64, "base64"));
  console.log("wrote", out);
} finally {
  await browser.close();
}
