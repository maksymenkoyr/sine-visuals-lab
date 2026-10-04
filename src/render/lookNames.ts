/**
 * Names for a Look saved with one click (the Looks card's "Save look" chip).
 * Nobody types a name up front any more, so the look gets a silly one
 * instead of "Look 7": a mood out of `MOODS` pinned on a piece of club gear
 * out of `GEAR`, e.g. "Judgmental Cowbell". A daft name is easier to tell
 * apart and remember in a list than a number, and the visitor can rename it
 * with a double-click whenever a real name comes to mind.
 *
 * Pure — no store, no DOM. The caller passes the names this scene already
 * has, and funnyLookName returns one that isn't among them: it tries random
 * pairs first, and once those keep colliding (a scene hoarding looks) falls
 * back to the first free "name (2)", "name (3)", … — the same suffix
 * sceneLooks.ts's saveSharedLook uses for a clashing shared name.
 */

const MOODS = [
  "Overcaffeinated", "Suspicious", "Emotional", "Retired", "Haunted", "Sleepy",
  "Smug", "Unbothered", "Dramatic", "Philosophical", "Sweaty", "Feral",
  "Bashful", "Grumpy", "Polite", "Unlicensed", "Lukewarm", "Existential",
  "Clingy", "Petty", "Wobbly", "Confused", "Tipsy", "Sarcastic",
  "Melancholy", "Spicy", "Jittery", "Judgmental", "Nostalgic", "Overdressed",
  "Underpaid", "Self-Aware", "Hungover", "Gossiping", "Sentimental",
  "Disco-Curious", "Unreasonable", "Off-Brand", "Chaotic", "Bewildered",
  "Lovesick", "Paranoid", "Sleep-Deprived", "Theatrical", "Passive-Aggressive",
  "Recently Promoted", "Mildly Cursed", "Tax-Deductible", "Gluten-Free",
  "Emotionally Available",
];

const GEAR = [
  "Fog Machine", "Disco Ball", "Subwoofer", "Strobe", "Lava Lamp", "Glowstick",
  "Bassline", "Hi-Hat", "Laser", "Kick Drum", "Oscillator", "Pixel",
  "Spotlight", "Mixtape", "Turntable", "Crowd Surfer", "Bouncer", "Afterparty",
  "Encore", "Coat Check", "Smoke Alarm", "Waveform", "Echo", "Dancefloor",
  "Headliner", "Roadie", "Soundcheck", "DJ Booth", "Glitter Cannon",
  "Neon Sign", "Cowbell", "Tambourine", "Theremin", "Metronome", "Tweeter",
  "Feedback Loop", "Remix", "B-Side", "Night Owl", "Hologram", "Shader",
  "Moonwalk", "Tape Loop", "Drop", "Light Rig", "Rave Uncle", "Bucket Hat",
  "Earplug", "Setlist", "Smoke Break",
];

/** Random pairs tried before giving up and numbering one. */
const RANDOM_TRIES = 24;

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/** A funny name not in `taken`. `random` is injectable for tests. */
export function funnyLookName(taken: readonly string[], random: () => number = Math.random): string {
  const used = new Set(taken);
  let name = "";
  for (let i = 0; i < RANDOM_TRIES; i++) {
    name = `${pick(MOODS, random)} ${pick(GEAR, random)}`;
    if (!used.has(name)) return name;
  }
  let numbered = name;
  for (let n = 2; used.has(numbered); n++) numbered = `${name} (${n})`;
  return numbered;
}
