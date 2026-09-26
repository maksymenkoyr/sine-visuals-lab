import { BEAT_GRIDS, type BeatGridIndex } from "../audio/beatGrid.ts";
import { sourceKey, type DriveSourceChoice } from "../render/drives.ts";
import type { SignalId } from "../render/signals.ts";
import { AUTO_SKY, BANDS_AMBER, HOT_RED, HOT_YELLOW, INPUT_GREEN, POWER_TEAL, STRIP_HIGH, STRIP_LOW, STRIP_MID } from "./controlsTheme.ts";

/**
 * One place naming every drive source's colour and panel label (the patch
 * bay — src/ui/deviceMenu.ts's scene rows and patch panel): the input port,
 * the source summary line, a row's sparkline trace, and a source line inside
 * an expanded patch. Phase 2b's jacks (src/ui/deviceMenu.ts's own plan)
 * reuse this same map rather than re-deriving colours per meter row.
 *
 * Labels deliberately diverge from src/render/signals.ts's own SIGNALS
 * labels where the panel's meter-row wording ("Bass hit", singular — this
 * *is* the signal) reads wrong as a patch source ("Bass hits", "this
 * setting is fed by bass hits", plural) — see each entry below. A grid
 * source's label always carries its division ("Beat grid · Bar") since,
 * unlike a catalogue id, its identity isn't fixed; the patch panel's own
 * division chips show just the division on its own.
 */

const SIGNAL_SOURCE_LABEL: Record<SignalId, string> = {
  "feature.onset": "Any hit",
  "feature.flux": "Onset surge",
  "anim.lowOnset": "Bass hits",
  "anim.midOnset": "Mid hits",
  "anim.highOnset": "Treble hits",
  "anim.dropOnset": "Drop",
  "anim.low": "Bass level",
  "anim.mid": "Mid level",
  "anim.high": "Treble level",
  "anim.energy": "Loudness",
  "anim.sectionIntensity": "Song intensity",
  "anim.centroid": "Brightness",
  "anim.beatWave": "Beat wave",
  "anim.barWave": "Bar wave",
  "anim.tempo": "Tempo",
  "anim.tempoLock": "Tempo lock",
};

/** Plain-language descriptions for every source a jack can plug in — the
 *  "cover everything with hints" pass (CLAUDE.md's own doc-ownership rule:
 *  this sits next to the colour/label map above rather than in a doc, since
 *  a source's description has exactly this one home). Read by a jack's own
 *  instant tooltip ("<Source> — <description>", deviceMenu.ts's
 *  onJackHover) and by the patch panel's "+ Add by name" chips (both a
 *  hover tooltip and, while it's inside the pinned panel, the panel's own
 *  bottom hint line). Grid/line choices aren't `SignalId`s, so they get
 *  their own two entries below rather than living in this record. */
const SIGNAL_SOURCE_DESCRIPTION: Record<SignalId, string> = {
  "feature.onset": "any sudden jump across the whole spectrum.",
  "feature.flux": "how sharply the sound is changing right now, compared with the hit threshold.",
  "anim.lowOnset": "kicks and bass notes landing.",
  "anim.midOnset": "snares, claps and vocal attacks.",
  "anim.highOnset": "hi-hats, cymbals and sharp highs.",
  "anim.dropOnset": "fires once when a drop lands.",
  "anim.low": "how loud the bass is right now, moving smoothly.",
  "anim.mid": "how loud the mids are right now, moving smoothly.",
  "anim.high": "how loud the treble is right now, moving smoothly.",
  "anim.energy": "overall loudness across every band.",
  "anim.sectionIntensity": "how intense this part of the song is, over the last few seconds.",
  "anim.centroid": "where the sound's energy sits, from dark and low to bright and high.",
  "anim.beatWave": "a smooth swing that peaks once every beat, fading out without a confident tempo.",
  "anim.barWave": "the same smooth swing as Beat wave, once every bar instead.",
  "anim.tempo": "how fast the tracked tempo is, from slow to fast.",
  "anim.tempoLock": "how confidently the tempo tracker has locked onto a beat.",
};

const GRID_SOURCE_DESCRIPTION = "a steady pulse locked to the tempo.";
const LINE_SOURCE_DESCRIPTION = "your own curve on the spectrum — bars that rise above it drive the setting.";

/** "white" in the plan's own colour list — a near-white rather than pure
 *  #fff so it doesn't blow out against the panel's glass. */
export const DRIVE_WHITE = "#f2f2f7";

const SIGNAL_SOURCE_COLOR: Record<SignalId, string> = {
  "feature.onset": HOT_RED,
  "feature.flux": DRIVE_WHITE,
  "anim.lowOnset": STRIP_LOW,
  "anim.midOnset": STRIP_MID,
  "anim.highOnset": STRIP_HIGH,
  "anim.dropOnset": HOT_YELLOW,
  "anim.low": STRIP_LOW,
  "anim.mid": STRIP_MID,
  "anim.high": STRIP_HIGH,
  "anim.energy": INPUT_GREEN,
  "anim.sectionIntensity": POWER_TEAL,
  "anim.centroid": AUTO_SKY,
  "anim.beatWave": DRIVE_WHITE,
  "anim.barWave": DRIVE_WHITE,
  "anim.tempo": DRIVE_WHITE,
  "anim.tempoLock": DRIVE_WHITE,
};

