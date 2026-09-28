import { describe, it, expect } from "vitest";
import {
  packTouch,
  smellWeight,
  TOUCH_EAT_GAIN,
  TOUCH_FEED_GAIN,
  TOUCH_MAX_BITE,
  AFFINITY_MAX,
  AFFINITY_MIN,
  AFFINITY_PRESETS,
  AFFINITY_QUANTUM,
  PAIR_WORDS,
  ATTRACT_ROWS,
  wordBand,
  pairZone,
  pairRelation,
  fillTemplate,
  fmtSigned,
  padPos,
  padValue,
  pairsOf,
  tablesMatch,
  quantize,
  randomSmell,
  randomTouch,
  nudgeTable,
  pushHistory,
  popHistory,
  OWN_TRAIL_RANDOM,
  NUDGE_MAX,
  MIX_HISTORY_MAX,
  type AffinityTables,
  type PairLayer,
} from "../src/render/scenes/physarum2Affinity.ts";

// Deterministic seeded RNG for the Random/Nudge/History tests below — the
// same mulberry32 shape physarum2Preview.ts (and several other scenes' own
// tests) use, copied locally rather than exported, per this repo's own
// convention (see e.g. tests/fluid.test.ts, tests/moire.test.ts).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rnd(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// feedRows/eatCols are Float32Array (the GPU's own uniform-array precision),
// so exact-decimal expectations use toBeCloseTo at a digit count float32
// actually holds (~7 significant digits), not toBe/10-digit closeness.

describe("packTouch", () => {
  it("all-zero input gives identity feed rows, all-zero eat columns, and returns false", () => {
    const n = 4;
    const touch = new Array(n * n).fill(0);
    const feedRows = new Float32Array(16);
    const eatCols = new Float32Array(16);
    const eats = packTouch(touch, n, feedRows, eatCols);
    expect(eats).toBe(false);
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) {
        expect(feedRows[k * 4 + j]).toBe(j === k ? 1 : 0);
      }
    }
    expect(Array.from(eatCols)).toEqual(new Array(16).fill(0));
  });

  it("+0.6 gives feedRows[i*4+j] = 0.6 * TOUCH_FEED_GAIN and returns false", () => {
    const n = 2;
    const touch = [0, 0.6, 0, 0]; // touch[0][1] = 0.6
    const feedRows = new Float32Array(16);
    const eatCols = new Float32Array(16);
    const eats = packTouch(touch, n, feedRows, eatCols);
    expect(eats).toBe(false);
    expect(feedRows[0 * 4 + 1]).toBeCloseTo(0.6 * TOUCH_FEED_GAIN, 5);
    expect(feedRows[0 * 4 + 0]).toBe(1); // own-channel entry always 1
    expect(feedRows[1 * 4 + 1]).toBe(1);
    expect(Array.from(eatCols)).toEqual(new Array(16).fill(0));
  });

  it("-1 gives eatCols[j*4+i] = -ln(1-0.3) and returns true", () => {
    const n = 2;
    const touch = [0, -1, 0, 0]; // strain 0 eats strain 1's trail
    const feedRows = new Float32Array(16);
    const eatCols = new Float32Array(16);
    const eats = packTouch(touch, n, feedRows, eatCols);
    expect(eats).toBe(true);
    // i = 0 (eater), j = 1 (victim): eatCols[1*4+0]
    expect(eatCols[1 * 4 + 0]).toBeCloseTo(-Math.log(1 - 0.3), 5);
    expect(feedRows[0 * 4 + 1]).toBe(0); // negative touch never feeds
  });

  it("a non-zero diagonal is ignored", () => {
    const n = 2;
    const touch = [0.9, 0, 0, -0.9]; // diagonal only
    const feedRows = new Float32Array(16);
    const eatCols = new Float32Array(16);
    const eats = packTouch(touch, n, feedRows, eatCols);
    expect(eats).toBe(false);
    expect(feedRows[0 * 4 + 0]).toBe(1);
    expect(feedRows[1 * 4 + 1]).toBe(1);
    expect(Array.from(eatCols)).toEqual(new Array(16).fill(0));
  });

  it("-10 caps at -ln(1-TOUCH_MAX_BITE)", () => {
    const n = 2;
    const touch = [0, -10, 0, 0];
    const feedRows = new Float32Array(16);
    const eatCols = new Float32Array(16);
    const eats = packTouch(touch, n, feedRows, eatCols);
    expect(eats).toBe(true);
    expect(eatCols[1 * 4 + 0]).toBeCloseTo(-Math.log(1 - TOUCH_MAX_BITE), 5);
  });

  it("for n = 0..5 landings, exp(-n*L) equals (1-bite)^n", () => {
    const bite = Math.min(TOUCH_MAX_BITE, 1 * TOUCH_EAT_GAIN);
    const feedRows = new Float32Array(16);
    const eatCols = new Float32Array(16);
    packTouch([0, -1, 0, 0], 2, feedRows, eatCols); // -1 -> bite = TOUCH_EAT_GAIN = 0.3
    const L = eatCols[1 * 4 + 0]!;
    for (let landings = 0; landings <= 5; landings++) {
      const viaExp = Math.exp(-landings * L);
      const viaPow = Math.pow(1 - bite, landings);
      expect(viaExp).toBeCloseTo(viaPow, 5);
    }
  });
});

