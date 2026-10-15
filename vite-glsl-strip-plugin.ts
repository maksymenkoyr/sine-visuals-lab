/**
 * Shrinks the GLSL a production build ships. Scenes write their shaders as
 * plain template literals, indented and commented for people; none of that
 * means anything to the GPU's compiler, yet it is a large share of the
 * script every entry page loads before it can draw. On `vite build` only (the dev
 * server, Vitest and the tuning tools all see the source untouched), this
 * plugin rewrites the text of each template literal that reads as GLSL
 * (`looksLikeGlsl`): a comment that opens and closes inside one stretch of
 * template text is dropped, each line loses its indentation and trailing
 * blanks, and a run of spaces between two tokens becomes one space.
 *
 * What it keeps, and why:
 *  - Every newline. A `#version`/`#define`/`#if` line stays a line of its
 *    own, and a compile error's line number (gl.ts throws the log together
 *    with the whole source) still points at the same line as in the source.
 *  - `${…}` interpolations, byte for byte. Only the template's own text
 *    between them changes, and the whitespace right next to an interpolation
 *    stays, since it may be what separates two tokens (`uniform float ${name};`).
 *  - A comment that an interpolation splits (`// ${n} taps`), verbatim: the
 *    interpolated value lands inside that comment in the assembled shader,
 *    so cutting only one side of it would change what the GPU reads.
 *  - A template with a backslash before whitespace, `/` or `*`, untouched:
 *    there a JS escape or line continuation could open or close a comment
 *    differently in the string the GPU gets than in the source text read
 *    here. (An escaped backtick inside a comment, the usual backslash in a
 *    shader, is fine.)
 *  - Tagged templates, untouched: the tag decides what the text means.
 *
 * Our own code over TypeScript's parser (already a dev dependency) — no
 * third-party minifier. tests/glslStrip.test.ts pins these rules and checks,
 * over every module in src/, that stripping changes no GLSL token and no line
 * count.
 */
import ts from "typescript";
import type { Plugin } from "vite";

/** What makes a template GLSL rather than CSS, SVG or a message: more than
 *  one line (looksLikeGlsl checks that), plus at least one of these
 *  alternatives, each a construct only GLSL source has. */
const GLSL_MARK =
  /#version\b|\bprecision\s+(?:highp|mediump|lowp)\b|\buniform\s+(?:(?:highp|mediump|lowp)\s+)?(?:float|int|uint|bool|[iu]?vec[234]|mat[234]|[iu]?sampler\w+)\b|\bvoid\s+main\s*\(|\b(?:void|float|int|uint|bool|[iu]?vec[234]|mat[234])\s+\w+\s*\([^()]*\)\s*\{/;

/** Whether a template's pieces (its text between interpolations) read as
 *  GLSL this plugin may rewrite. Joined with a NUL so an interpolation can't
 *  complete a mark or a backslash pair. */
function looksLikeGlsl(pieces: readonly string[]): boolean {
  const text = pieces.join("\u0000");
  return text.includes("\n") && !/\\[\s/*]/.test(text) && GLSL_MARK.test(text);
}

/** One template literal: each piece's text and where it sits in the module
 *  source, delimiters (backtick, `${`, `}`) excluded. */
type TemplatePiece = { start: number; end: number; text: string };

/** Every untagged template literal in a module that `looksLikeGlsl`. */
export function findGlslTemplates(code: string, fileName: string): TemplatePiece[][] {
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: TemplatePiece[][] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      if (!ts.isTaggedTemplateExpression(node.parent)) {
        const tokens = ts.isTemplateExpression(node) ? [node.head, ...node.templateSpans.map((s) => s.literal)] : [node];
        const pieces = tokens.map((tok) => {
          const start = tok.getStart(sf) + 1;
          const end = code[tok.end - 1] === "`" ? tok.end - 1 : tok.end - 2;
          return { start, end, text: code.slice(start, end) };
        });
        if (looksLikeGlsl(pieces.map((p) => p.text))) found.push(pieces);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Strips one template's pieces, in order: a comment still open at the end
 *  of a piece (split by an interpolation) is carried into the next piece and
 *  kept verbatim until it closes. */
export function stripGlslPieces(pieces: readonly string[]): string[] {
  let inBlock = false;
  let inLine = false;
  return pieces.map((raw) => {
    let out = "";
    let i = 0;
    if (inBlock || inLine) {
      const close = inBlock ? raw.indexOf("*/") : raw.indexOf("\n");
      if (close === -1) return raw;
      i = inBlock ? close + 2 : close;
      out = raw.slice(0, i);
      inBlock = false;
      inLine = false;
    }
    while (i < raw.length) {
      if (raw.startsWith("/*", i)) {
        const close = raw.indexOf("*/", i + 2);
        if (close === -1) {
          out += raw.slice(i);
          inBlock = true;
          break;
        }
        const newlines = raw.slice(i, close).replace(/[^\n]/g, "");
        out += newlines === "" ? " " : newlines;
        i = close + 2;
      } else if (raw.startsWith("//", i)) {
        const close = raw.indexOf("\n", i);
        if (close === -1) {
          out += raw.slice(i);
          inLine = true;
          break;
        }
        i = close;
      } else {
        out += raw[i];
        i++;
      }
    }
    return out
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/([^ \t\n])[ \t]{2,}(?=[^ \t\n])/g, "$1 ");
  });
}

/** A module's source with every GLSL template stripped, or null when there
 *  was nothing to strip. */
export function stripGlslTemplates(code: string, fileName: string): string | null {
  if (!code.includes("`")) return null;
  const edits: TemplatePiece[] = [];
  for (const pieces of findGlslTemplates(code, fileName)) {
    const stripped = stripGlslPieces(pieces.map((p) => p.text));
    pieces.forEach((p, k) => {
      if (stripped[k] !== p.text) edits.push({ ...p, text: stripped[k] });
    });
  }
  if (edits.length === 0) return null;
  edits.sort((a, b) => b.start - a.start);
  let out = code;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Build-only (see vite.config.ts): rewrites the app's own `.ts` modules
 *  under `src/`, before Vite's TypeScript transform sees them. */
export function glslStripPlugin(): Plugin {
  let srcDir = "";
  return {
    name: "viz-glsl-strip",
    apply: "build",
    enforce: "pre",
    configResolved(config) {
      srcDir = `${config.root}/src/`;
    },
    transform(code, id) {
      if (!id.startsWith(srcDir) || !id.endsWith(".ts")) return null;
      const out = stripGlslTemplates(code, id);
      return out === null ? null : { code: out, map: null };
    },
  };
}
