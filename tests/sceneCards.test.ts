// Guards the card/body split (src/render/lazyScene.ts): a static import of a
// scene's body, from an entry page or from any card, puts the whole scene back
// in the page's first-load JS, which is what the split exists to avoid. The
// check reads files, not the bundle, so it fails the moment the import is
// written. Dynamic `import()` is the one allowed edge: it is how a card names
// its body.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bodyPathOfCard } from "../src/render/scenes/sceneModules.ts";
import { SCENES_DIR, fileClosure } from "../tools/sceneVersionLib.mjs";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);

function cardFiles(): string[] {
  const out: string[] = [];
  for (const name of readdirSync(SCENES_DIR)) {
    if (name.endsWith(".card.ts")) out.push(`${SCENES_DIR}/${name}`);
    else if (!name.includes(".") && existsSync(`${SCENES_DIR}/${name}/card.ts`)) out.push(`${SCENES_DIR}/${name}/card.ts`);
  }
  return out.sort();
}

describe("scene cards", () => {
  const cards = cardFiles();
  const bodies = cards.map((c) => bodyPathOfCard(c));

  it("find a body next to every card", () => {
    expect(cards.length).toBeGreaterThan(0);
    for (const body of bodies) expect(existsSync(body), body).toBe(true);
  });

  it("are never statically followed to a body from an entry page", () => {
    for (const entry of ["src/app.ts", "src/tv.ts", "src/output.ts"]) {
      const closure = fileClosure([entry], read, existsSync, { staticOnly: true });
      for (const body of bodies) expect(closure.has(body), `${entry} reaches ${body}`).toBe(false);
    }
  });

  it("never import a body, their own or another's, statically", () => {
    for (const card of cards) {
      const closure = fileClosure([card], read, existsSync, { staticOnly: true });
      for (const body of bodies) expect(closure.has(body), `${card} reaches ${body}`).toBe(false);
    }
  });
});
