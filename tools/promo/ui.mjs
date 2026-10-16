// The UI-shot half of capture.mjs (see its header): the init scripts that make
// the page promo-clean — a visible cursor, no toasts, a neutral mic name — and
// the ctx handed to an --actions module.
//
// All coordinates here are frame pixels, what the video shows. Under CSS
// `zoom` on <html> (capture.mjs --zoom) Chromium reports mouse and
// getBoundingClientRect in those same viewport pixels, so nothing converts;
// only the overlay's own CSS lengths are divided by the zoom, to stay one
// size on screen.

/** Init script: the cursor overlay. A white dot with a soft ring, scaled down
 *  while pressed, with a ripple per press. It follows real mouse events
 *  (Playwright's page.mouse), so it needs no API of its own. */
export function cursorInitScript() {
  return `(() => {
  const DOT = 34; // on-screen px of the dot, whatever the zoom
  const css = \`
    #__cur { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none; display: none; will-change: transform; }
    #__cur * { pointer-events: none; box-sizing: border-box; }
    #__cur .ring { position: absolute; width: calc(var(--d) * 2.1); height: calc(var(--d) * 2.1); left: calc(var(--d) * -1.05); top: calc(var(--d) * -1.05);
      border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,0.30) 0 42%, rgba(255,255,255,0.13) 68%, rgba(255,255,255,0) 100%); transition: transform .14s ease-out; }
    #__cur .dot { position: absolute; width: var(--d); height: var(--d); left: calc(var(--d) * -0.5); top: calc(var(--d) * -0.5); border-radius: 50%;
      background: #fff; box-shadow: 0 0 0 calc(var(--d) * 0.04) rgba(0,0,0,0.16), 0 calc(var(--d) * 0.08) calc(var(--d) * 0.3) rgba(0,0,0,0.38); transition: transform .14s ease-out; }
    #__cur.down .dot { transform: scale(0.78); }
    #__cur.down .ring { transform: scale(0.85); }
    #__cur .rip { position: absolute; width: var(--d); height: var(--d); left: calc(var(--d) * -0.5); top: calc(var(--d) * -0.5); border-radius: 50%;
      border: calc(var(--d) * 0.07) solid rgba(255,255,255,0.9); animation: __rip .6s cubic-bezier(.2,.7,.3,1) forwards; }
    @keyframes __rip { from { transform: scale(0.9); opacity: 0.95; } to { transform: scale(3.4); opacity: 0; } }
  \`;
  const mount = () => {
    if (document.getElementById("__cur")) return;
    const st = document.createElement("style");
    st.textContent = css;
    const el = document.createElement("div");
    el.id = "__cur";
    el.innerHTML = '<div class="ring"></div><div class="dot"></div>';
    document.documentElement.append(st, el);
    const z = () => parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const put = (e) => {
      const k = z();
      el.style.setProperty("--d", DOT / k + "px");
      el.style.transform = "translate(" + e.clientX / k + "px," + e.clientY / k + "px)";
      el.style.display = "block";
    };
    addEventListener("mousemove", put, true);
    addEventListener("mousedown", (e) => {
      put(e);
      el.classList.add("down");
      const r = document.createElement("div");
      r.className = "rip";
      el.appendChild(r);
      setTimeout(() => r.remove(), 700);
    }, true);
    addEventListener("mouseup", () => el.classList.remove("down"), true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", mount); else mount();
})();`;
}

/** Init script: promo-clean chrome. Hides toasts and the status HUD line (the "Press ? for shortcuts"
 *  welcome among them), renames the fake mic, and stubs getDisplayMedia. */
