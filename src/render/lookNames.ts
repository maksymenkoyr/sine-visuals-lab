/**
 * Names for a Look saved with one click (the Looks card's "Save look" chip).
 * Nobody types a name up front any more, so the look gets a short, stupid,
 * faintly postmodern one instead of "Look 7": a form out of `FORMS` wrapped
 * around one dumb word out of `THINGS` — "Untitled (Soup)", "Post-Toast",
 * "Ham Discourse" — or, now and then, a form with no slot that is a whole
 * name by itself ("Look (Derogatory)"). In a form, `%` takes the word as is
 * and `~` takes it lowercased, for the file-name jokes. A daft name is easier
 * to tell apart in a list than a number, and the visitor can rename it with
 * a double-click whenever a real name comes to mind.
 *
 * Pure — no store, no DOM. The caller passes the names this scene already
 * has, and funnyLookName returns one that isn't among them: it tries random
 * picks first, and once those keep colliding (a scene hoarding looks) falls
 * back to the first free "name (2)", "name (3)", … — the same suffix
 * sceneLooks.ts's saveSharedLook uses for a clashing shared name.
 */

const FORMS = [
  "Untitled (%)", "Post-%", "Neo-%", "Meta-%", "Not %", "%?", "% Again",
  "%, Ironically", "% (Remix)", "% (Live)", "Diet %", "Late %", "Lo-Fi %",
  "% Discourse", "%-Adjacent", "~core", "~_final_v2", "~.png",
  "Look (Derogatory)", "A Look", "This One", "The Other One", "Content",
  "Vibes Pending", "Same But Louder", "Okay", "Art?", "final_FINAL",
];

const THINGS = [
  "Soup", "Ham", "Toast", "Sock", "Egg", "Goo", "Fog", "Void", "Blob",
  "Lamp", "Duck", "Bean", "Gum", "Dust", "Spoon", "Chair", "Beige", "Mood",
  "Vibe", "Bass", "Loop", "Fizz", "Blur", "Static", "Tuesday", "Disco",
  "Glitter", "Jelly", "Moon", "Nothing", "Rave", "Noise",
];

/** Random picks tried before giving up and numbering one. */
const RANDOM_TRIES = 24;

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/** A funny name not in `taken`. `random` is injectable for tests. */
export function funnyLookName(taken: readonly string[], random: () => number = Math.random): string {
  const used = new Set(taken);
  let name = "";
  for (let i = 0; i < RANDOM_TRIES; i++) {
    const thing = pick(THINGS, random);
    name = pick(FORMS, random).replace("%", thing).replace("~", thing.toLowerCase());
    if (!used.has(name)) return name;
  }
  let numbered = name;
  for (let n = 2; used.has(numbered); n++) numbered = `${name} (${n})`;
  return numbered;
}