describe("smellWeight", () => {
  it("leaves the diagonal unchanged regardless of rivalry", () => {
    expect(smellWeight(0.8, 1, 1, 0)).toBe(0.8);
    expect(smellWeight(0.8, 1, 1, 0.5)).toBe(0.8);
    expect(smellWeight(0.8, 1, 1, 1)).toBe(0.8);
  });

  it("rivalry 0.5 is the identity for the off-diagonal", () => {
    expect(smellWeight(-1.1, 0, 1, 0.5)).toBeCloseTo(-1.1, 10);
    expect(smellWeight(0.7, 2, 3, 0.5)).toBeCloseTo(0.7, 10);
  });

  it("rivalry 0 zeroes the off-diagonal", () => {
    // toBeCloseTo, not toBe: -1.1 * 0 * 2 is -0 in IEEE 754, and Object.is
    // (toBe's equality) tells -0 and 0 apart even though they're == and
    // behave identically everywhere this value is actually used.
    expect(smellWeight(-1.1, 0, 1, 0)).toBeCloseTo(0, 10);
    expect(smellWeight(0.7, 2, 3, 0)).toBeCloseTo(0, 10);
  });
});

describe("wordBand", () => {
  const edges = PAIR_WORDS.layers.smell.bandEdges;
  it("matches the prototype's landmark bands, farther-from-zero on an edge", () => {
    expect(wordBand(-0.9, edges)).toBe(0);
    expect(wordBand(-0.3, edges)).toBe(1);
    expect(wordBand(0, edges)).toBe(2);
    expect(wordBand(0.29, edges)).toBe(2);
    expect(wordBand(-0.29, edges)).toBe(2);
    expect(wordBand(0.3, edges)).toBe(3);
    expect(wordBand(0.85, edges)).toBe(4);
  });
});

describe("pairZone / pairRelation", () => {
  const layers: PairLayer[] = ["smell", "touch"];
  it("all 9 zones give the prototype names for both layers", () => {
    for (const ly of layers) {
      const words = PAIR_WORDS.layers[ly];
      const rel = words.relations!;
      // both positive -> "both" corner (grid[2][2])
      expect(pairRelation(words, 1, 1)).toBe(rel.grid[2]![2]);
      // both negative -> "against" corner (grid[0][0])
      expect(pairRelation(words, -1, -1)).toBe(rel.grid[0]![0]);
      // mixed corners
      expect(pairRelation(words, 1, -1)).toBe(rel.grid[2]![0]);
      expect(pairRelation(words, -1, 1)).toBe(rel.grid[0]![2]);
      // plus/minus edges
      expect(pairRelation(words, 1, 0)).toBe(rel.grid[2]![1]);
      expect(pairRelation(words, -1, 0)).toBe(rel.grid[0]![1]);
      expect(pairRelation(words, 0, 1)).toBe(rel.grid[1]![2]);
      expect(pairRelation(words, 0, -1)).toBe(rel.grid[1]![0]);
      // neither
      expect(pairRelation(words, 0, 0)).toBe(rel.grid[1]![1]);
    }
  });

  it("pairZone is strict on the edge itself", () => {
    expect(pairZone(0.3, 0.3)).toBe(0);
    expect(pairZone(0.31, 0.3)).toBe(1);
    expect(pairZone(-0.3, 0.3)).toBe(0);
    expect(pairZone(-0.31, 0.3)).toBe(-1);
  });

  it("returns undefined when a layer has no relations", () => {
    expect(pairRelation({ ...PAIR_WORDS.layers.smell, relations: undefined }, 1, 1)).toBeUndefined();
  });
});

