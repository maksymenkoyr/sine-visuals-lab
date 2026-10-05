/**
 * Names for a Look saved with one click (the Looks card's "Save look" chip).
 * Nobody types a name up front any more, so the look gets a short brain-rot
 * one instead of "Look 7". No meme is quoted whole: the names borrow the
 * internet's grammar and fill it with our own dumb nouns and the alien
 * words in `ALIEN` (the right-hand column of an "alien language" cat meme
 * the user picked), three ways —
 *
 * - a slang form out of `FORMS` wrapped around one word, from `THINGS` or
 *   `ALIEN` ("Toaster Arc", "Average Zibzidi Enjoyer", "Chat Is Fog Real").
 *   In a form, `%` takes the word as is and `~` takes it lowercased;
 * - `CHANT_SHARE` of the time, a chant of a few `ALIEN` words ("Zeb Zab
 *   Zib", "Bleb Bleb");
 * - `CREATURE_SHARE` of the time, a made-up pseudo-Italian creature: two
 *   `STEMS`, each given one of the `ENDINGS` ("Blebardo Fogucci").
 *
 * A daft name is easier to tell apart in a list than a number, and the
 * visitor can rename it with a double-click whenever a real name comes to
 * mind.
 *
 * Pure — no store, no DOM. The caller passes the names this scene already
 * has, and funnyLookName returns one that isn't among them: it tries random
 * picks first, and once those keep colliding (a scene hoarding looks) falls
 * back to the first free "name (2)", "name (3)", … — the same suffix
 * sceneLooks.ts's saveSharedLook uses for a clashing shared name.
 */

const FORMS = [
  "% Arc", "% Era", "% Lore", "~maxxing", "%-Pilled", "It's Giving %",
  "% Goes Hard", "% Is Cooked", "Chat Is % Real", "% Final Boss",
  "Lowkey %", "Delulu %", "NPC %", "% Speedrun", "Certified % Moment",
  "% Rizz", "Sigma %", "Me When %", "% Jumpscare", "% Simulator",
  "The % Is Him", "Average % Enjoyer", "Deep Fried %", "% Ascended",
  "%, Unfortunately", "% (Gone Wrong)", "% at 3am", "%: +1000 Aura",
  "% (Derogatory)", "Not The %",
];

const THINGS = [
  "Toaster", "Fog", "Strobe", "Sub", "Lamp", "Goose", "Shrimp", "Spoon",
  "Fridge", "Pigeon", "Bean", "Sock", "Beige", "Crab", "Ham", "Kick",
  "Bass", "Moon", "Pixel", "Disco", "Lasagna", "Raccoon", "Cereal", "Frog",
  "Gravy", "Noodle", "Printer", "Glorp", "Zorb",
];

const ALIEN = [
  "Zab", "Zup", "Zap", "Zibzidi", "Zub", "Zib", "Bleb", "Zeb", "Vip", "Vop",
  "Blab", "Zob", "Zep",
];

const STEMS = [
  "Strob", "Bass", "Fog", "Pix", "Glitt", "Disc", "Toast", "Spoon", "Wob",
  "Bonk", "Woof", "Lamp", "Shrimp", "Frog", "Glorp", "Zorb",
  "Zab", "Zib", "Bleb", "Vip", "Zob", "Blab",
];

const ENDINGS = ["ino", "ello", "oni", "ardo", "etta", "ucci", "ini", "ola", "otto", "eroni"];

/** How often a name is an alien chant, and how often a pseudo-Italian
 *  creature; the rest are slang forms. */
const CHANT_SHARE = 0.25;
const CREATURE_SHARE = 0.25;
/** Most words a chant strings together. */
const CHANT_MAX_WORDS = 3;

/** Random picks tried before giving up and numbering one. */
const RANDOM_TRIES = 24;

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

function slang(random: () => number): string {
  const thing = pick(random() < 0.5 ? THINGS : ALIEN, random);
  return pick(FORMS, random).replace("%", thing).replace("~", thing.toLowerCase());
}

function chant(random: () => number): string {
  const count = 2 + Math.floor(random() * (CHANT_MAX_WORDS - 1));
  return Array.from({ length: count }, () => pick(ALIEN, random)).join(" ");
}

function creature(random: () => number): string {
  const half = () => pick(STEMS, random) + pick(ENDINGS, random);
  return `${half()} ${half()}`;
}

/** A funny name not in `taken`. `random` is injectable for tests. */
export function funnyLookName(taken: readonly string[], random: () => number = Math.random): string {
  const used = new Set(taken);
  let name = "";
  for (let i = 0; i < RANDOM_TRIES; i++) {
    const kind = random();
    name = kind < CHANT_SHARE ? chant(random) : kind < CHANT_SHARE + CREATURE_SHARE ? creature(random) : slang(random);
    if (!used.has(name)) return name;
  }
  let numbered = name;
  for (let n = 2; used.has(numbered); n++) numbered = `${name} (${n})`;
  return numbered;
}
