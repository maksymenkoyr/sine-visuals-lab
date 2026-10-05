// The scene and look rule of a scene take, in one place: shots/take-scene.mjs opens the page with it and
// capture.mjs's takeUrl() prints it in --print-plan, so the plan shows exactly the URL the take opens.
// It reads no environment, only the take's entry (tools/promo/takes.json) and the record's look link.
// A take's `look` says when the record's look applies: 'always', 'ifScene' (only when the look was made on
// the take's own scene) or never; an entry with `lookScene` takes its scene from the look's own hash, with a
// stand-in Physarum 2 when the record has no look. Returns { scene, query, standIn }: `query` is the
// `&look=<share code>` to append to the page URL ('' when the look does not apply), `standIn` says the
// scene is that stand-in.
export function sceneLook(entry, rec) {
  const look = rec.look ? new URL(rec.look) : null;
  const lookScene = look && decodeURIComponent((look.hash.match(/\/v\/([^/?]+)/) || [])[1] || "");
  let scene = entry.scene;
  let standIn = false;
  if (entry.lookScene) {
    standIn = !look;
    scene = lookScene || "physarum2";
  }
  const withLook = look && (entry.look === "always" || (entry.look === "ifScene" && lookScene === scene));
  const query = withLook ? `&look=${look.searchParams.get("look")}` : "";
  return { scene, query, standIn };
}
