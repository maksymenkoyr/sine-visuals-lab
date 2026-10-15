/**
 * vite-glsl-strip-plugin.ts: the rules its header promises, on small fixture
 * modules, and the invariant that matters, on every module in src/:
 * stripping changes no GLSL token and no line count.
 *
 * Fixtures are built from plain strings — BT is a backtick and I() spells an
 * interpolation out — so the module under test sees exactly the text written
 * here.
 */
import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findGlslTemplates, stripGlslPieces, stripGlslTemplates } from "../vite-glsl-strip-plugin.ts";

const BT = "`";
const I = (expr: string): string => "$" + "{" + expr + "}";

/** A module whose one export is a template literal with this text. */
const mod = (text: string): string => "export const FRAG = " + BT + text + BT + ";\n";

/** The template's text after stripping (unchanged when nothing was stripped). */
const stripped = (text: string): string => {
  const out = stripGlslTemplates(mod(text), "fixture.ts");
  return out === null ? text : out.slice(out.indexOf(BT) + 1, out.lastIndexOf(BT));
};

const SHADER = [
  "#version 300 es",
  "precision highp float;",
  "  // what this shader draws",
  "#define TAPS 4",
  "uniform float uLevel;   /* 0..1 */",
  "/* a block comment",
  "   over two lines */",
  "void main() {",
  "    float a  =   uLevel * 2.0;  // doubled",
  "    outColor = vec4(a);",
  "}",
  "",
].join("\n");

describe("stripGlslTemplates", () => {
  it("drops comments, indentation and repeated spaces but keeps every line", () => {
    expect(stripped(SHADER)).toBe(
      [
        "#version 300 es",
        "precision highp float;",
        "",
        "#define TAPS 4",
        "uniform float uLevel;",
        "",
        "",
        "void main() {",
        "float a = uLevel * 2.0;",
        "outColor = vec4(a);",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("keeps a comment an interpolation splits, and the spaces next to an interpolation", () => {
    const text = "uniform float " + I("name") + ";\n  // " + I("taps") + " taps\nvoid main() {\n  x = 1.0;\n}\n";
    expect(stripped(text)).toBe("uniform float " + I("name") + ";\n// " + I("taps") + " taps\nvoid main() {\nx = 1.0;\n}\n");
  });

  it("leaves a template that isn't GLSL alone", () => {
    expect(stripGlslTemplates(mod(".tile {\n  color: red; /* note */\n}\n"), "fixture.ts")).toBeNull();
    expect(stripGlslTemplates(mod("No uniform buffer here.\nSee https://example.com/help\n"), "fixture.ts")).toBeNull();
    expect(stripGlslTemplates(mod("uniform float uA; // one line"), "fixture.ts")).toBeNull();
  });

  it("leaves a template with a backslash before a newline alone", () => {
    expect(stripGlslTemplates(mod("#define TWO(x) \\\n  (x * 2.0)\nvoid main() {}\n"), "fixture.ts")).toBeNull();
  });

  it("leaves a tagged template alone", () => {
    expect(stripGlslTemplates("export const FRAG = String.raw" + BT + SHADER + BT + ";\n", "fixture.ts")).toBeNull();
  });

  it("has nothing left to strip the second time", () => {
    const once = stripGlslTemplates(mod(SHADER), "fixture.ts");
    expect(once).not.toBeNull();
    expect(stripGlslTemplates(once ?? "", "fixture.ts")).toBeNull();
  });
});

describe("every GLSL template in src/", () => {
  // src/render/scenes/private/ is a gitignored checkout of a separate,
  // private repo (src/render/scenes/privateScenes.ts) — not ours to read.
  const files = globSync("src/**/*.ts").filter((f) => !f.startsWith("src/render/scenes/private/"));
  /** GLSL tokens: comments out (whichever opens first wins), split on whitespace. */
  const tokens = (text: string): string[] =>
    text
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ")
      .split(/\s+/)
      .filter((t) => t !== "");

  it("keeps its tokens and its line count when stripped", () => {
    let templates = 0;
    for (const file of files) {
      for (const pieces of findGlslTemplates(readFileSync(file, "utf8"), file)) {
        templates++;
        const before = pieces.map((p) => p.text).join("\u0000");
        const after = stripGlslPieces(pieces.map((p) => p.text)).join("\u0000");
        expect(tokens(after), file).toEqual(tokens(before));
        expect(after.split("\n").length, file).toBe(before.split("\n").length);
      }
    }
    // The scenes hold far more than this; finding none would pass vacuously.
    expect(templates).toBeGreaterThan(100);
  });
});
