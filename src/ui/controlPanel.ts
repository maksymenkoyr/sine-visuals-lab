import type { RosterEntry, DeviceCommand } from "../net/room.ts";

export interface MenuItem {
  id: string;
  name: string;
}

export interface ControlPanelDeps {
  getRoster: () => RosterEntry[];
  onRosterChange: (cb: (r: RosterEntry[]) => void) => () => void;
  setDevice: (targetId: string, cmd: DeviceCommand) => void;
  scenes: MenuItem[];
  palettes: MenuItem[];
  selfDeviceId: string;
}

export interface ControlPanel {
  toggle(): void;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const overlayStyle = `
  position: fixed; inset: 0; z-index: 30; display: none;
  background: #000c; color: #fff; font-family: system-ui, sans-serif;
  align-items: center; justify-content: center;
`;
const panelStyle = `
  background: #111; border: 1px solid #fff2; border-radius: 16px;
  padding: 20px; width: min(420px, 92vw); max-height: 85vh; overflow-y: auto;
`;
const rowStyle = `
  display: flex; align-items: center; gap: 8px; padding: 8px 0;
  border-bottom: 1px solid #fff1; font-size: 13px;
`;
const selectStyle = `
  flex: 1; background: #1a1a1a; color: #fff; border: 1px solid #fff2;
  border-radius: 6px; padding: 6px; font: inherit; font-size: 12px;
`;
const actionBtnStyle = `
  flex: 1; padding: 10px; margin: 4px; border-radius: 8px; border: 1px solid #fff2;
  background: #fff1; color: #fff; font: inherit; font-size: 13px; cursor: pointer;
`;

/** Smallest slice a drag can leave a device, as a [0,1] fraction of the shared canvas. */
const MIN_SEGMENT_WIDTH = 0.04;
const SEGMENT_COLORS = ["#3b5bfd", "#e0426b", "#1fb583", "#f2a93b", "#8e5bf2", "#2bb6c9"];

/**
 * Room panel: lists every connected device with its current scene/palette,
 * lets any device set any other device's scene/palette, and offers
 * room-wide bulk actions. Available from any device, not just the host —
 * "control" in this app is a capability, not a role.
 */
export function createControlPanel(deps: ControlPanelDeps): ControlPanel {
  const root = document.createElement("div");
  root.style.cssText = overlayStyle;

  const panel = document.createElement("div");
  panel.style.cssText = panelStyle;

  const title = document.createElement("div");
  title.textContent = "Room";
  title.style.cssText = "font-weight: 700; font-size: 16px; margin-bottom: 12px;";

  const list = document.createElement("div");

  const actions = document.createElement("div");
  actions.style.cssText = "display: flex; flex-wrap: wrap; margin-top: 14px;";

  function makeActionButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText = actionBtnStyle;
    btn.addEventListener("click", onClick);
    return btn;
  }

  const shuffleBtn = makeActionButton("Shuffle", () => {
    for (const d of deps.getRoster()) {
      deps.setDevice(d.deviceId, { scene: pick(deps.scenes).id, palette: pick(deps.palettes).id });
    }
  });

  const syncBtn = makeActionButton("Sync all to me", () => {
    const self = deps.getRoster().find((d) => d.deviceId === deps.selfDeviceId);
    if (!self) return;
    for (const d of deps.getRoster()) {
      if (d.deviceId === deps.selfDeviceId) continue;
      deps.setDevice(d.deviceId, { scene: self.scene, palette: self.palette });
    }
  });

  const mirrorBtn = makeActionButton("Mirror", () => {
    const scene = pick(deps.scenes).id;
    const palette = pick(deps.palettes).id;
    for (const d of deps.getRoster()) deps.setDevice(d.deviceId, { scene, palette });
  });

  const mosaicBtn = makeActionButton("Mosaic", () => {
    const palette = pick(deps.palettes).id;
    const roster = deps.getRoster();
    roster.forEach((d, i) => {
      deps.setDevice(d.deviceId, { scene: deps.scenes[i % deps.scenes.length].id, palette });
    });
  });

  // Same scene everywhere, but each device gets an even horizontal slice of
  // one shared virtual canvas — for 3 devices this is exactly "left wall /
  // center / right wall" with no extra shortcut needed.
  const panoramaBtn = makeActionButton("Panorama", () => {
    const roster = deps.getRoster();
    if (roster.length === 0) return;
    const sceneId = pick(deps.scenes).id;
    const paletteId = pick(deps.palettes).id;
    const n = roster.length;
    roster.forEach((d, i) => {
      deps.setDevice(d.deviceId, {
        scene: sceneId,
        palette: paletteId,
        viewport: { x: i / n, y: 0, w: 1 / n, h: 1 },
      });
    });
  });

  actions.append(shuffleBtn, syncBtn, mirrorBtn, mosaicBtn, panoramaBtn);

  const layoutHeading = document.createElement("div");
  layoutHeading.textContent = "Panorama layout — drag to resize";
  layoutHeading.style.cssText = "font-size: 11px; opacity: 0.5; margin: 14px 0 6px;";

  const layoutStrip = document.createElement("div");
  layoutStrip.style.cssText =
    "position: relative; display: flex; height: 56px; background: #1a1a1a; border-radius: 8px; overflow: hidden;";

  const closeBtn = makeActionButton("Close", close);
  closeBtn.style.marginTop = "10px";

  panel.append(title, list, actions, layoutHeading, layoutStrip, closeBtn);
  root.appendChild(panel);
  root.addEventListener("click", (e) => {
    if (e.target === root) close();
  });
  document.body.appendChild(root);

