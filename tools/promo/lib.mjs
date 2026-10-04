// Capture helpers for the release promo (tools/promo/promo.mjs is the entry point): Metal-GPU
// Chromium, CDP screencast with real timestamps, a beat clock, and a fake cursor. The beat clock
// locks to one of two feeds:
// - synthetic (`?audio=synthetic&bpm=N` makes beat k land at __S + k*P) — for panel takes, where the
//   scene behind the panel only has to pulse on the grid;
// - the song itself (launch({wav})): Chromium plays the wav as the microphone from the moment the
//   app's getUserMedia resolves, which an init script stamps as __S (the same trick as
//   tools/ref-browser.mjs). The wav is cut to start on a beat of the song, so beat k is again
//   __S + k*P — and the scene reacts to the very music the video plays over it.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

export const BASE = process.env.BASE || "https://www.sinevisualslab.com";
export const BPM = Number(process.env.BPM || 124);   // the song's tempo; promo.mjs sets it from song.json
export const P = 60000 / BPM; // beat period, ms
export const W = 1920, H = 1080;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs before the app: remember performance.now() at the moment the app reads ?bpm= (the line right
// before `syntheticStartMs = performance.now()`), so beat k of the synthetic feed is at S + k*P.
const INIT = () => {
  const g = URLSearchParams.prototype.get;
  URLSearchParams.prototype.get = function (k) {
    const v = g.call(this, k);
    if (k === "bpm") window.__S = performance.now();
    return v;
  };
};
const MIC_STAMP = () => {
  const md = navigator.mediaDevices;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    const s = await orig(c);
    if (c && c.audio && !window.__S) window.__S = performance.now();
    return s;
  };
};

const OVERLAY_CSS = `
.pv-cap{position:fixed;left:50%;top:60px;transform:translate(-50%,-8px);z-index:2147483000;pointer-events:none;
  font-family:"Chakra Petch",system-ui,sans-serif;text-align:center;color:#fff;opacity:0;
  transition:opacity .22s ease,transform .22s ease;padding:16px 40px 18px;border-radius:16px;
  background:rgba(8,10,18,.62);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  border:1px solid rgba(255,255,255,.14);white-space:nowrap}
.pv-cap.on{opacity:1;transform:translate(-50%,0)}
.pv-cap.static{transition:none}
.pv-cap .k{font-size:19px;letter-spacing:.42em;text-transform:uppercase;color:#7ff3ff;margin-bottom:6px}
.pv-cap .t{font-size:60px;font-weight:700;letter-spacing:.03em;line-height:1.05}
.pv-cap .s{font-size:24px;opacity:.82;margin-top:8px;letter-spacing:.04em}
.pv-cap.low{top:auto;bottom:64px}
.pv-title{position:fixed;inset:0;z-index:2147483000;pointer-events:none;display:flex;flex-direction:column;
  align-items:center;justify-content:center;font-family:"Chakra Petch",system-ui,sans-serif;color:#fff;text-align:center;
  opacity:0;transition:opacity .35s ease}
.pv-title.on{opacity:1}
.pv-title .box{padding:36px 80px 40px;border-radius:22px;background:rgba(8,10,18,.58);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.16)}
.pv-title .a{font-size:112px;font-weight:700;letter-spacing:.08em;line-height:1}
.pv-title .b{font-size:34px;letter-spacing:.34em;text-transform:uppercase;color:#7ff3ff;margin-top:20px}
.pv-title .c{font-size:30px;margin-top:14px;opacity:.85;letter-spacing:.1em}
.pv-dim{position:fixed;inset:0;z-index:2147482000;pointer-events:none;background:#000;opacity:0;transition:opacity .5s ease}
.pv-dim.on{opacity:.62}
.pv-black{position:fixed;inset:0;z-index:2147483600;pointer-events:none;background:#000;opacity:0;transition:opacity .45s ease}
.pv-black.on{opacity:1}
.pv-cur{position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;z-index:2147483500;
  pointer-events:none;background:rgba(255,255,255,.92);border:3px solid rgba(20,24,40,.85);
  box-shadow:0 0 0 2px rgba(255,255,255,.55),0 4px 14px rgba(0,0,0,.5);transition:transform .08s ease;transform:translate(-100px,-100px)}
.pv-cur.down{width:20px;height:20px;margin:-10px 0 0 -10px;background:#7ff3ff}
`;

export async function launch({ width = W, height = H, dsf = 1, wav = null } = {}) {
  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
    args: [
      "--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist",
      "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      ...(wav ? [`--use-file-for-fake-audio-capture=${wav}%noloop`] : []),
    ],
  });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf, ignoreHTTPSErrors: true, permissions: ["microphone"] });
  await ctx.addInitScript(wav ? MIC_STAMP : INIT);
  const page = await ctx.newPage();
  return { browser, ctx, page };
}

