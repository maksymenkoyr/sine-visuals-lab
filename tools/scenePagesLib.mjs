// The public scene pages (issue #595): one static, crawlable page per free
// scene at /scenes/<id>/, so search engines and AI answers have something to
// read and cite besides the gallery's canvas. Pure: no I/O, unit-tested by
// tests/scenePages.test.ts. vite-scene-pages-plugin.ts does the reading and
// emitting around it.
//
// A scene gets a page when two things exist:
//   - a `## Page` section in its record, docs/scenes/<id>.md: the visitor
//     copy (docs/scenes/_template.md says how to write it). The record's own
//     `# Name (\`id\`)` heading gives the name and the URL.
//   - its media in public/scenes/<id>/: `still-<date>.jpg` (also the page's
//     OG image) and `loop-<date>.mp4`, a short silent clip, both made by
//     tools/scene-page-media.mjs. The date in the name is the capture day; a
//     new capture is a new name, the newest of each wins.
// Records only ever describe free scenes (paid scenes keep theirs in the
// private repo), so nothing here reads src/render/scenes/private/.
//
// A page loads no app code: its HTML, one font file, its still and its clip.
// "Open it" is the app's own scene link, /#/v/<id>.

export const SITE = "https://www.sinevisualslab.com";
const PRODUCT = "Sine Visuals Lab";

/** Search engines cut a snippet near here; the lead paragraph doubles as the
 *  meta description, so it has to fit. */
export const DESCRIPTION_MAX = 160;
/** How many other scenes a page links to under "More scenes". */
export const NEIGHBOURS = 6;
/** The one font file a page loads: the panel's label face (src/ui/controlsTheme.ts). */
export const FONT_FILE = "chakra-petch-latin-500-normal.woff2";
export const FONT_PATH = `/scenes/_font/${FONT_FILE}`;

const HEADING_RE = /^# (.+?) \(`([a-z0-9-]+)`\)\s*$/m;
const MEDIA_RE = /^(still|loop)-(\d{4}-\d{2}-\d{2})\.(jpg|mp4)$/;

/**
 * Reads a record's `## Page` section. Null when the record has none, or only
 * the template's placeholder; `error` when the copy breaks a rule.
 * @param {string} markdown
 * @returns {{ id: string, name: string, paragraphs: string[] } | { error: string } | null}
 */
export function parseScenePage(markdown) {
  const heading = HEADING_RE.exec(markdown);
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === "## Page");
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  const body = lines.slice(start + 1, end === -1 ? lines.length : end).join("\n").trim();
  if (body === "" || body.startsWith("<")) return null;
  if (!heading) return { error: "no `# Name (`id`)` heading" };
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  if (paragraphs[0].length > DESCRIPTION_MAX) {
    return { error: `${heading[2]}: the Page section's first paragraph is ${paragraphs[0].length} characters, over ${DESCRIPTION_MAX}` };
  }
  return { id: heading[2], name: heading[1], paragraphs };
}

/**
 * The newest still and loop among a scene's media file names, or null when
 * either is missing.
 * @param {string[]} names
 * @returns {{ still: string, loop: string, date: string } | null}
 */
export function pickMedia(names) {
  /** @type {Record<string, { name: string, date: string }>} */
  const newest = {};
  for (const name of names) {
    const m = MEDIA_RE.exec(name);
    if (!m || (m[1] === "still") !== (m[3] === "jpg")) continue;
    if (!newest[m[1]] || m[2] > newest[m[1]].date) newest[m[1]] = { name, date: m[2] };
  }
  if (!newest.still || !newest.loop) return null;
  return {
    still: newest.still.name,
    loop: newest.loop.name,
    date: newest.loop.date > newest.still.date ? newest.loop.date : newest.still.date,
  };
}

/**
 * Every scene that gets a page, by name, from the records and each one's
 * media file names. A record with Page copy but no media, or copy that
 * breaks a rule, is an error: the build stops rather than ship a broken page.
 * @param {{ file: string, text: string }[]} records  docs/scenes/<file>
 * @param {(id: string) => string[]} mediaOf  the names in public/scenes/<id>/
 */
