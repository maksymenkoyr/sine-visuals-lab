import { FONT_MONO, INPUT_GREEN, withAlpha } from "../controlsTheme.ts";
import { registerWidget, type WidgetCtx } from "./registry.ts";
import { watchSize } from "../onScreen.ts";
import type { PanelSection } from "../../render/scene.ts";
import { LOOPS } from "../../render/scenes/alien/reel.ts";

/**
 * The Move readout (Alien, src/render/scenes/alien/): the Move row, then what
 * the music is buying right now, all from the scene's probe() every tick.
 *   - speed: the playback speed, × the dance as captured;
 *   - buying: frames of the baked loop paid for per second at that speed;
 *   - the loop on screen (of LOOPS) and its clip;
 *   - the loop as a strip of its frames, filled up to the playhead, and the
 *     frame number. In silence nothing is bought, so the strip stops and
 *     greys out.
 * The rows are the device menu's own (`ctx.mountRows`: port, wire panel,
 * slider, reset). The section's `settings` name them: the first goes above
 * the readout, the rest below it.
 */

/** Frame ticks are drawn only while one frame is at least this many device
 *  pixels wide; narrower, the strip would be all ticks. */
const MIN_TICK_PX = 3;
const HELD_GREY = "rgba(255,255,255,0.28)";

function buildAlienPlay(container: HTMLElement, section: PanelSection, ctx: WidgetCtx): void {
  const specs = (section.settings ?? []).map((k) => ctx.specs.find((s) => s.key === k)).filter((s): s is NonNullable<typeof s> => !!s);
  if (specs.length) ctx.mountRows(container, [{ spec: specs[0] }]);

  const box = document.createElement("div");
  box.style.cssText = `display:flex;flex-direction:column;gap:4px;padding:2px 0 8px;font:400 11px/1.2 ${FONT_MONO};color:rgba(255,255,255,0.62);`;
  const line = (): [HTMLDivElement, HTMLSpanElement, HTMLSpanElement] => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-between;gap:8px;";
    const left = document.createElement("span");
    const right = document.createElement("span");
    row.append(left, right);
    return [row, left, right];
  };
  const [head, speedOut, boughtOut] = line();
  boughtOut.style.color = INPUT_GREEN;
  const [loopRow, loopOut] = line();
  const strip = document.createElement("canvas");
  strip.style.cssText = "width:100%;height:18px;display:block;border-radius:2px;background:rgba(255,255,255,0.04);";
  strip.title =
    "The loop on screen, one tick per frame. The fill is how far the music has paid through it; " +
    "in silence it stops where it is, and so does the alien.";
  const [frameRow, frameOut] = line();
  box.append(head, loopRow, strip, frameRow);
  container.appendChild(box);
  if (specs.length > 1) ctx.mountRows(container, specs.slice(1).map((spec) => ({ spec })));

  // Observed, not read every tick: a clientWidth read after the text writes
  // below would force a layout pass (onScreen.ts).
  const size = watchSize(strip);
  ctx.onDispose(() => size.disconnect());

  ctx.onTick(() => {
    const p = ctx.probe();
    if (!p) return;
    const speed = Math.max(0, p.speed ?? 0);
    const frames = Math.max(0, Math.round(p.frames ?? 0));
    const frame = Math.max(0, p.frame ?? 0);
    const held = speed <= 0;
    const loop = Math.round(p.loop ?? 0);
    speedOut.textContent = `speed ${speed.toFixed(2)}×`;
    boughtOut.textContent = `buying ${Math.round(p.bought ?? 0)} fr/s`;
    boughtOut.style.color = held ? HELD_GREY : INPUT_GREEN;
    loopOut.textContent = `loop ${loop + 1} of ${LOOPS.length} · ${LOOPS[loop]?.clip ?? "?"}`;
    frameOut.textContent = frames ? `frame ${Math.floor(frame)} / ${frames}${held ? " · held" : ""}` : "loading the dance…";

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(size.w * dpr));
    const h = Math.max(1, Math.round(size.h * dpr));
    if (strip.width !== w || strip.height !== h) {
      strip.width = w;
      strip.height = h;
    }
    const g = strip.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, w, h);
    if (!frames) return;
    const colour = held ? HELD_GREY : INPUT_GREEN;
    const x = (frame / frames) * w;
    g.fillStyle = held ? "rgba(255,255,255,0.1)" : withAlpha(INPUT_GREEN, 0.28);
    g.fillRect(0, 0, x, h);
    if (w / frames >= MIN_TICK_PX) {
      // Dark ticks over the frames paid through, faint ones over the rest.
      for (let f = 1; f < frames; f++) {
        g.fillStyle = f < frame ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.07)";
        g.fillRect(Math.round((f / frames) * w), 0, 1, h);
      }
    }
    g.fillStyle = colour;
    g.fillRect(Math.max(0, x - dpr), 0, 2 * dpr, h);
  });
}

registerWidget("alienPlay", buildAlienPlay);