/** Navigate, wait for boot, inject overlay helpers + fake cursor. */
export async function open(page, scene, { query = "", music = false } = {}) {
  if (music) {
    // the app opens the mic only on a gesture: click the canvas, as a visitor would
    await page.goto(`${BASE}/?${query.replace(/^&/, "")}#/v/${scene}`, { waitUntil: "load" });
    await sleep(800);
    const vp = page.viewportSize();
    await page.mouse.click(vp.width / 2, vp.height / 2);
  } else {
    await page.goto(`${BASE}/?audio=synthetic&bpm=${BPM}${query}#/v/${scene}`, { waitUntil: "load" });
  }
  await page.waitForFunction(() => typeof window.__S === "number", null, { timeout: 15000 });
  await sleep(3500);
  await page.addStyleTag({ content: OVERLAY_CSS });
  await page.evaluate(() => {
    const cur = document.createElement("div");
    cur.className = "pv-cur";
    document.documentElement.appendChild(cur);
    addEventListener("mousemove", (e) => { cur.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, true);
    addEventListener("mousedown", () => cur.classList.add("down"), true);
    addEventListener("mouseup", () => cur.classList.remove("down"), true);
    window.__mk = (cls, html, id) => {
      document.getElementById(id)?.remove();
      const d = document.createElement("div");
      d.id = id; d.className = cls; d.innerHTML = html;
      document.documentElement.appendChild(d);
      return d;
    };
    window.__cap = (k, t, s, opts = {}) => {
      const d = window.__mk("pv-cap" + (opts.low ? " low" : "") + (opts.static ? " static" : ""),
        `<div class="k">${k}</div><div class="t">${t}</div>${s ? `<div class="s">${s}</div>` : ""}`, "pv-cap-el");
      void d.offsetWidth; d.classList.add("on");
    };
    setInterval(() => document.querySelectorAll("div,span").forEach((e) => { if (e.children.length === 0 && /Press \? for shortcuts/.test(e.textContent)) e.style.setProperty("display", "none", "important"); }), 80);
    window.__capOff = () => document.getElementById("pv-cap-el")?.classList.remove("on");
  });
}

export const openPanel = (page) => page.evaluate(() => document.querySelector("#menuBtn")?.click());
export const hideChrome = async (page) => {
  await page.keyboard.press("h");
  await page.addStyleTag({ content: "#roomCode,#sceneNav,#fsBtn,#menuBtn,#panelBtn,#hud{visibility:hidden!important}" });
  await sleep(400);
};

/** Beat clock: T0 = first beat tick >= now + lead (page performance.now() ms), or, with `at`, beat
 *  `at` of the feed itself (a song take starts on a fixed beat of the wav). */
export async function beatClock(page, leadMs = 1500, { at = null } = {}) {
  const r = await page.evaluate(([lead, P, at]) => {
    const now = performance.now();
    const k = at ?? Math.ceil((now + lead - window.__S) / P);
    return { T0: window.__S + k * P, origin: performance.timeOrigin, now };
  }, [leadMs, P, at]);
  if (r.T0 < r.now + 200) throw new Error(`beat ${at} of the feed is already past; start the wav earlier`);
  const T0 = r.T0;
  const waitBeat = (b) => page.evaluate(([t]) => new Promise((res) => {
    const f = () => { const d = t - performance.now(); if (d <= 0) res(); else if (d > 30) setTimeout(f, 8); else requestAnimationFrame(f); };
    f();
  }), [T0 + b * P]);
  return { T0, origin: r.origin, epochT0: (r.origin + T0) / 1000, waitBeat };
}

export async function startCast(page, dir, { quality = 90 } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let n = 0;
  cdp.on("Page.screencastFrame", (ev) => {
    const i = n++;
    const file = `f${String(i).padStart(5, "0")}.jpg`;
    frames.push({ file, t: ev.metadata.timestamp });
    fs.writeFileSync(path.join(dir, file), Buffer.from(ev.data, "base64"));
    cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality, everyNthFrame: 1, maxWidth: (page.viewportSize() || { width: 1920 }).width, maxHeight: (page.viewportSize() || { height: 1080 }).height });
  return {
    async stop(meta) {
      await cdp.send("Page.stopScreencast").catch(() => {});
      await sleep(200);
      fs.writeFileSync(path.join(dir, "frames.json"), JSON.stringify({ meta, frames }));
      return frames;
    },
  };
}

// ---- mouse helpers (paced so the drag is visible in the screencast) ----
export const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
let mx = 960, my = 540;
export async function moveTo(page, x, y, ms = 300) {
  const x0 = mx, y0 = my, t0 = Date.now();
  for (;;) {
    const p = Math.min(1, (Date.now() - t0) / ms), e = ease(p);
    await page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
    if (p >= 1) break;
    await sleep(3);
  }
  mx = x; my = y;
}
export async function drag(page, x0, y0, x1, y1, ms = 900) {
  await moveTo(page, x0, y0, 220);
  await page.mouse.down();
  await sleep(90);
  await moveTo(page, x1, y1, ms);
  await page.mouse.up();
}
const OWN = `(e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim()`;
export const centerOf = (page, text, { minX = -1, maxX = 1e9, nth = 0 } = {}) => page.evaluate(([text, minX, maxX, nth, OWN]) => {
  const own = eval(OWN);
  const els = [...document.querySelectorAll("*")].filter((e) => own(e).toLowerCase() === text.toLowerCase()).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.x >= minX && r.x <= maxX; });
  const el = els[nth];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.left, top: r.top };
}, [text, minX, maxX, nth, OWN]);
export const scrollTextTo = (page, text, block = "start", nth = 0) => page.evaluate(([text, block, nth, OWN]) => {
  const own = eval(OWN);
  const el = [...document.querySelectorAll("*")].filter((e) => own(e).toLowerCase() === text.toLowerCase())[nth];
  el?.scrollIntoView({ block });
  return !!el;
}, [text, block, nth, OWN]);
export const clickText = (page, text) => page.evaluate(([text, OWN]) => {
  const own = eval(OWN);
  const el = [...document.querySelectorAll("*")].find((e) => own(e).toLowerCase() === text.toLowerCase());
  el?.click();
  return !!el;
}, [text, OWN]);
/** A real press: down, hold, up (the panel can rebuild DOM under a too-quick click). */
export async function press(page, holdMs = 260) { await page.mouse.down(); await sleep(holdMs); await page.mouse.up(); }
export const getMouse = () => [mx, my];
