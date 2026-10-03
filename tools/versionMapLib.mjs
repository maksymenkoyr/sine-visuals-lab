/**
 * The picture of how version numbers move — one static page, generated from
 * the release and build tags so nobody has to keep it current by hand
 * (tools/version-map.mjs reads git and writes it; the pure half lives here
 * so tests/versionMap.test.ts can pin it).
 *
 * What it draws, and where the facts come from:
 *
 *  - Every Insiders build is a pull request that landed on main, tagged
 *    `vX.Y.Z-beta` by deploy.yml's `tag-insider` job. Those tags ARE the
 *    record of what shipped, so the picture never recomputes a number: a
 *    build shows the version it actually carried, and a number that never
 *    shipped is simply absent.
 *  - Every Stable release is a strict `vX.Y.0` tag on production
 *    (release.yml). The release is cut from one main commit, not
 *    necessarily the tip: the merge base of the release and main, mapped
 *    back to the Insiders build that commit shipped as (`cutVersion`).
 *    Builds that shipped after that commit but before the release existed
 *    (`ghosts`) keep their old number, yet count again from the cut — the
 *    picture shows both, which is why a minor-version bump can skip a
 *    patch number.
 *  - How the numbers move (what the major, minor and patch each count) is
 *    appVersionLib.mjs's header; what a label reads like per channel is
 *    src/version.ts. This file only draws them, and takes the label text
 *    from a `labelOf` function the caller passes in (the real
 *    `versionLabel`), so the picture can't disagree with the footer.
 *
 * The page is self-contained: system fonts, inline style, no script and no
 * request to anywhere. deploy.yml writes it to dist/versions.html on every
 * Insiders deploy, so it is served at /versions on the Insiders site and is
 * always as current as the last merge; `npm run versions` writes the same
 * page locally. How much history it keeps is BUILDS_BEFORE / BUILDS_AFTER.
 */

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const BUILD_TAG = /^v(\d+)\.(\d+)\.(\d+)-beta$/;

/** Insiders builds kept on the old side of the release (the cut and every
 *  build after it are always kept, whatever this says). */
export const BUILDS_BEFORE = 3;
/** Insiders builds kept after the release; older ones collapse to an ellipsis. */
export const BUILDS_AFTER = 10;