function isGridChoice(choice: DriveSourceChoice): choice is { source: "beat"; grid: number } {
  return typeof choice === "object" && choice.source === "beat";
}

// Plain-language note-value names, distinct from beatGrid.ts's own
// DAW-quantise-menu labels ("1/8", "1 bar", …) — a picker that showed those
// verbatim got called cryptic (see the git history around the Revision-3
// picker this module's own callers replace). Index 0 ("Hits") never reaches
// here — it's the plain "Any hit" catalogue choice under a different name,
// not a grid source at all.
const GRID_DIVISION_LABEL: Record<number, string> = {
  1: "½ beat",
  2: "Beat",
  3: "2 beats",
  4: "Bar",
  5: "2 bars",
};

/** A grid division's own plain-language chip text (the patch panel's
 *  division chips) — bare, no "Beat grid ·" prefix (driveSourceLabel below
 *  carries that for the fuller contexts: the row summary, the source line's
 *  own name, an add-chip). */
export function driveGridDivisionLabel(grid: BeatGridIndex): string {
  const i = Math.min(BEAT_GRIDS.length - 1, Math.max(0, Math.round(grid)));
  return GRID_DIVISION_LABEL[i] ?? GRID_DIVISION_LABEL[2]!;
}

/** True for a `{source:"beat", grid}` choice of any division — used to spot
 *  "this patch already has a grid source" regardless of which one, since a
 *  patch only ever carries one in practice (see drives.ts's header). */
export function isGridSourceChoice(choice: DriveSourceChoice): boolean {
  return isGridChoice(choice);
}

export function isLineSourceChoice(choice: DriveSourceChoice): boolean {
  return typeof choice === "object" && choice.source === "line";
}

/** The identity a patch-bay jack (src/ui/jack.ts) keys itself by — every
 *  grid division collapses to one shared key ("grid"), since a patch
 *  carries at most one grid source regardless of division (drives.ts's own
 *  header) and the Beat row's jack/the Tempo add-chip both mean "toggle
 *  whichever one's already there", never one specific division (this is
 *  the same collapse buildAddChips' own Tempo-chip click handler in
 *  deviceMenu.ts applies by hand). Every other choice keys by its own
 *  drives.ts sourceKey, unchanged. */
export function jackKey(choice: DriveSourceChoice): string {
  return isGridSourceChoice(choice) ? "grid" : sourceKey(choice);
}

/** The full display label — a row's source summary, a patch source line's
 *  name, a sparkline's tooltip. */
export function driveSourceLabel(choice: DriveSourceChoice): string {
  if (typeof choice === "object") {
    return choice.source === "beat" ? `Beat grid · ${driveGridDivisionLabel(choice.grid)}` : "Drawn line";
  }
  return SIGNAL_SOURCE_LABEL[choice];
}

export function driveSourceColor(choice: DriveSourceChoice): string {
  if (typeof choice === "object") return choice.source === "beat" ? DRIVE_WHITE : BANDS_AMBER;
  return SIGNAL_SOURCE_COLOR[choice];
}

/** The plain-language description below a source's own label — a jack's
 *  instant tooltip's first line, and an add-by-name chip's hint. */
export function driveSourceDescription(choice: DriveSourceChoice): string {
  if (typeof choice === "object") return choice.source === "beat" ? GRID_SOURCE_DESCRIPTION : LINE_SOURCE_DESCRIPTION;
  return SIGNAL_SOURCE_DESCRIPTION[choice];
}

/** One "+ Add by name" group (src/ui/deviceMenu.ts's patch panel). Tempo
 *  carries a single representative choice (Beat grid's own default
 *  division, index 2 — see drives.ts's nextChoiceForMode note this replaces)
 *  since the panel's own per-source division chips are how a division other
 *  than that default gets picked; the chip's own click handler in
 *  deviceMenu.ts special-cases it to toggle *whichever* grid source is
 *  already present (isGridSourceChoice above), not just this exact one. */
export interface DriveAddGroup {
  label: string;
  choices: DriveSourceChoice[];
}

export const DRIVE_ADD_GROUPS: readonly DriveAddGroup[] = [
  { label: "Hits", choices: ["feature.onset", "anim.lowOnset", "anim.midOnset", "anim.highOnset", "anim.dropOnset"] },
  {
    label: "Levels",
    choices: ["anim.energy", "anim.low", "anim.mid", "anim.high", "feature.flux", "anim.sectionIntensity", "anim.centroid"],
  },
  { label: "Tempo", choices: [{ source: "beat", grid: 2 }, "anim.beatWave", "anim.barWave", "anim.tempo", "anim.tempoLock"] },
  { label: "Line", choices: [{ source: "line" }] },
];
