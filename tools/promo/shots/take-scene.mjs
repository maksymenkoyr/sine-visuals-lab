// The scene takes (`intro`, `song_*`): a scene on the song, filmed for the whole span of the video.
// Run by `capture.mjs --take NAME --work DIR` (shot contract: ctx in, {casts, gate} out; see its header);
// record.mjs once() with music, as data: the scene, the look rule and the palette flips come from the
// take's entry in tools/promo/takes.json. The fake microphone plays the song from the mic span's start,
// so script beats count from there (rec.mic.pre beats before video beat 0), and meta.songT0 is the song
// time at the span's first video beat. Page helpers: shots/lib/app.mjs.
import { open, beatClock, sleep, clickText, every, FB_SETUP, BPM, P } from "./lib/app.mjs";

export default async function (ctx) {
  const { page, entry, rec, name } = ctx;
  const look = rec.look ? new URL(rec.look) : null;
  const lookScene = look && decodeURIComponent((look.hash.match(/\/v\/([^/?]+)/) || [])[1] || "");
  let scene = entry.scene;
  if (entry.lookScene) {
    if (!look) console.log(`${name}: no look in record.json: a stand-in Physarum 2 opening`);
    scene = lookScene || "physarum2";
  }
  const withLook = look && (entry.look === "always" || (entry.look === "ifScene" && lookScene === scene));
  const query = withLook ? `&look=${look.searchParams.get("look")}` : "";
  const flips = entry.flips ? every(entry.flips.every, entry.flips.names, rec.mic.drop) : [];

  await open(page, scene, { query, music: true });
  await FB_SETUP(page);
  await sleep(500);
  const bc = await beatClock(page, 1800, { at: rec.mic.lead });
  await ctx.startCast(page, name);
  for (const [b, n] of flips) { await bc.waitBeat(b + rec.mic.pre); await clickText(page, n); }
  await bc.waitBeat(rec.mic.span + 0.6);
  const meta = {
    name, scene, beats: rec.mic.span, P, bpm: BPM, epochT0: bc.epochT0, view: ctx.view,
    songT0: rec.mic.songT0 + rec.mic.lead * P / 1000, lagMs: ctx.lagMs,
  };
  return { casts: { [name]: meta }, gate: { t0: bc.epochT0, beats: rec.mic.span } };
}