export function collectScenePages(records, mediaOf) {
  /** @type {{ id: string, name: string, paragraphs: string[], media: { still: string, loop: string, date: string } }[]} */
  const pages = [];
  /** @type {string[]} */
  const errors = [];
  for (const { file, text } of records) {
    const parsed = parseScenePage(text);
    if (!parsed) continue;
    if ("error" in parsed) {
      errors.push(`docs/scenes/${file}: ${parsed.error}`);
      continue;
    }
    if (file !== `${parsed.id}.md`) {
      errors.push(`docs/scenes/${file}: its heading names \`${parsed.id}\`; a record is named after its scene's id`);
      continue;
    }
    const media = pickMedia(mediaOf(parsed.id));
    if (!media) {
      errors.push(`docs/scenes/${file}: no still-<date>.jpg and loop-<date>.mp4 in public/scenes/${parsed.id}/ (tools/scene-page-media.mjs makes them)`);
      continue;
    }
    pages.push({ ...parsed, media });
  }
  pages.sort((a, b) => a.name.localeCompare(b.name));
  return { pages, errors };
}

/** @param {string} id */
function scenePath(id) {
  return `/scenes/${id}/`;
}

/** @param {string} text */
function esc(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** JSON inside a <script> must not close it. @param {unknown} value */
function jsonLd(value) {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

/**
 * The scenes a page links to: the ones after it in `pages`' order, wrapping.
 * @template T
 * @param {T[]} pages
 * @param {number} index
 * @returns {T[]}
 */
export function neighboursOf(pages, index) {
  const out = [];
  for (let k = 1; k < pages.length && out.length < NEIGHBOURS; k++) out.push(pages[(index + k) % pages.length]);
  return out;
}

const STYLE = `
@font-face { font-family: "Chakra Petch"; font-weight: 500; font-display: swap; src: url("${FONT_PATH}") format("woff2"); }
:root { color-scheme: dark; --ground: #05070a; --ink: #f2f4f7; --dim: #a3abb8; --line: rgba(255,255,255,.12); --accent: #c3a5f9; --red: #e8322a; }
* { box-sizing: border-box; }
html { background: var(--ground); }
body { margin: 0; background: var(--ground); color: var(--ink); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: inherit; }
.wrap { max-width: 920px; margin: 0 auto; padding: 0 16px; }
header { padding: 18px 0; }
.brand { display: inline-flex; align-items: center; gap: 12px; text-decoration: none; font: 500 15px/1 "Chakra Petch", system-ui, sans-serif; letter-spacing: .14em; text-transform: uppercase; }
.brand img { width: 36px; height: 36px; display: block; }
h1, h2, .open, .label { font-family: "Chakra Petch", system-ui, sans-serif; font-weight: 500; }
h1 { font-size: clamp(36px, 7vw, 56px); line-height: 1.05; margin: 28px 0 6px; letter-spacing: .01em; }
.label { color: var(--accent); font-size: 14px; letter-spacing: .14em; text-transform: uppercase; margin: 0; }
.clip { margin: 24px 0 0; border: 1px solid var(--line); background: #000; aspect-ratio: 40 / 21; overflow: hidden; }
.clip video, .clip img { display: block; width: 100%; height: 100%; object-fit: cover; }
.copy { max-width: 640px; margin-top: 24px; }
.copy p { margin: 0 0 16px; }
.open { display: inline-block; margin: 8px 0 12px; padding: 14px 26px; background: var(--accent); color: #0b0614; text-decoration: none; font-size: 18px; letter-spacing: .06em; border-radius: 2px; }
.open:hover, .open:focus-visible { background: #fff; }
.fine { color: var(--dim); font-size: 15px; max-width: 640px; margin: 0 0 8px; }
.more { margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--line); }
.more h2 { font-size: 22px; margin: 0 0 16px; letter-spacing: .04em; }
.more ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
.more li a { display: block; text-decoration: none; }
.more li img { display: block; width: 100%; height: auto; aspect-ratio: 40 / 21; object-fit: cover; border: 1px solid var(--line); background: #000; }
.more li span { display: block; margin-top: 8px; font: 500 16px/1.3 "Chakra Petch", system-ui, sans-serif; }
.more li a:hover img, .more li a:focus-visible img { border-color: var(--accent); }
.all { display: inline-block; margin-top: 20px; color: var(--accent); }
footer { margin: 64px 0 32px; padding-top: 20px; border-top: 1px solid var(--line); color: var(--dim); font-size: 14px; }
footer a { color: var(--dim); }
@media (prefers-reduced-motion: reduce) { .clip video { display: none; } .clip { background-size: cover; background-position: center; } }
`;

/**
 * One scene page.
 * @param {{ id: string, name: string, paragraphs: string[], media: { still: string, loop: string, date: string } }} page
 * @param {{ id: string, name: string, media: { still: string } }[]} neighbours
 * @returns {string}
 */
export function renderScenePage(page, neighbours) {
  const url = SITE + scenePath(page.id);
  const still = `${scenePath(page.id)}${page.media.still}`;
  const loop = `${scenePath(page.id)}${page.media.loop}`;
  const title = `${page.name} — free music visualizer scene · ${PRODUCT}`;
  const description = page.paragraphs[0];
  const openLabel = `Open ${page.name}`;
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#page`,
        url,
        name: title,
        description,
        inLanguage: "en",
        isPartOf: { "@type": "WebSite", name: PRODUCT, url: `${SITE}/` },
        primaryImageOfPage: SITE + still,
        breadcrumb: { "@id": `${url}#crumbs` },
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#crumbs`,
        itemListElement: [
          { "@type": "ListItem", position: 1, name: PRODUCT, item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: page.name, item: url },
        ],
      },
      {
        "@type": "VideoObject",
        name: `${page.name}, a ${PRODUCT} scene`,
        description,
        thumbnailUrl: SITE + still,
        contentUrl: SITE + loop,
        uploadDate: page.media.date,
        isFamilyFriendly: true,
      },
    ],
  };
  const more = neighbours
    .map(
      (n) =>
        `<li><a href="${scenePath(n.id)}"><img src="${scenePath(n.id)}${n.media.still}" alt="" loading="lazy" width="1200" height="630"><span>${esc(n.name)}</span></a></li>`,
    )
    .join("\n          ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#05070a">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <link rel="canonical" href="${url}">
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="preload" href="${FONT_PATH}" as="font" type="font/woff2" crossorigin>
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${PRODUCT}">
    <meta property="og:title" content="${esc(`${page.name} · ${PRODUCT}`)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${SITE}${still}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:video" content="${SITE}${loop}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(`${page.name} · ${PRODUCT}`)}">
    <meta name="twitter:description" content="${esc(description)}">
    <meta name="twitter:image" content="${SITE}${still}">
    <script type="application/ld+json">
${jsonLd(graph)}
    </script>
    <style>${STYLE}    .clip { background-image: url("${still}"); }
    </style>
  </head>
  <body>
    <div class="wrap">
      <header>
        <a class="brand" href="/"><img src="/icon-192.png" alt="" width="36" height="36">${PRODUCT}</a>
      </header>
      <main>
        <p class="label">Music visualizer scene</p>
        <h1>${esc(page.name)}</h1>
        <figure class="clip">
          <video src="${loop}" poster="${still}" width="1200" height="630" autoplay muted loop playsinline aria-label="${esc(`${page.name} reacting to music`)}"></video>
        </figure>
        <div class="copy">
          ${page.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("\n          ")}
        </div>
        <a class="open" href="/#/v/${page.id}">${esc(openLabel)}</a>
        <p class="fine">Free, in your browser, nothing to install. It listens to your microphone, or to a tab or window you share, and your audio never leaves your device.</p>
        <section class="more" aria-labelledby="more">
          <h2 id="more">More scenes</h2>
          <ul>
          ${more}
          </ul>
          <a class="all" href="/">All scenes in the gallery</a>
        </section>
      </main>
      <footer>
        ${PRODUCT} · <a href="https://github.com/maksymenkoyr/sine-visuals-lab">Source code (AGPL)</a> · <a href="https://www.instagram.com/sinevisualslab/">Instagram</a>
      </footer>
    </div>
  </body>
</html>
`;
}

/**
 * The home page's links to every scene page, for crawlers and screen readers:
 * the gallery shows no text by design, like the sr-only h1 beside it.
 * @param {{ id: string, name: string }[]} pages
 * @returns {string}
 */
export function renderSceneNav(pages) {
  if (pages.length === 0) return "";
  const items = pages.map((p) => `<li><a href="${scenePath(p.id)}">${esc(p.name)}</a></li>`).join("");
  return `<nav class="sr-only" aria-label="Scenes"><ul>${items}</ul></nav>`;
}

/**
 * sitemap.xml: the home page, then every scene page.
 * @param {{ id: string, media: { date: string } }[]} pages
 * @returns {string}
 */
export function renderSitemap(pages) {
  const urls = [`  <url>\n    <loc>${SITE}/</loc>\n  </url>`].concat(
    pages.map((p) => `  <url>\n    <loc>${SITE}${scenePath(p.id)}</loc>\n    <lastmod>${p.media.date}</lastmod>\n  </url>`),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
