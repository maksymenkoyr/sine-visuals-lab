// The page and mouse helpers of the take shots (shots/take-*.mjs): opening the app on a feed, the
// panel, the beat clock, an eased mouse, finding controls by their visible text, and the rectangle
// tracker the interface camera follows (launch and the screencast are capture.mjs's). capture.mjs sets
// BASE and BPM in the environment before it imports a shot, so beat k of the synthetic feed is at
// __S + k*P here too.
// open() does not take the init scripts (capture.mjs adds them); it installs the classic pv-cur cursor
// and hides the 'Press ?' hint. The beat clock locks to the synthetic feed or, for a song take, to the
// wav the fake microphone plays (the __S stamp).

export const BASE = process.env.BASE || "https://www.sinevisualslab.com";
export const BPM = Number(process.env.BPM || 124);   // the song's tempo; capture.mjs sets it from record.json
export const P = 60000 / BPM; // beat period, ms
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const OVERLAY_CSS = `
.pv-cur{position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;z-index:2147483500;
  pointer-events:none;background:rgba(255,255,255,.92);border:3px solid rgba(20,24,40,.85);
  box-shadow:0 0 0 2px rgba(255,255,255,.55),0 4px 14px rgba(0,0,0,.5);transition:transform .08s ease;transform:translate(-100px,-100px)}
.pv-cur.down{width:20px;height:20px;margin:-10px 0 0 -10px;background:#7ff3ff}
`;

/** Navigate, wait for boot, inject the fake cursor and hide the hint. */
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
    setInterval(() => document.querySelectorAll("div,span").forEach((e) => { if (e.children.length === 0 && /Press \? for shortcuts/.test(e.textContent)) e.style.setProperty("display", "none", "important"); }), 80);
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
export async function beatClock(page, leadMs = 1500, { at = null, late = false } = {}) {   // late: `at` may be past
  const r = await page.evaluate(([lead, P, at]) => {
    const now = performance.now();
    const k = at ?? Math.ceil((now + lead - window.__S) / P);
    return { T0: window.__S + k * P, origin: performance.timeOrigin, now };
  }, [leadMs, P, at]);
  if (!late && r.T0 < r.now + 200) throw new Error(`beat ${at} of the feed is already past; start the wav earlier`);
  const T0 = r.T0;
  const waitBeat = (b) => page.evaluate(([t]) => new Promise((res) => {
    const f = () => { const d = t - performance.now(); if (d <= 0) res(); else if (d > 30) setTimeout(f, 8); else requestAnimationFrame(f); };
    f();
  }), [T0 + b * P]);
  return { T0, origin: r.origin, epochT0: (r.origin + T0) / 1000, waitBeat };
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
export const setMouse = (x, y) => { mx = x; my = y; };

export const PX = 250; // the phone panel column starts around here
export const FB_SETUP = async (page) => { await openPanel(page); await sleep(1200); await hideChrome(page); await sleep(500); };
export const every = (step, names, from = 0) => names.map((n, i) => [from + i * step, n]);

/** Slider span for the row labelled `label` in the phone panel: the nearest wide canvas below the label. */
export const sliderOf = (page, label) => page.evaluate(([label, PX]) => {
  const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
  const lab = [...document.querySelectorAll("*")].find((e) => own(e) === label && e.getBoundingClientRect().x > PX - 40 && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().y > 0 && e.getBoundingClientRect().y < 1000);
  if (!lab) return null;
  const lr = lab.getBoundingClientRect();
  const ins = [...document.querySelectorAll("input.vc-slider")].map((i) => ({ i, r: i.getBoundingClientRect() })).filter(({ r }) => r.width > 150 && r.y >= lr.y - 4 && r.y < lr.y + 60);
  ins.sort((a, b) => a.r.y - b.r.y);
  if (!ins[0]) return null;
  const { i, r } = ins[0];
  const frac = (Number(i.value) - Number(i.min || 0)) / ((Number(i.max || 1) - Number(i.min || 0)) || 1);
  return { x0: r.left + 8, w: r.width - 16, y: r.y + r.height / 2, frac };
}, [label, PX]);



/** In-page tracker: every 70 ms logs [epoch seconds, x, y, w, h] of the part of the interface a call-out should outline. */
export const installTracker = (page, kind) => page.evaluate((kind) => {
  const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
  const R = (e) => e.getBoundingClientRect();
  const vis = (r) => r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight;
  const byText = (t) => [...document.querySelectorAll("*")].filter((e) => own(e) === t && vis(R(e)));
  const union = (rs) => { rs = rs.filter(Boolean); if (!rs.length) return null; const l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top)), r2 = Math.max(...rs.map((r) => r.right)), b = Math.max(...rs.map((r) => r.bottom)); return { x: l, y: t, w: r2 - l, h: b - t }; };
  const card = (t) => { const e = byText(t).find((x) => R(x).x > 200); const c = e && e.closest(".vc-card"); return c ? R(c) : null; };
  const row = (t) => { const e = byText(t).find((x) => R(x).x > 200); const c = e && e.closest(".vc-row"); return c ? R(c) : null; };
  const resolve = {
    strains: () => union([...document.querySelectorAll(".vc-sc-row")].map(R).filter(vis)),
    palettes: () => union([card("Palette")]),
    pads: () => { const e = document.querySelector(".vc-pads"); return e && vis(R(e)) ? union([R(e)]) : null; },
    wire: () => { const e = document.querySelector(".vc-row.vc-drive-pinned"); const r = e && R(e); return r && vis(r) ? union([r]) : null; },
    hits: () => union(["Envelope", "Beat", "Low", "Mid", "High"].map(row)),
    master: () => union([card("Scale")]),
    cuep: () => union(["cueBtn", "goBtn"].map((id) => { const e = document.getElementById(id); const r = e && R(e); return r && vis(r) ? r : null; })),
    room: () => { const g = (t) => { const e = byText(t)[0]; if (!e) return null; let n = e; for (let i = 0; i < 3 && n.parentElement; i++) n = n.parentElement; return R(n); }; const m = byText("the room's look")[0]; return union([m && R(m.parentElement), g("Mac"), g("TV")]); },
  }[kind];
  window.__trk = [];
  setInterval(() => {
    let r = null; try { r = resolve(); } catch (e) {}
    const root = document.querySelector(".vc-root.vc-open"); const rb = root ? R(root) : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const clip = kind === "cuep" || kind === "room" ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : { left: Math.max(0, rb.left), top: Math.max(0, rb.top), right: Math.min(innerWidth, rb.right), bottom: Math.min(innerHeight, rb.bottom) };
    if (r) { const l = Math.max(r.x, clip.left), t = Math.max(r.y, clip.top), rr = Math.min(r.x + r.w, clip.right), b = Math.min(r.y + r.h, clip.bottom); r = rr - l > 8 && b - t > 8 ? [l, t, rr - l, b - t] : null; } else r = null;
    window.__trk.push([(performance.timeOrigin + performance.now()) / 1000, ...(r || [])]);
  }, 70);
}, kind);
