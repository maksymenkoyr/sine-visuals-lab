// Time Mandelbox Flight's place search per seed and Mirror option (CPU cost of finding one place).
// usage: node docs/scenes/mandelbox/scripts/search-bench.mjs

const m = await import("../../../../src/render/scenes/mandelbox/flight.ts");
const scale = m.foldScale(0.6);
for (const mirror of [0, 1, 2]) {
  const times = [];
  const kinds = {};
  for (let seed = 1; seed <= 12; seed++) {
    const t0 = performance.now();
    const s = m.createPlaceSearch(scale, seed, mirror);
    const place = m.stepPlaceSearch(s, Number.POSITIVE_INFINITY);
    times.push(performance.now() - t0);
    kinds[place.kind] = (kinds[place.kind] ?? 0) + 1;
  }
  times.sort((a, b) => a - b);
  console.log(`mirror ${mirror}: ms per place median ${times[6].toFixed(0)}, max ${times[11].toFixed(0)}; kinds ${JSON.stringify(kinds)}`);
}