/** `"0.2.7"` → `{ major: 0, minor: 2, patch: 7 }`; anything else → null. */
export function parseVersion(version) {
  const m = VERSION.exec(String(version).trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

/** `"v0.2.7-beta"` → `{ major: 0, minor: 2, patch: 7 }`; anything else → null. */
export function parseBuildTag(tag) {
  const m = BUILD_TAG.exec(String(tag).trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

/** The pull request a commit subject names: a squash subject's trailing
 *  `(#123)`, or `Merge pull request #123 from …`. Null when it names none. */
export function prFromSubject(subject) {
  const squash = /\(#(\d+)\)\s*$/.exec(subject);
  if (squash) return Number(squash[1]);
  const merge = /^Merge pull request #(\d+)\b/.exec(subject);
  return merge ? Number(merge[1]) : null;
}

const cmp = (a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch;
const fmt = (v) => `${v.major}.${v.minor}.${v.patch}`;
const sameSeries = (a, b) => a.major === b.major && a.minor === b.minor;

/**
 * The model the page is drawn from.
 *
 * `input`: `releases` (strict release versions, any order), `builds` (every
 * shipped Insiders build as `{ version, pr }`), `cutVersion` (the Insiders
 * build the latest release was cut from, or null), `ghostCounts` (for builds
 * that shipped after the cut but before the release: their patch number in
 * the count that restarted at the cut), `current` (the build being deployed
 * right now, which has no tag yet) and the page's `generatedAt`, `commit`
 * and `repoUrl`. `labelOf(channel, version)` is src/version.ts's label.
 */
export function buildVersionMap(input, labelOf) {
  const releases = input.releases.map(parseVersion).filter(Boolean).sort(cmp);
  const latest = releases.at(-1) ?? null;
  const prev = releases.at(-2) ?? null;

  const seen = new Set();
  const builds = [];
  const addBuild = (b) => {
    const v = parseVersion(b.version);
    // Patch 0 is the release itself (appVersionLib.mjs), so a `-beta` tag
    // with patch 0, like the legacy `v0.1.0-beta`, is not an Insiders build.
    if (!v || v.patch === 0 || seen.has(b.version)) return;
    seen.add(b.version);
    builds.push({ ...v, version: b.version, pr: b.pr ?? null });
  };
  input.builds.forEach(addBuild);
  if (input.current) addBuild(input.current);
  builds.sort(cmp);
  const newest = builds.at(-1) ?? null;

  const isFresh = (b) => latest !== null && sameSeries(b, latest);
  // Builds before the release belong to the series that led into it; older
  // series (the major-0 patch-only days) are history this picture skips.
  const earlier = latest ? builds.filter((b) => cmp(b, { ...latest, patch: 0 }) < 0) : [];
  const lead = earlier.at(-1) ?? null;
  const series = lead ? earlier.filter((b) => sameSeries(b, lead)) : [];

  const cutIndex = input.cutVersion ? series.findIndex((b) => b.version === input.cutVersion) : -1;
  const ghosts = cutIndex >= 0 ? series.slice(cutIndex + 1) : [];
  const wanted = series.length - BUILDS_BEFORE;
  const start = Math.max(0, cutIndex >= 0 ? Math.min(wanted, cutIndex - 1) : wanted);
  const oldBuilds = series.slice(start).map((b, i) => {
    const g = cutIndex >= 0 && start + i > cutIndex;
    return {
      version: b.version,
      pr: b.pr,
      cut: start + i === cutIndex,
      ghost: g,
      counted: g ? (input.ghostCounts?.[b.version] ?? start + i - cutIndex) : null,
      live: false,
    };
  });
  const skipped = series.slice(0, start);

  const fresh = latest ? builds.filter(isFresh) : builds;
  const freshOmitted = Math.max(0, fresh.length - BUILDS_AFTER);
  const freshBuilds = fresh.slice(freshOmitted).map((b) => ({
    version: b.version,
    pr: b.pr,
    cut: false,
    ghost: false,
    counted: b.patch,
    live: b === newest,
  }));
  // Right after a release nothing has shipped on the new count yet, so the
  // newest build is still the last one on the old side.
  if (freshBuilds.length === 0 && oldBuilds.length) oldBuilds.at(-1).live = oldBuilds.at(-1).version === newest?.version;

  const base = latest ?? parseVersion(newest?.version ?? "0.0.0");
  const patchNow = fresh.length ? Math.max(...fresh.map((b) => b.patch)) : 0;
  const nextMerge = `${base.major}.${base.minor}.${patchNow + 1}`;
  const nextRelease = `${base.major}.${base.minor + 1}.0`;
  const afterRelease = `${base.major}.${base.minor + 1}.1`;
  const afterMajor = `${base.major + 1}.0.0`;
  const example = parseVersion(newest?.version ?? "0.0.0");

  return {
    generatedAt: input.generatedAt,
    commit: input.commit ?? null,
    repoUrl: input.repoUrl,
    latest: latest ? fmt(latest) : null,
    prev: prev ? fmt(prev) : null,
    cutVersion: cutIndex >= 0 ? input.cutVersion : null,
    ghosts: ghosts.map((g, i) => ({ version: g.version, pr: g.pr, counted: input.ghostCounts?.[g.version] ?? i + 1 })),
    cutPr: cutIndex >= 0 ? series[cutIndex].pr : null,
    old: {
      builds: oldBuilds,
      skipped: skipped.length ? (skipped.length === 1 ? skipped[0].version : `${skipped[0].version} … ${skipped.at(-1).version}`) : null,
    },
    fresh: { builds: freshBuilds, omitted: freshOmitted },
    newest: newest ? newest.version : null,
    next: { merge: nextMerge, release: nextRelease, afterRelease, afterMajor },
    example: { major: example.major, minor: example.minor, patch: example.patch },
    labels: {
      insidersNow: newest ? labelOf("insider", newest.version) : null,
      stableNow: latest ? labelOf("stable", fmt(latest)) : null,
      insidersNextMerge: labelOf("insider", nextMerge),
      stableNextRelease: labelOf("stable", nextRelease),
      insidersAfterRelease: labelOf("insider", afterRelease),
      stableAfterMajor: labelOf("stable", afterMajor),
      insidersAfterMajor: labelOf("insider", `${base.major + 1}.0.1`),
    },
  };
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------------------------------------------------------------------------
// The timeline, as an SVG for wide screens and as a list for phones.

const GAP = 80;
const Y = { rail: 150, count: 218, prod: 330 };

function ghostNote(m) {
  const who = (g) => (g.pr ? `#${g.pr}` : g.version);
  const [major, minor] = (m.latest ?? "0.0.0").split(".");
  const would = (g) => `${major}.${minor}.${g.counted}`;
  if (m.ghosts.length === 1) {
    const g = m.ghosts[0];
    return `${who(g)} would be ${would(g)}, but it had already shipped as ${g.version}`;
  }
  const a = m.ghosts[0];
  const b = m.ghosts.at(-1);
  return `${a.version} … ${b.version} would be ${would(a)} … ${would(b)}, but had already shipped`;
}

function chip(x, y, label, cls) {
  const w = Math.round(24 + label.length * 7.9);
  return `<rect class="svg-chip ${cls}" x="${x - w / 2}" y="${y}" width="${w}" height="28" rx="6"/><text class="chip-text mid" x="${x}" y="${y + 19}">${esc(label)}</text>`;
}

function renderSvg(m) {
  const hasLead = m.old.skipped !== null;
  let x = 140 + (hasLead ? 150 : 30);
  const cols = [];
  for (const b of m.old.builds) {
    cols.push({ ...b, x });
    x += GAP;
  }
  const releaseX = (cols.length ? cols.at(-1).x : x - GAP) + GAP / 2;
  x = releaseX + GAP / 2;
  const ellipsisX = m.fresh.omitted ? x - 10 : null;
  if (m.fresh.omitted) x += 36;
  for (const b of m.fresh.builds) {
    cols.push({ ...b, x });
    x += GAP;
  }
  const nextX = x;
  const W = nextX + 90;
  const firstX = cols[0] ? cols[0].x : releaseX;
  const liveCol = cols.find((c) => c.live) ?? null;
  const cutCol = cols.find((c) => c.cut) ?? null;
  // The count row: builds counted again since the cut, shipped under an old
  // number (ghosts) or a new one.
  const counted = cols.filter((c) => c.ghost || c.x > releaseX);
  const out = [];
  const T = (cls, tx, ty, text, extra = "") => `<text class="${cls}" x="${tx}" y="${ty}"${extra}>${esc(text)}</text>`;

  out.push(
    `<defs><marker id="mk-mut" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path class="mk" d="M0 0 10 5 0 10z"/></marker>` +
      `<marker id="mk-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path class="mk-blue" d="M0 0 10 5 0 10z"/></marker></defs>`,
  );
  // lane names
  out.push(T("lane lane-ins", 24, 118, "INSIDERS"), T("lane lane-mut", 24, 154, "MAIN"), T("sub", 24, 170, "merged PRs"));
  if (counted.length) out.push(T("lane lane-mut", 24, 222, "COUNT"), T("sub", 24, 238, "since the cut"));
  if (m.latest) out.push(T("lane lane-stb", 24, 334, "PRODUCTION"), T("sub", 24, 350, "release merges"), T("lane lane-stb", 24, 398, "STABLE"), T("sub", 24, 414, "footer label"));

  // the moment of release
  if (m.latest) {
    out.push(`<path class="divider" d="M${releaseX} 94V318"/>`, T("note blue mid", releaseX, 84, `v${m.latest} released`));
  }
  if (liveCol) {
    const near = m.latest && Math.abs(liveCol.x - releaseX) < 110;
    out.push(T("tiny amber mid", liveCol.x, near ? 70 : 84, "LIVE NOW"));
  }

  // main
  const railFrom = hasLead ? firstX - 28 : 140;
  if (hasLead) {
    out.push(`<path class="rail" d="M140 ${Y.rail}H${railFrom}" stroke-dasharray="3 6"/>`, T("old mid", (140 + railFrom) / 2, 118, m.old.skipped));
  }
  out.push(`<path class="rail" d="M${railFrom} ${Y.rail}H${W - 18}" marker-end="url(#mk-mut)"/>`);
  if (ellipsisX !== null) out.push(T("old mid", ellipsisX, 118, "…"));
  for (const c of cols) {
    if (c.cut) out.push(`<circle class="cut-ring" cx="${c.x}" cy="${Y.rail}" r="12"/>`);
    out.push(
      `<path class="tick" d="M${c.x} 126V141"/><circle class="dot" cx="${c.x}" cy="${Y.rail}" r="7"/>`,
      T("ver mid", c.x, 118, c.version),
    );
    if (c.pr) out.push(T("pr mid", c.x, 180, `#${c.pr}`));
  }
  out.push(`<circle class="dot-next" cx="${nextX}" cy="${Y.rail}" r="7"/>`, T("ver mid", nextX, 118, m.next.merge, ' opacity="0.6"'), T("pr mid", nextX, 180, "next merge"));

  // patch count since the cut
  if (counted.length) {
    for (const c of counted) {
      out.push(`<circle class="${c.ghost ? "cnt-ghost" : "cnt"}" cx="${c.x}" cy="${Y.count}" r="11"/><text class="cnt-n mid" x="${c.x}" y="${Y.count}" dy="0.35em">${c.counted}</text>`);
    }
    const a = counted[0].x;
    const z = counted.at(-1).x;
    out.push(`<path class="bracket" d="M${a} 233V240H${z}V233"/>`, T("note mid", (a + z) / 2, 260, "patch = merges since the cut"));
    if (m.ghosts.length) out.push(T("note", releaseX + 16, 284, ghostNote(m)));
  }

  // the cut: main at one commit copied into production
  if (cutCol && m.latest) {
    const off = m.ghosts.length ? 32 : 18;
    const cx = cutCol.x;
    out.push(
      `<path class="cut-link" d="M${cx + 8.5} 158.5Q${cx + off - 8} 172 ${cx + off} 200V322Q${cx + off} 330 ${cx + off + 8} 330H${releaseX - 10}"/>`,
      T("note blue end", cx + off - 14, 250, "release cut"),
      T("note end", cx + off - 14, 267, "minor +1"),
      T("note end", cx + off - 14, 284, "patch restarts"),
    );
  }

  // production and Stable
  if (m.latest) {
    out.push(`<path class="rail-prod" d="M140 ${Y.prod}H${W - 18}" marker-end="url(#mk-blue)"/>`);
    if (m.prev) out.push(`<circle class="node-old" cx="150" cy="${Y.prod}" r="7"/>`, T("pr mid", 150, 358, `v${m.prev}`));
    out.push(`<circle class="node" cx="${releaseX}" cy="${Y.prod}" r="10"/>`, T("pr mid blue", releaseX, 358, `v${m.latest}`));
    out.push(
      `<path class="next-link" d="M${nextX} 160V318" marker-end="url(#mk-blue)"/><circle class="node-next" cx="${nextX}" cy="${Y.prod}" r="10"/>`,
      T("note blue end", nextX - 12, 306, "next release"),
      T("note end", nextX - 12, 322, `makes ${m.next.release}`),
      T("pr mid", nextX, 358, `v${m.next.release}`),
    );
    out.push(chip(releaseX, 384, m.labels.stableNow, "chip-live"), chip(nextX, 384, m.labels.stableNextRelease, "chip-next"));
  }

  const aria =
    `Timeline of the version counter. Each merged pull request on main deploys to Insiders and adds one to the patch number; the newest build is ${m.newest ?? "none yet"}.` +
    (m.latest ? ` The Stable release v${m.latest} was cut from main${m.cutPr ? ` at pull request ${m.cutPr}` : ""}, and counting restarted there.` : "") +
    (m.ghosts.length ? ` ${ghostNote(m)}.` : "") +
    ` The next release will be ${m.next.release}.`;
  return `<svg class="map" viewBox="0 62 ${W} 402" role="img" aria-label="${esc(aria)}">${out.join("")}</svg>`;
}

function renderList(m) {
  const rows = [];
  const row = (cls, ver, pr, count, note) =>
    `<li class="vt-row ${cls}"><span class="vt-ver">${esc(ver)}</span>${pr ? `<span class="vt-pr">${esc(pr)}</span>` : ""}${count}${note ? `<span class="vt-note">${esc(note)}</span>` : ""}</li>`;
  const ring = (n, ghost) => `<span class="vt-count${ghost ? " ghost" : ""}">${n}</span>`;
  if (m.old.skipped) rows.push(row("vt-old", m.old.skipped, "", "", ""));
  for (const b of m.old.builds) {
    const note = b.cut ? (m.ghosts.length ? "The release is cut from here. Minor +1, patch restarts." : "The release is cut from here, at the tip. Minor +1, patch restarts.") : "";
    const ghostText = b.ghost ? `Would be ${(m.latest ?? "").split(".").slice(0, 2).join(".")}.${b.counted}, but it had already shipped as ${b.version}.` : "";
    rows.push(row(b.cut ? "vt-cut" : "", b.version, b.pr ? `#${b.pr}` : "", b.ghost ? ring(b.counted, true) : "", note || ghostText));
  }
  if (m.latest) rows.push(row("vt-release", `v${m.latest} released`, "", "", `Stable shows ${m.labels.stableNow}.`));
  if (m.fresh.omitted) rows.push(row("vt-old", "…", "", "", ""));
  for (const b of m.fresh.builds) rows.push(row("", b.version, b.pr ? `#${b.pr}` : "", ring(b.counted, false), b.live ? "Live now on Insiders." : ""));
  rows.push(row("vt-next", m.next.merge, "next merge", "", ""));
  if (m.latest) rows.push(row("vt-next vt-next-release", "next release", "", "", `Minor +1 makes ${m.next.release}, and counting restarts.`));
  return `<ol class="vt" aria-label="The same timeline as a list, oldest first">${rows.join("")}</ol>`;
}

// ---------------------------------------------------------------------------
// The page.

const CSS = `
:root{color-scheme:dark;--bg:#080b12;--surface:#0e1420;--surface-2:#141c2c;--ink:#e7ebf3;--muted:#9aa4b8;--faint:#5d687e;--rule:rgba(231,235,243,.13);--amber:#f9b96c;--amber-soft:rgba(249,185,108,.12);--amber-line:rgba(249,185,108,.5);--blue:#59bbfb;--blue-soft:rgba(89,187,251,.12);--blue-line:rgba(89,187,251,.55);--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#f1f3f8;--surface:#fff;--surface-2:#f3f5fa;--ink:#0f1625;--muted:#4f5a70;--faint:#8791a5;--rule:rgba(15,22,37,.14);--amber:#a45b00;--amber-soft:rgba(164,91,0,.1);--amber-line:rgba(164,91,0,.5);--blue:#0a68ad;--blue-soft:rgba(10,104,173,.1);--blue-line:rgba(10,104,173,.5)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--sans);-webkit-text-size-adjust:100%}
.page{max-width:1040px;margin:0 auto;padding:36px clamp(16px,4vw,32px) 64px;display:flex;flex-direction:column;gap:48px}
h1{font:600 clamp(28px,5vw,40px)/1.1 var(--sans);letter-spacing:-.015em;margin:0;text-wrap:balance}
h2{font:600 19px/1.25 var(--sans);margin:0 0 16px;text-wrap:balance}
h3{margin:0;font:600 16px/1.3 var(--sans);text-wrap:balance}
p{margin:0;max-width:66ch}
a{color:inherit}
code{font:13px var(--mono)}
.eyebrow{font:11px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.meta{color:var(--muted);font-size:13px}
.head{display:flex;flex-direction:column;gap:14px}
.lede{font-size:17px;line-height:1.5}
.snap{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}
.chip{display:inline-block;font:14px/1 var(--mono);letter-spacing:.05em;padding:7px 10px;border-radius:6px;border:1px solid var(--rule);background:var(--surface-2);white-space:nowrap}
.chip.stable{color:var(--blue);border-color:var(--blue-line);background:var(--blue-soft)}
.chip.insiders{color:var(--amber);border-color:var(--amber-line);background:var(--amber-soft)}
.chip.plain{color:var(--muted)}
.badge-ins{font:10.5px/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--amber);border:1px solid var(--amber-line);border-radius:99px;padding:5px 8px}
.bignum{display:flex;align-items:flex-start;font:400 clamp(52px,12vw,96px)/1 var(--mono);margin-bottom:28px}
.seg{--c:var(--ink);display:flex;flex-direction:column}
.seg b{font-weight:400;color:var(--c)}
.seg::after{content:"";display:block;height:12px;margin:14px 3px 0;border:2px solid var(--c);border-top:0;border-radius:0 0 6px 6px;opacity:.85}
.seg.minor{--c:var(--blue)}.seg.patch{--c:var(--amber)}.seg.word{--c:var(--muted)}
.sep{color:var(--faint)}
.bn-gap{width:.5ch}
.parts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px 26px}
.pt{--c:var(--ink);display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:2px solid var(--c);min-width:0}
.pt.minor{--c:var(--blue)}.pt.patch{--c:var(--amber)}.pt.word{--c:var(--muted)}
.pt .eyebrow{color:var(--c)}
.pt p{font-size:14px;color:var(--muted)}
figure{margin:0}
.scroll{overflow-x:auto;border:1px solid var(--rule);border-radius:10px;background:var(--surface);padding:10px 8px 8px}
.map{display:block;width:100%;min-width:980px;height:auto}
figcaption{margin-top:14px;color:var(--muted);font-size:14px;max-width:78ch}
.legend{display:flex;flex-wrap:wrap;gap:8px 22px;margin:14px 0 0;padding:0;list-style:none;font-size:13px;color:var(--muted)}
.legend li{display:flex;align-items:center;gap:8px}
.lg{display:inline-block;width:14px;height:14px;flex:none}
.lg-dot{border-radius:50%;background:var(--amber)}.lg-ring{border-radius:50%;border:2px solid var(--blue)}.lg-node{border-radius:50%;background:var(--blue)}.lg-ghost{border-radius:50%;border:1.5px dashed var(--amber)}.lg-dash{border-radius:50%;border:1.5px dashed var(--blue)}
.map text{font-family:var(--mono);fill:var(--ink)}
.map .mid{text-anchor:middle}.map .end{text-anchor:end}
.map .lane{font-size:12.5px;letter-spacing:.1em}.map .lane-ins{fill:var(--amber)}.map .lane-stb{fill:var(--blue)}.map .lane-mut{fill:var(--muted)}
.map .sub{font-size:11px;fill:var(--muted)}.map .ver{font-size:15px;fill:var(--amber)}.map .old{font-size:12.5px;fill:var(--muted)}.map .pr{font-size:12px;fill:var(--muted)}.map .note{font-size:12.5px;fill:var(--muted)}
.map .blue{fill:var(--blue)}.map .amber{fill:var(--amber)}.map .tiny{font-size:10.5px;letter-spacing:.12em}
.map .rail{stroke:var(--faint);stroke-width:2;fill:none}.map .rail-prod{stroke:var(--blue-line);stroke-width:2;fill:none}
.map .tick{stroke:var(--amber-line);stroke-width:1.5;fill:none}
.map .dot{fill:var(--amber);stroke:var(--surface);stroke-width:2}
.map .dot-next{fill:none;stroke:var(--amber);stroke-width:1.5;stroke-dasharray:3 3}
.map .cut-ring{fill:none;stroke:var(--blue);stroke-width:2}.map .cut-link{fill:none;stroke:var(--blue);stroke-width:2}
.map .divider{fill:none;stroke:var(--blue);stroke-width:1.5;stroke-dasharray:4 5;opacity:.75}
.map .next-link{fill:none;stroke:var(--blue);stroke-width:1.5;stroke-dasharray:3 5}
.map .node{fill:var(--blue);stroke:var(--surface);stroke-width:2}.map .node-old{fill:var(--blue);opacity:.45}.map .node-next{fill:none;stroke:var(--blue);stroke-width:1.5;stroke-dasharray:3 3}
.map .cnt{fill:none;stroke:var(--amber);stroke-width:1.5}.map .cnt-ghost{fill:none;stroke:var(--amber);stroke-width:1.5;stroke-dasharray:2.5 2.5;opacity:.75}.map .cnt-n{font-size:12.5px}
.map .bracket{fill:none;stroke:var(--muted);stroke-width:1.2}
.map .svg-chip{fill:var(--surface-2);stroke:var(--rule);stroke-width:1}.map .chip-live{fill:var(--blue-soft);stroke:var(--blue-line);stroke-width:1.5}.map .chip-next{fill:none;stroke:var(--blue-line);stroke-width:1.5;stroke-dasharray:4 4}
.map .chip-text{font-size:13.5px;fill:var(--blue)}
.map .mk{fill:var(--faint)}.map .mk-blue{fill:var(--blue)}
.vtwrap{display:none;border:1px solid var(--rule);border-radius:10px;background:var(--surface);padding:16px 16px 10px}
.vt-key{margin:0 0 12px;font-size:13px;color:var(--muted)}
.vt{list-style:none;margin:0;padding:0 0 0 7px}
.vt-row{position:relative;display:grid;grid-template-columns:auto auto 1fr;align-items:center;gap:2px 12px;padding:9px 0 9px 22px;border-left:2px solid var(--faint)}
.vt-row::before{content:"";position:absolute;left:-8px;top:14px;width:14px;height:14px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 3px var(--surface)}
.vt-ver{font:15px var(--mono);color:var(--amber)}.vt-pr{font:12px var(--mono);color:var(--muted)}
.vt-count{justify-self:end;width:24px;height:24px;border:1.5px solid var(--amber);border-radius:50%;font:12.5px/21px var(--mono);text-align:center}
.vt-count.ghost{border-style:dashed;opacity:.8}
.vt-note{grid-column:1/-1;font-size:13px;line-height:1.45;color:var(--muted)}
.vt-old .vt-ver{color:var(--muted);font-size:13px}.vt-old::before{background:var(--faint)}
.vt-cut::before{box-shadow:0 0 0 3px var(--surface),0 0 0 5px var(--blue)}
.vt-release{border-left-color:var(--blue);background:var(--blue-soft);border-radius:0 8px 8px 0;margin:4px 0}.vt-release::before{background:var(--blue)}.vt-release .vt-ver{color:var(--blue)}
.vt-next{border-left-style:dashed}.vt-next::before{background:var(--surface);border:1.5px dashed var(--amber)}.vt-next .vt-ver{opacity:.7}
.vt-next-release{border-left-color:var(--blue)}.vt-next-release::before{border-color:var(--blue)}.vt-next-release .vt-ver{color:var(--blue)}
.stack{display:flex;flex-direction:column;border:1px solid var(--rule);border-radius:10px;background:var(--surface)}
.place{display:flex;flex-direction:column;gap:9px;padding:14px 16px;border-top:1px solid var(--rule)}
.place:first-child{border-top:0}
.place .row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}
.place p{font-size:13.5px;color:var(--muted)}
.tablewrap{border:1px solid var(--rule);border-radius:10px;background:var(--surface);overflow-x:auto}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;vertical-align:top;padding:14px 16px;border-top:1px solid var(--rule)}
thead th{border-top:0;font:11px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:400}
tbody th{font-weight:500;width:30%}
td .meta{display:block;margin-top:6px}
.notes{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:20px 28px}
.note-block{display:flex;flex-direction:column;gap:8px;padding-top:14px;border-top:2px solid var(--rule)}
.note-block p{font-size:14px;color:var(--muted)}
.src{font-size:13px;color:var(--muted);max-width:78ch}
@media (max-width:720px){
.parts{grid-template-columns:repeat(2,minmax(0,1fr))}
.scroll{display:none}.vtwrap{display:block}
.tablewrap{overflow:visible;border:0;background:none}
thead{display:none}table,tbody,tr,th,td{display:block}
tr{border:1px solid var(--rule);border-radius:10px;background:var(--surface);padding:6px 0;margin-bottom:12px}
th,td{border-top:0;padding:8px 14px}
tbody th{width:auto;font-size:15px}
td::before{content:attr(data-label);display:block;margin-bottom:7px;font:11px/1 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
}`;

const utc = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

/** The whole page, as one HTML string. */
export function renderVersionMap(m) {
  const word =(m.labels.insidersNow ?? "").endsWith("- beta");
  const [lMajor, lMinor] = (m.latest ?? "0.0.0").split(".");
  const cutNote = (() => {
    if (!m.latest) return null;
    if (m.cutVersion === null) return { head: "Where the release was cut is not in the tags", body: "The tags here do not say which Insiders build this release was cut from, so the picture shows the release without a cut." };
    const who = (g) => (g.pr ? `#${g.pr}` : g.version);
    const cutWho = m.cutPr ? `#${m.cutPr}` : m.cutVersion;
    if (m.ghosts.length === 0) {
      return {
        head: "The release was cut at the tip",
        body: `v${m.latest} was cut from ${cutWho}, the newest build at the time, so Stable ${m.latest} holds exactly what Insiders ${m.cutVersion} showed.`,
      };
    }
    return {
      head: "A release is cut at one commit, not at the tip",
      body: `v${m.latest} was cut from ${cutWho}. ${m.ghosts.map(who).join(" and ")} had already shipped as Insiders ${m.ghosts.map((g) => g.version).join(" and ")}, so ${m.ghosts.length === 1 ? "it stayed" : "they stayed"} out of Stable ${m.latest} and now ${m.ghosts.length === 1 ? "counts" : "count"} as ${m.ghosts.map((g) => `${lMajor}.${lMinor}.${g.counted}`).join(" and ")}, ${m.ghosts.length === 1 ? "a number that never went out" : "numbers that never went out"}.`,
    };
  })();
  const lastOld = m.old.builds.at(-1)?.version ?? m.cutVersion;
  const jump = m.latest && m.cutVersion
    ? { head: `${lastOld} to ${m.latest} marks the release, not new code`, body: `The minor changes when you cut a release. Stable ${m.latest} holds the code up to ${m.cutPr ? `#${m.cutPr}` : m.cutVersion}${m.ghosts.length ? `, and Insiders ${m.ghosts.at(-1).version} held ${m.ghosts.length === 1 ? "one merge" : `${m.ghosts.length} merges`} more` : ""}.` }
    : null;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sine Visuals Versioning</title><style>${CSS}</style></head>
<body><main class="page">
<header class="head">
<span class="eyebrow">Sine Visuals Lab · release numbering</span>
<h1>Sine Visuals Versioning</h1>
<p class="lede">Every build number has three parts. You set the major. A release moves the minor. Each merge moves the patch.</p>
<div class="snap"><span class="eyebrow">${esc(utc(m.generatedAt))}</span>${m.labels.insidersNow ? `<span class="chip insiders">${esc(m.labels.insidersNow)}</span><span class="meta">Insiders now</span>` : ""}${m.labels.stableNow ? `<span class="chip stable">${esc(m.labels.stableNow)}</span><span class="meta">Stable now</span>` : ""}</div>
</header>

<section aria-labelledby="h-read"><h2 id="h-read">Reading a number</h2>
<div class="bignum" role="img" aria-label="${esc(m.labels.insidersNow ?? "")}, split into the major ${m.example.major}, the minor ${m.example.minor}, the patch ${m.example.patch}${word ? " and the word beta" : ""}"><span class="seg major"><b>${m.example.major}</b></span><span class="sep">.</span><span class="seg minor"><b>${m.example.minor}</b></span><span class="sep">.</span><span class="seg patch"><b>${m.example.patch}</b></span>${word ? `<span class="bn-gap"></span><span class="seg word"><b>- beta</b></span>` : ""}</div>
<div class="parts">
<div class="pt major"><span class="eyebrow">Major · set by hand</span><p>The major of the version in <code>package.json</code>. While it is 0, Stable carries the beta word.</p></div>
<div class="pt minor"><span class="eyebrow">Minor · per release</span><p>Goes up by one each time main is merged into production with <code>npm run release</code>.</p></div>
<div class="pt patch"><span class="eyebrow">Patch · per merge</span><p>Goes up by one for every merge to main since the last cut. Starts over at each release.</p></div>
<div class="pt word"><span class="eyebrow">The word</span><p>Always on Insiders. On Stable only while the major is 0.</p></div>
</div></section>

<section aria-labelledby="h-move"><h2 id="h-move">How the numbers move</h2>
<figure>
<div class="scroll">${renderSvg(m)}</div>
<div class="vtwrap"><p class="vt-key">Oldest first. Circles count merges since the cut. Amber is Insiders, blue is the release.</p>${renderList(m)}</div>
<ul class="legend" aria-label="Legend"><li><span class="lg lg-dot"></span>merged PR, deployed to Insiders</li><li><span class="lg lg-ring"></span>commit the release was cut from</li><li><span class="lg lg-node"></span>release on production, shown on Stable</li><li><span class="lg lg-ghost"></span>counted, never shipped</li><li><span class="lg lg-dash"></span>not yet happened</li></ul>
<figcaption>Each amber dot is a merged pull request and an Insiders deploy, labelled with the version it showed. A release copies main as it stood at the ringed dot into production, and production is what Stable serves. The minor jump marks that release. Counting then restarts from the ringed dot.</figcaption>
</figure></section>

<section aria-labelledby="h-places"><h2 id="h-places">What each place shows</h2>
<div class="stack">
<div class="place"><span class="eyebrow">Stable · www.sinevisualslab.com</span><div class="row">${m.labels.stableNow ? `<span class="chip stable">${esc(m.labels.stableNow)}</span>` : ""}</div><p>Updates only when a release ships. Its GitHub release keeps the plain <code>vX.Y.Z</code> tag and the Latest badge.</p></div>
<div class="place"><span class="eyebrow">Insiders · insiders.sinevisualslab.com</span><div class="row">${m.labels.insidersNow ? `<span class="chip insiders">${esc(m.labels.insidersNow)}</span>` : ""}<span class="badge-ins">Insiders</span></div><p>Footer in amber, plus the masthead badge. Every merge to main deploys here, as a pre-release tagged <code>vX.Y.Z-beta</code>.</p></div>
<div class="place"><span class="eyebrow">Pull request preview</span><div class="row"><span class="chip plain">preview</span></div><p>One throwaway Worker per open pull request. It has no version number.</p></div>
<div class="place"><span class="eyebrow">Local dev</span><div class="row"><span class="chip plain">dev</span></div><p>Whatever is on disk. No version number either.</p></div>
</div></section>

<section aria-labelledby="h-next"><h2 id="h-next">What the next events do</h2>
<div class="tablewrap"><table>
<thead><tr><th scope="col">Event</th><th scope="col">Stable shows</th><th scope="col">Insiders shows</th></tr></thead>
<tbody>
<tr><th scope="row">A pull request merges</th><td data-label="Stable shows"><span class="chip stable">${esc(m.labels.stableNow ?? "")}</span><span class="meta">unchanged</span></td><td data-label="Insiders shows"><span class="chip insiders">${esc(m.labels.insidersNextMerge)}</span></td></tr>
<tr><th scope="row">A release is cut and merged into production</th><td data-label="Stable shows"><span class="chip stable">${esc(m.labels.stableNextRelease)}</span></td><td data-label="Insiders shows"><span class="chip insiders">${esc(m.labels.insidersAfterRelease)}</span><span class="meta">on the next merge, counted from the cut</span></td></tr>
<tr><th scope="row">The major is raised, then a release</th><td data-label="Stable shows"><span class="chip stable">${esc(m.labels.stableAfterMajor)}</span></td><td data-label="Insiders shows"><span class="chip insiders">${esc(m.labels.insidersAfterMajor)}</span><span class="meta">before that release, Insiders keep counting ${esc(lMajor)}.x</span></td></tr>
</tbody></table></div></section>
${
  cutNote
    ? `
<section aria-labelledby="h-quirks"><h2 id="h-quirks">What this latest release shows</h2>
<div class="notes">
<div class="note-block"><span class="eyebrow">Where the release was cut</span><h3>${esc(cutNote.head)}</h3><p>${esc(cutNote.body)}</p></div>${
        jump
          ? `
<div class="note-block"><span class="eyebrow">The jump</span><h3>${esc(jump.head)}</h3><p>${esc(jump.body)}</p></div>`
          : ""
      }
</div></section>`
    : ""
}

<p class="src">Generated ${esc(utc(m.generatedAt))}${m.commit ? ` for commit ${esc(m.commit.slice(0, 7))}` : ""} from the release and build tags, on every Insiders deploy. The counting rules live in <code>tools/appVersionLib.mjs</code> and the labels in <code>src/version.ts</code>. <a href="${esc(m.repoUrl)}/releases">All releases on GitHub</a>.</p>
</main></body></html>
`;
}
