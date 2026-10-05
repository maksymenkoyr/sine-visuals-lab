/**
 * Names for a Look saved with one click (the Looks card's "Save look" chip).
 * Nobody types a name up front any more, so the look gets a short brain-rot
 * one instead of "Look 7". Every name is built from a chant: a few of the
 * alien words in `ALIEN` (the right-hand column of an "alien language" cat
 * meme the user picked), e.g. "Zeb Zab Zib". A name is one of three things —
 *
 * - the chant itself, up to `CHANT_MAX_WORDS` words long;
 * - `SLANG_SHARE` of the time, a slang form out of `FORMS` wrapped around a
 *   chant of `INNER_CHANT_WORDS` ("Average Zib Zub Enjoyer", "Zab Zup
 *   Arc"). In a form, `%` takes the chant as is and `~` takes it lowercased
 *   and run together ("zabzupmaxxing");
 * - `CREATURE_SHARE` of the time, a pseudo-Italian creature: a chant of
 *   `INNER_CHANT_WORDS` with every word made Italian — final vowel dropped
 *   or final consonant doubled, then one of the `ENDINGS` ("Zabbardo
 *   Zuppini", "Zibzidotto Blebbetta").
 *
 * No meme is quoted whole: the forms are internet grammar, not anyone's
 * joke. A daft name is easier to tell apart in a list than a number, and the
 * visitor can rename it with a double-click whenever a real name comes to
 * mind.
 *
 * Pure — no store, no DOM. The caller passes the names this scene already
 * has, and funnyLookName returns one that isn't among them: it tries random
 * picks first, and once those keep colliding (a scene hoarding looks) falls
 * back to the first free "name (2)", "name (3)", … — the same suffix
 * sceneLooks.ts's saveSharedLook uses for a clashing shared name.
 */

const ALIEN = [
  "Zab", "Zup", "Zap", "Zibzidi", "Zub", "Zib", "Bleb", "Zeb", "Vip", "Vop",
  "Blab", "Zob", "Zep",
];

const FORMS = [
  "% Arc", "% Era", "% Lore", "~maxxing", "%-Pilled", "It's Giving %",
  "% Goes Hard", "% Is Cooked", "Chat Is % Real", "% Final Boss",
  "Lowkey %", "Delulu %", "NPC %", "% Speedrun", "Certified % Moment",
  "% Rizz", "Sigma %", "Me When %", "% Jumpscare", "% Simulator",
  "The % Is Him", "Average % Enjoyer", "Deep Fried %", "% Ascended",
  "%, Unfortunately", "% (Gone Wrong)", "% at 3am", "%: +1000 Aura",
  "% (Derogatory)", "Not The %",
];

const ENDINGS = ["ino", "ello", "oni", "ardo", "etta", "ucci", "ini", "ola", "otto", "eroni"];

/** How often a name is a slang form, and how often a pseudo-Italian
 *  creature; the rest are bare chants. */
const SLANG_SHARE = 0.4;
const CREATURE_SHARE = 0.3;
/** Most words a bare chant strings together (it has at least two). */
const CHANT_MAX_WORDS = 3;
/** Words in the chant a slang form or a creature is built from. */
const INNER_CHANT_WORDS = 2;

/** Random picks tried before giving up and numbering one. */
const RANDOM_TRIES = 24;

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

function chantWords(count: number, random: () => number): string[] {
  return Array.from({ length: count }, () => pick(ALIEN, random));
}

function chant(random: () => number): string {
  return chantWords(2 + Math.floor(random() * (CHANT_MAX_WORDS - 1)), random).join(" ");
}

function slang(random: () => number): string {
  const words = chantWords(INNER_CHANT_WORDS, random);
  return pick(FORMS, random).replace("%", words.join(" ")).replace("~", words.join("").toLowerCase());
}

function italian(word: string, random: () => number): string {
  const stem = /[aeiou]$/.test(word) ? word.slice(0, -1) : word + word.slice(-1);
  return stem + pick(ENDINGS, random);
}

function creature(random: () => number): string {
  return chantWords(INNER_CHANT_WORDS, random).map((w) => italian(w, random)).join(" ");
}

/** A funny name not in `taken`. `random` is injectable for tests. */
export function funnyLookName(taken: readonly string[], random: () => number = Math.random): string {
  const used = new Set(taken);
  let name = "";
  for (let i = 0; i < RANDOM_TRIES; i++) {
    const kind = random();
    name = kind < SLANG_SHARE ? slang(random) : kind < SLANG_SHARE + CREATURE_SHARE ? creature(random) : chant(random);
    if (!used.has(name)) return name;
  }
  let numbered = name;
  for (let n = 2; used.has(numbered); n++) numbered = `${name} (${n})`;
  return numbered;
}