describe("fillTemplate", () => {
  it('splits "{A} → {B}" into strain/text/strain tokens', () => {
    expect(fillTemplate("{A} → {B}", 0, 1)).toEqual([{ strain: 0 }, { text: " → " }, { strain: 1 }]);
  });

  it("resolves a named var and leaves an unknown token literal", () => {
    expect(fillTemplate("{word} {B}", 2, 3, { word: "avoids" })).toEqual([{ text: "avoids" }, { text: " " }, { strain: 3 }]);
    expect(fillTemplate("{nope} {A}", 0, 1)).toEqual([{ text: "{nope}" }, { text: " " }, { strain: 0 }]);
  });

  it("a template with no tokens is one literal chunk", () => {
    expect(fillTemplate("Strangers", 0, 1)).toEqual([{ text: "Strangers" }]);
  });
});

describe("fmtSigned", () => {
  it("uses a real minus sign and always shows a sign", () => {
    expect(fmtSigned(0.6)).toBe("+0.60");
    expect(fmtSigned(-1.2)).toBe("−1.20");
    expect(fmtSigned(0)).toBe("+0.00");
  });
});

describe("padPos / padValue", () => {
  it("round-trips through pad-square percentage", () => {
    for (const v of [-1.5, -0.6, 0, 0.6, 1.5]) {
      expect(padValue(padPos(v))).toBeCloseTo(v, 10);
    }
  });

  it("clamps a percentage outside the drawn range", () => {
    expect(padValue(0)).toBeCloseTo(-1.5, 5); // (0-50)/42 ~= -1.19 -> clamped to the edge
    expect(padValue(100)).toBeCloseTo(1.5, 5);
    expect(padValue(-1000)).toBe(-1.5);
    expect(padValue(1000)).toBe(1.5);
  });

  it("is flat around the zero line and still reaches the ends", () => {
    const near = padValue(50 + 42 * 0.1); // a tenth of the way out
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(0.1 * 1.5 * 0.5); // well under the straight line's value
    expect(padValue(50 - 42 * 0.1)).toBeCloseTo(-near, 10);
    expect(padValue(92)).toBeCloseTo(1.5, 10);
    expect(padValue(8)).toBeCloseTo(-1.5, 10);
  });

  it("only ever grows left to right", () => {
    let prev = -Infinity;
    for (let pct = 0; pct <= 100; pct += 0.5) {
      const v = padValue(pct);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("pairsOf", () => {
  it("gives the six unordered pairs over 0..3, ascending", () => {
    expect(pairsOf(4)).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
  });
});

describe("tablesMatch", () => {
  it("true within epsilon, false past it", () => {
    const a = [
      [1, 2],
      [3, 4],
    ];
    const b = [
      [1.005, 2],
      [3, 4],
    ];
    const c = [
      [1.02, 2],
      [3, 4],
    ];
    expect(tablesMatch(a, b)).toBe(true);
    expect(tablesMatch(a, c)).toBe(false);
  });
});

describe("PAIR_WORDS vocabulary shape", () => {
  it("5 ascending bands per layer, 4 ascending edges", () => {
    for (const ly of ["smell", "touch"] as const) {
      const words = PAIR_WORDS.layers[ly];
      expect(words.bands.length).toBe(5);
      for (let i = 1; i < words.bands.length; i++) expect(words.bands[i]!.at).toBeGreaterThan(words.bands[i - 1]!.at);
      for (let i = 1; i < words.bandEdges.length; i++) expect(words.bandEdges[i]).toBeGreaterThan(words.bandEdges[i - 1]!);
    }
  });

  it("every relations grid is 3x3 and non-empty", () => {
    for (const ly of ["smell", "touch"] as const) {
      const grid = PAIR_WORDS.layers[ly].relations!.grid;
      expect(grid.length).toBe(3);
      for (const row of grid) {
        expect(row.length).toBe(3);
        for (const cell of row) expect(cell.length).toBeGreaterThan(0);
      }
    }
  });

  it("showRelations defaults off", () => {
    expect(PAIR_WORDS.showRelations).toBe(false);
  });
});

describe("AFFINITY_PRESETS", () => {
  it("every smell table is 4x4 and every touch diagonal is 0", () => {
    for (const preset of AFFINITY_PRESETS) {
      expect(preset.smell.length).toBe(4);
      for (const row of preset.smell) expect(row.length).toBe(4);
      expect(preset.touch.length).toBe(4);
      for (let i = 0; i < 4; i++) {
        expect(preset.touch[i]!.length).toBe(4);
        expect(preset.touch[i]![i]).toBe(0);
      }
    }
  });

  it("Rivals' smell equals ATTRACT_ROWS", () => {
    const rivals = AFFINITY_PRESETS.find((p) => p.name === "Rivals")!;
    expect(rivals.smell).toEqual(ATTRACT_ROWS);
    expect(rivals.touchy).toBe(false);
  });

  it("non-touchy presets have all-zero touch", () => {
    for (const preset of AFFINITY_PRESETS.filter((p) => !p.touchy)) {
      for (const row of preset.touch) for (const v of row) expect(v).toBe(0);
    }
  });

  it("Hunt/Gardens/War are touchy with the documented touch tables", () => {
    const hunt = AFFINITY_PRESETS.find((p) => p.name === "Hunt")!;
    const gardens = AFFINITY_PRESETS.find((p) => p.name === "Gardens")!;
    const war = AFFINITY_PRESETS.find((p) => p.name === "War")!;
    expect(hunt.touchy).toBe(true);
    expect(gardens.touchy).toBe(true);
    expect(war.touchy).toBe(true);
    expect(hunt.touch[0]![1]).toBe(-1.2);
    expect(hunt.touch[1]![2]).toBe(-1.2);
    expect(hunt.touch[2]![3]).toBe(-1.2);
    expect(hunt.touch[3]![0]).toBe(-1.2);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (i === j) continue;
        expect(gardens.touch[i]![j]).toBe(0.6);
        expect(war.touch[i]![j]).toBe(-0.9);
      }
    }
  });
});

// ---------------------------------------------------------------------
// Phase 3: Random / Nudge / Back's pure logic.
// ---------------------------------------------------------------------

const SAMPLE_TABLE = [
  [1, -0.5, 0, 0.3],
  [-0.5, 1, -0.5, 0],
  [0, -0.5, 1, -0.5],
  [0.3, 0, -0.5, 1],
];

function onQuantumGrid(v: number): boolean {
  return Math.abs(v / AFFINITY_QUANTUM - Math.round(v / AFFINITY_QUANTUM)) < 1e-9;
}

describe("quantize", () => {
  it("snaps to the nearest AFFINITY_QUANTUM", () => {
    expect(quantize(0.074)).toBeCloseTo(0.05, 10);
    expect(quantize(0.076)).toBeCloseTo(0.1, 10);
    expect(quantize(-0.024)).toBeCloseTo(0, 10);
  });
});

describe("randomSmell", () => {
  it("every value lies in the AFFINITY range and on the 0.05 grid", () => {
    const rnd = mulberry32(1);
    const out = randomSmell(SAMPLE_TABLE, false, rnd);
    for (const row of out) {
      for (const v of row) {
        expect(v).toBeGreaterThanOrEqual(AFFINITY_MIN);
        expect(v).toBeLessThanOrEqual(AFFINITY_MAX);
        expect(onQuantumGrid(v)).toBe(true);
      }
    }
  });

  it("the diagonal lies in OWN_TRAIL_RANDOM when not kept", () => {
    const rnd = mulberry32(2);
    const out = randomSmell(SAMPLE_TABLE, false, rnd);
    for (let i = 0; i < 4; i++) {
      expect(out[i]![i]).toBeGreaterThanOrEqual(OWN_TRAIL_RANDOM[0]);
      expect(out[i]![i]).toBeLessThanOrEqual(OWN_TRAIL_RANDOM[1]);
    }
  });

  it("keepOwn preserves the diagonal exactly", () => {
    const rnd = mulberry32(3);
    const out = randomSmell(SAMPLE_TABLE, true, rnd);
    for (let i = 0; i < 4; i++) expect(out[i]![i]).toBe(SAMPLE_TABLE[i]![i]);
  });

  it("over 200 rolls, both signs appear off-diagonal", () => {
    const rnd = mulberry32(4);
    let sawPos = false;
    let sawNeg = false;
    for (let n = 0; n < 200; n++) {
      const out = randomSmell(SAMPLE_TABLE, false, rnd);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          if (i === j) continue;
          if (out[i]![j]! > 0) sawPos = true;
          if (out[i]![j]! < 0) sawNeg = true;
        }
      }
    }
    expect(sawPos).toBe(true);
    expect(sawNeg).toBe(true);
  });
});

describe("randomTouch", () => {
  it("the diagonal is always 0", () => {
    const rnd = mulberry32(5);
    for (let n = 0; n < 20; n++) {
      const out = randomTouch(4, rnd);
      for (let i = 0; i < 4; i++) expect(out[i]![i]).toBe(0);
    }
  });

  it("every off-diagonal value lies in range and on the 0.05 grid", () => {
    const rnd = mulberry32(7);
    for (let n = 0; n < 20; n++) {
      const out = randomTouch(4, rnd);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          if (i === j) continue;
          expect(out[i]![j]!).toBeGreaterThanOrEqual(AFFINITY_MIN);
          expect(out[i]![j]!).toBeLessThanOrEqual(AFFINITY_MAX);
          expect(onQuantumGrid(out[i]![j]!)).toBe(true);
        }
      }
    }
  });

  it("over 1000 rolls the off-diagonal zero share falls in [0.30, 0.42]", () => {
    const rnd = mulberry32(6);
    let zero = 0;
    let total = 0;
    for (let n = 0; n < 1000; n++) {
      const out = randomTouch(4, rnd);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          if (i === j) continue;
          total++;
          if (out[i]![j] === 0) zero++;
        }
      }
    }
    const share = zero / total;
    expect(share).toBeGreaterThanOrEqual(0.3);
    expect(share).toBeLessThanOrEqual(0.42);
  });
});

