import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAID_SCENE_IDS, SCENE_UNITS } from "../src/render/scenes/index.ts";
import {
  collectScenePages,
  DESCRIPTION_MAX,
  NEIGHBOURS,
  neighboursOf,
  parseScenePage,
  pickMedia,
  renderSceneNav,
  renderScenePage,
  renderSitemap,
  SITE,
} from "../tools/scenePagesLib.mjs";

const record = (page: string, heading = "# Caustics (`caustics`)") => `${heading}\n\nFor developers.\n\n${page}## Where the code is\n\nstuff\n`;
const MEDIA = { still: "still-2026-10-21.jpg", loop: "loop-2026-10-21.mp4", date: "2026-10-21" };

describe("parseScenePage", () => {
  it("reads the name and id from the heading and the Page section's paragraphs", () => {
    const parsed = parseScenePage(record("## Page\n\nLead line.\n\nSecond\nparagraph, wrapped.\n\n"));
    expect(parsed).toEqual({ id: "caustics", name: "Caustics", paragraphs: ["Lead line.", "Second paragraph, wrapped."] });
  });

  it("is null without a Page section, or with only the template's placeholder", () => {
    expect(parseScenePage(record(""))).toBeNull();
    expect(parseScenePage(record("## Page\n\n<Optional: the copy…>\n\n"))).toBeNull();
  });

  it("refuses a lead too long for a search snippet", () => {
    const parsed = parseScenePage(record(`## Page\n\n${"x".repeat(DESCRIPTION_MAX + 1)}\n\n`));
    expect(parsed).toHaveProperty("error");
  });
});

describe("pickMedia", () => {
  it("takes the newest still and loop and ignores other files", () => {
    expect(pickMedia(["still-2026-10-01.jpg", "loop-2026-10-01.mp4", "still-2026-10-21.jpg", "loop-2026-10-02.mp4", "still-2026-10-30.mp4", "notes.txt"])).toEqual({
      still: "still-2026-10-21.jpg",
      loop: "loop-2026-10-02.mp4",
      date: "2026-10-21",
    });
  });

  it("is null when either is missing", () => {
    expect(pickMedia(["still-2026-10-21.jpg"])).toBeNull();
  });
});

describe("collectScenePages", () => {
  it("orders pages by name and reports a record without media or under another name", () => {
    const page = "## Page\n\nLead.\n\n";
    const { pages, errors } = collectScenePages(
      [
        { file: "chladni.md", text: record(page, "# Chladni (`chladni`)") },
        { file: "caustics.md", text: record(page) },
        { file: "sky.md", text: record(page, "# Sky (`sky`)") },
        { file: "kaleido.md", text: record(page, "# Kaleidoscope (`kaleidoscope`)") },
      ],
      (id) => (id === "sky" ? [] : [MEDIA.still, MEDIA.loop]),
    );
    expect(pages.map((p) => p.id)).toEqual(["caustics", "chladni"]);
    expect(errors).toHaveLength(2);
  });
});

describe("neighboursOf", () => {
  it("takes the pages after this one, wrapping, never itself", () => {
    expect(neighboursOf(["a", "b", "c"], 1)).toEqual(["c", "a"]);
    expect(neighboursOf(Array.from({ length: NEIGHBOURS + 3 }, (_, i) => i), 0)).toHaveLength(NEIGHBOURS);
  });
});

describe("renderScenePage", () => {
  const page = { id: "caustics", name: "Caustics", paragraphs: ["Light <on> a pool & more.", "Second."], media: MEDIA };
  const html = renderScenePage(page, [{ id: "chladni", name: "Chladni", media: MEDIA }]);

  it("is canonical at /scenes/<id>/ and opens the app on the scene", () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE}/scenes/caustics/">`);
    expect(html).toContain('href="/#/v/caustics"');
    expect(html).toContain('href="/scenes/chladni/"');
  });

  it("escapes the copy and keeps the JSON-LD parseable", () => {
    expect(html).toContain("Light &lt;on&gt; a pool &amp; more.");
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    expect(JSON.parse(ld?.[1] ?? "")["@graph"]).toHaveLength(3);
  });

  it("loads no script beyond its JSON-LD", () => {
    expect(html.match(/<script/g)).toHaveLength(1);
  });
});

describe("renderSitemap and renderSceneNav", () => {
  it("list the home page and every scene page", () => {
    const xml = renderSitemap([{ id: "caustics", media: MEDIA }]);
    expect(xml).toContain(`<loc>${SITE}/</loc>`);
    expect(xml).toContain(`<loc>${SITE}/scenes/caustics/</loc>`);
    expect(renderSceneNav([{ id: "caustics", name: "Caustics" }])).toContain('<a href="/scenes/caustics/">Caustics</a>');
    expect(renderSceneNav([])).toBe("");
  });
});

describe("this repo's scene pages", () => {
  const records = readdirSync("docs/scenes")
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .map((file) => ({ file, text: readFileSync(`docs/scenes/${file}`, "utf8") }));
  const { pages, errors } = collectScenePages(records, (id) => (existsSync(`public/scenes/${id}`) ? readdirSync(`public/scenes/${id}`) : []));

  it("have their copy and media in order", () => {
    expect(errors).toEqual([]);
  });

  it("are all free scenes", () => {
    const free = new Set([...SCENE_UNITS.values()].map((s) => s.id));
    for (const p of pages) {
      expect(free.has(p.id), p.id).toBe(true);
      expect(PAID_SCENE_IDS.has(p.id), p.id).toBe(false);
    }
  });
});
