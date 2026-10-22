/**
 * The dev-only Smoothness formula picker (render/gateFormulas.ts's header): a
 * plain select listing gateWindow.ts's GATE_FORMULAS, shown under a
 * Smoothness slider on a setting's own window (deviceMenu.ts) and on a
 * wire's modifier (wireModControls.ts). Temporary, like the store behind it.
 */
import { GATE_FORMULAS, type GateFormula } from "../render/gateWindow.ts";

export function buildGateFormulaPicker(current: GateFormula, onPick: (f: GateFormula) => void): HTMLSelectElement {
  const pick = document.createElement("select");
  pick.setAttribute("aria-label", "Smoothness formula (dev)");
  pick.style.cssText =
    "flex-basis: 100%; width: 100%; font: inherit; font-size: 12px; color: inherit; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.18); border-radius: 4px; padding: 3px 6px; margin: 4px 0 8px;";
  for (const f of GATE_FORMULAS) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = `Formula (dev): ${f.label}`;
    pick.appendChild(opt);
  }
  pick.value = current;
  pick.addEventListener("change", () => onPick(pick.value as GateFormula));
  return pick;
}