describe("nudgeTable", () => {
  it("|delta| stays within NUDGE_MAX plus quantisation", () => {
    const rnd = mulberry32(8);
    for (let n = 0; n < 50; n++) {
      const out = nudgeTable(SAMPLE_TABLE, "smell", false, rnd);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          expect(Math.abs(out[i]![j]! - SAMPLE_TABLE[i]![j]!)).toBeLessThanOrEqual(NUDGE_MAX + AFFINITY_QUANTUM / 2 + 1e-9);
        }
      }
    }
  });

  it("results stay clamped to the AFFINITY range and on the 0.05 grid, even from the edge", () => {
    const edge = [
      [AFFINITY_MAX, AFFINITY_MIN, 0, 0],
      [0, AFFINITY_MAX, 0, 0],
      [0, 0, AFFINITY_MIN, 0],
      [0, 0, 0, AFFINITY_MAX],
    ];
    const rnd = mulberry32(9);
    for (let n = 0; n < 50; n++) {
      const out = nudgeTable(edge, "smell", false, rnd);
      for (const row of out) {
        for (const v of row) {
          expect(v).toBeGreaterThanOrEqual(AFFINITY_MIN);
          expect(v).toBeLessThanOrEqual(AFFINITY_MAX);
          expect(onQuantumGrid(v)).toBe(true);
        }
      }
    }
  });

  it("the diagonal is untouched on Touch, and on Smell when keepOwn", () => {
    const rnd = mulberry32(10);
    const outTouch = nudgeTable(SAMPLE_TABLE, "touch", false, rnd);
    for (let i = 0; i < 4; i++) expect(outTouch[i]![i]).toBe(SAMPLE_TABLE[i]![i]);
    const outKeepOwn = nudgeTable(SAMPLE_TABLE, "smell", true, rnd);
    for (let i = 0; i < 4; i++) expect(outKeepOwn[i]![i]).toBe(SAMPLE_TABLE[i]![i]);
  });

  it("the diagonal does still move on Smell when keepOwn is false", () => {
    const rnd = mulberry32(11);
    let moved = false;
    for (let n = 0; n < 50 && !moved; n++) {
      const out = nudgeTable(SAMPLE_TABLE, "smell", false, rnd);
      for (let i = 0; i < 4; i++) if (out[i]![i] !== SAMPLE_TABLE[i]![i]) moved = true;
    }
    expect(moved).toBe(true);
  });
});

