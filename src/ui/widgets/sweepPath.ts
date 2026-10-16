import { registerWidget, type WidgetCtx } from "./registry.ts";
import type { PanelSection } from "../../render/scene.ts";

/**
 * Sweep's Path section (src/render/scenes/sweep/index.ts): the New path row
 * — the trigger that re-rolls the stack's path on its own wire, a phrase by
 * default — and a New path button that re-rolls it now.
 *
 * The button writes the scene's path seed setting rather than calling
 * `ctx.command()`: a command stays on this device, while a setting change
 * reaches the pop-out output and a room's TV (src/net/outputSync.ts) and is
 * kept in a saved Look, so a Look brings back the exact path it was saved
 * with. The section's `settings` name the rows in order: the trigger, then
 * the seed.
 */
function buildSweepPath(container: HTMLElement, section: PanelSection, ctx: WidgetCtx): void {
  const [triggerKey, seedKey] = section.settings ?? [];
  const trigger = ctx.specs.find((s) => s.key === triggerKey);
  const seed = ctx.specs.find((s) => s.key === seedKey);
  if (trigger) ctx.mountRows(container, [{ spec: trigger }]);
  if (!seed) return;

  const row = document.createElement("div");
  row.className = "vc-mix-row";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "New path";
  btn.title = "Rolls a new direction, curve and place for the stack now";
  btn.addEventListener("click", () => {
    const span = seed.max - seed.min + 1;
    const step = 1 + Math.floor(Math.random() * (span - 1));
    const next = seed.min + ((Math.round(ctx.get(seed)) - seed.min + step) % span);
    ctx.set(seed, next);
  });
  row.appendChild(btn);
  container.appendChild(row);
}

registerWidget("sweepPath", buildSweepPath);