export function chromeInitScript({ hideToasts, folds = null }) {
  return `(() => {
  const NAME = "Microphone";
  if (${hideToasts ? "true" : "false"}) {
    const add = () => {
      const st = document.createElement("style");
      st.textContent = ".vc-toast, #hud { display: none !important; }";
      document.documentElement.appendChild(st);
    };
    if (document.documentElement) add(); else addEventListener("DOMContentLoaded", add);
  }
  try {
    const folds = ${folds ? JSON.stringify(folds) : "null"};
    if (folds) localStorage.setItem("vibe.panelFolds", JSON.stringify(folds));
  } catch {}
  try {
    localStorage.setItem("vibe.keyTips", JSON.stringify({ used: {}, tipped: {}, welcomed: true }));
  } catch {}
  const md = navigator.mediaDevices;
  if (md && md.enumerateDevices) {
    const orig = md.enumerateDevices.bind(md);
    // The fake device list has two inputs; one "Microphone" is what a laptop shows.
    md.enumerateDevices = async () => {
      let seen = false;
      return (await orig()).filter((d) => d.kind !== "audioinput" || (seen ? false : (seen = true))).map((d) => {
        if (d.kind !== "audioinput") return d;
        const o = { deviceId: d.deviceId, groupId: d.groupId, kind: d.kind, label: d.label ? NAME : d.label, toJSON() { return o; } };
        return Object.setPrototypeOf(o, MediaDeviceInfo.prototype);
      });
    };
  }
  // "Screen" in a shot: a real getDisplayMedia on the Mac is heavy and would
  // film the desktop's own picker; hand back a silent audio track and a 16 px
  // video track instead (the app keeps only the audio — src/audio/capture.ts).
  if (md) {
    md.getDisplayMedia = async () => {
      const ac = new AudioContext();
      const dst = ac.createMediaStreamDestination();
      const osc = ac.createOscillator();
      const g = ac.createGain();
      g.gain.value = 0;
      osc.connect(g).connect(dst);
      osc.start();
      const cv = document.createElement("canvas");
      cv.width = cv.height = 16;
      cv.getContext("2d").fillRect(0, 0, 16, 16);
      return new MediaStream([...cv.captureStream(1).getVideoTracks(), ...dst.stream.getAudioTracks()]);
    };
  }
  const desc = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, "label");
  if (desc && desc.get) {
    Object.defineProperty(MediaStreamTrack.prototype, "label", {
      configurable: true,
      get() { const v = desc.get.call(this); return this.kind === "audio" && /fake/i.test(v) ? NAME : v; },
    });
  }
})();`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/** The ctx an --actions module receives. `clock()` is seconds on the clip's clock. */
export function makeCtx({ page, W, H, zoom, keys, clock }) {
  const marks = [];
  let pos = null;

  const mark = (name) => {
    marks.push({ t: clock(), name });
    console.log(`  mark ${clock().toFixed(2)} s  ${name}`);
  };

  async function target(t) {
    if (Array.isArray(t)) return { x: t[0], y: t[1] };
    if (t && typeof t === "object" && "x" in t && !("boundingBox" in t)) return { x: t.x, y: t.y };
    const loc = typeof t === "string" ? page.locator(t).first() : t;
    await loc.waitFor({ state: "visible", timeout: 5000 });
    const b = await loc.boundingBox();
    if (!b) throw new Error(`no box for ${t}`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }

  const cursor = {
    place: async (x, y) => {
      pos = [x, y];
      await page.mouse.move(x, y);
    },
    /** Eased, gently curved glide, timed by the clock (a slow CDP round trip
     *  skips positions rather than stretching the move). */
    moveTo: async (x, y, ms = 500) => {
      if (!pos) await cursor.place(W * 0.78, H * 0.88);
      const [x0, y0] = pos;
      const dx = x - x0, dy = y - y0, dist = Math.hypot(dx, dy);
      const bow = Math.min(60, dist * 0.06); // perpendicular bulge
      const nx = dist ? -dy / dist : 0, ny = dist ? dx / dist : 0;
      const t0 = performance.now();
      for (;;) {
        const k = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
        const e = ease(k), b = Math.sin(Math.PI * e) * bow;
        await page.mouse.move(x0 + dx * e + nx * b, y0 + dy * e + ny * b);
        if (k >= 1) break;
        await sleep(6);
      }
      pos = [x, y];
    },
  };

  const api = {
    page, W, H, zoom, keys, marks, cursor, mark,
    fromAt: null,
    /** Marks where the clip starts (with --from auto). */
    startAt() { api.fromAt = clock(); mark("clip starts"); },
    t: clock,
    wait: sleep,
    press: (k) => page.keyboard.press(k),
    /** Adds a stylesheet to the page (to hide something in one shot). */
    css: (text) => page.addStyleTag({ content: text }),
    snap: (path) => page.screenshot({ path }),
    /** Glide to the target, settle a beat, press and release. */
    tap: async (t, { ms = 520, hold = 110, label } = {}) => {
      const p = await target(t);
      await cursor.moveTo(p.x, p.y, ms);
      await sleep(90);
      mark(`tap ${label || (typeof t === "string" ? t : `${Math.round(p.x)},${Math.round(p.y)}`)}`);
      await page.mouse.down();
      await sleep(hold);
      await page.mouse.up();
      await sleep(60);
    },
    drag: async (from, to, ms = 900, { grab = 380 } = {}) => {
      const a = await target(from), b = await target(to);
      await cursor.moveTo(a.x, a.y, grab);
      await sleep(80);
      mark(`drag start ${typeof from === "string" ? from : `${Math.round(a.x)},${Math.round(a.y)}`}`);
      await page.mouse.down();
      await sleep(90);
      await cursor.moveTo(b.x, b.y, ms);
      await sleep(70);
      await page.mouse.up();
      mark(`drag end ${typeof to === "string" ? to : `${Math.round(b.x)},${Math.round(b.y)}`}`);
    },
  };
  return api;
}