describe("pushHistory / popHistory", () => {
  const item = (n: number): AffinityTables => ({ smell: [[n]], touch: [[0]] });

  it("push caps the stack at MIX_HISTORY_MAX, dropping the oldest first", () => {
    let stack: AffinityTables[] = [];
    for (let i = 0; i < MIX_HISTORY_MAX + 5; i++) stack = pushHistory(stack, item(i));
    expect(stack.length).toBe(MIX_HISTORY_MAX);
    expect(stack[0]).toEqual(item(5));
    expect(stack[stack.length - 1]).toEqual(item(MIX_HISTORY_MAX + 4));
  });

  it("push never mutates its input array", () => {
    const stack: AffinityTables[] = [item(1)];
    const next = pushHistory(stack, item(2));
    expect(stack.length).toBe(1);
    expect(next.length).toBe(2);
  });

  it("a custom max caps push at that value", () => {
    let stack: AffinityTables[] = [];
    for (let i = 0; i < 5; i++) stack = pushHistory(stack, item(i), 3);
    expect(stack).toEqual([item(2), item(3), item(4)]);
  });

  it("pop returns the last item and the rest as a new array, leaving the input untouched", () => {
    const stack = [item(1), item(2), item(3)];
    const [rest, popped] = popHistory(stack);
    expect(popped).toEqual(item(3));
    expect(rest).toEqual([item(1), item(2)]);
    expect(stack.length).toBe(3);
  });

  it("pop on an empty stack returns undefined and an empty array", () => {
    const [rest, popped] = popHistory([]);
    expect(popped).toBeUndefined();
    expect(rest).toEqual([]);
  });
});