  function renderList(): void {
    const roster = deps.getRoster();
    list.innerHTML = "";
    for (const d of roster) {
      const row = document.createElement("div");
      row.style.cssText = rowStyle;

      const label = document.createElement("span");
      const tag = d.deviceId === deps.selfDeviceId ? "you" : d.role;
      label.textContent = `${d.deviceId.slice(-4).toUpperCase()} (${tag})`;
      label.style.cssText = "width: 90px; flex-shrink: 0; opacity: 0.8;";

      const paletteSelect = document.createElement("select");
      paletteSelect.style.cssText = selectStyle;
      for (const p of deps.palettes) {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        opt.selected = p.id === d.palette;
        paletteSelect.appendChild(opt);
      }
      paletteSelect.addEventListener("change", () => deps.setDevice(d.deviceId, { palette: paletteSelect.value }));

      row.append(label, paletteSelect);
      list.appendChild(row);
    }
    if (roster.length === 0) {
      list.textContent = "No devices yet.";
    }
  }

  /**
   * A left-to-right strip mirroring the shared Panorama canvas, one colored
   * segment per device, with draggable handles between them. Devices that
   * were never assigned a slice (still full-screen {0,0,1,1}) are shown as
   * an even split purely for display — dragging commits that split for
   * *every* device first, so a partial drag can never leave someone still
   * overlapping the rest of the room.
   */
  // Committing the initial partition (see startDrag) round-trips through the
  // server and echoes back as a roster update — without this guard, that
  // echo would rebuild layoutStrip's DOM (and its actively-captured handle)
  // out from under the pointer mid-drag.
  let dragging = false;

  function renderLayout(): void {
    if (dragging) return;
    const roster = deps.getRoster();
    layoutStrip.innerHTML = "";
    if (roster.length === 0) return;

    let order = [...roster].sort((a, b) => a.viewport.x - b.viewport.x);
    const partitioned = order.every((d, i) => i === 0 || d.viewport.x - order[i - 1].viewport.x > 1e-6);
    let widths: number[];
    if (partitioned) {
      widths = order.map((d) => Math.max(d.viewport.w, 0.01));
    } else {
      order = [...roster];
      widths = order.map(() => 1 / order.length);
    }

    order.forEach((d, i) => {
      const seg = document.createElement("div");
      seg.style.cssText = `
        flex: ${widths[i]} 0 0%; display: flex; align-items: center; justify-content: center;
        font-size: 11px; color: #fff; background: ${SEGMENT_COLORS[i % SEGMENT_COLORS.length]};
        user-select: none; overflow: hidden;
      `;
      seg.textContent = d.deviceId.slice(-4).toUpperCase();
      layoutStrip.appendChild(seg);
    });

    for (let i = 0; i < order.length - 1; i++) {
      const boundaryPct = widths.slice(0, i + 1).reduce((s, w) => s + w, 0) * 100;
      const handle = document.createElement("div");
      handle.style.cssText = `
        position: absolute; top: 0; bottom: 0; width: 14px; left: calc(${boundaryPct}% - 7px);
        cursor: ew-resize; z-index: 2; touch-action: none;
      `;
      handle.addEventListener("pointerdown", (e) => startDrag(e, i, order, widths));
      layoutStrip.appendChild(handle);
    }
  }

  function startDrag(e: PointerEvent, handleIndex: number, order: RosterEntry[], widths: number[]): void {
    e.preventDefault();
    dragging = true;
    const handle = e.currentTarget as HTMLDivElement;
    handle.setPointerCapture(e.pointerId);

    // Commit a definitive partition for every device up front — otherwise a
    // device that isn't adjacent to this handle would be left behind at its
    // old (possibly full-screen) viewport.
    let cum = 0;
    for (let j = 0; j < order.length; j++) {
      deps.setDevice(order[j].deviceId, { viewport: { x: cum, y: 0, w: widths[j], h: 1 } });
      cum += widths[j];
    }

    const left = widths.slice(0, handleIndex).reduce((s, w) => s + w, 0);
    const right = left + widths[handleIndex] + widths[handleIndex + 1];
    const segA = layoutStrip.children[handleIndex] as HTMLDivElement;
    const segB = layoutStrip.children[handleIndex + 1] as HTMLDivElement;
    let boundary = left + widths[handleIndex];

    function onMove(ev: PointerEvent): void {
      const stripRect = layoutStrip.getBoundingClientRect();
      const frac = (ev.clientX - stripRect.left) / stripRect.width;
      boundary = Math.min(right - MIN_SEGMENT_WIDTH, Math.max(left + MIN_SEGMENT_WIDTH, frac));
      handle.style.left = `calc(${boundary * 100}% - 7px)`;
      segA.style.flex = `${boundary - left} 0 0%`;
      segB.style.flex = `${right - boundary} 0 0%`;
    }

    function onUp(ev: PointerEvent): void {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      const a = order[handleIndex];
      const b = order[handleIndex + 1];
      deps.setDevice(a.deviceId, { viewport: { x: left, y: 0, w: boundary - left, h: 1 } });
      deps.setDevice(b.deviceId, { viewport: { x: boundary, y: 0, w: right - boundary, h: 1 } });
      dragging = false;
      renderLayout(); // pick up whatever the server has echoed back while frozen
    }

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  function renderAll(): void {
    renderList();
    renderLayout();
  }

  deps.onRosterChange(renderAll);

  function close(): void {
    root.style.display = "none";
  }

  return {
    toggle() {
      if (root.style.display === "flex") {
        close();
      } else {
        renderAll();
        root.style.display = "flex";
      }
    },
  };
}
