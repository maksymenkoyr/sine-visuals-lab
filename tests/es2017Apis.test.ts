import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The room's client files must run on an old TV browser. vite.config.ts's
 * build target (es2017) lowers syntax (`??`, `?.`, spread) but never the
 * runtime APIs a file calls, and the TS `lib` is newer than the target, so the
 * typechecker accepts all of these. This test is the net: it parses each file
 * (so a comment or a string that merely names an API is not a use) and fails on
 * the ones an old TV lacks.
 */

/** Files a TV, or a phone/TV loading the room code, runs: the room's new
 *  client modules, plus the two Worker files the client imports at runtime
 *  (server/*.ts is plain TS shared with the client). Add a file here when an
 *  old browser will load it. */
const FILES = [
  "server/lookDoc.ts",
  "server/roomRules.ts",
  "src/net/roomMessages.ts",
  "src/net/reconnect.ts",
  "src/net/realStorage.ts",
  "src/net/roomStorage.ts",
  "src/net/lookSync.ts",
  "src/net/pairing.ts",
  "src/net/sessions.ts",
  "src/net/adopt.ts",
  "src/net/hostRoom.ts",
  "src/net/bootPlan.ts",
  "src/net/tvPhase.ts",
  "src/net/pendingSlot.ts",
  "src/net/controllerLook.ts",
  "src/net/controllerPreview.ts",
  "src/net/screenJoin.ts",
  "src/net/roomCode.ts",
  "src/net/room.ts",
  "src/net/tvStorageBoot.ts",
  "src/net/controllerStorageBoot.ts",
  "src/ui/joinScreen.ts",
  "src/ui/wakeLock.ts", // was inline in tv.ts until it was shared with the app
  "src/tv.ts",
];

/** Methods newer than the target, banned on any receiver (the receiver's type
 *  is not known without a typechecker, and none of these is worth the risk). */
const BANNED_METHODS = new Set(["flat", "flatMap", "at", "replaceAll", "matchAll", "randomUUID"]);

/** `Receiver.member` pairs: the receiver is a global namespace we can name. */
const BANNED_MEMBERS: ReadonlyArray<readonly [string, string]> = [
  ["Object", "fromEntries"],
  ["Promise", "allSettled"],
  ["AbortSignal", "timeout"],
];

/** Globals newer than the target, banned wherever the identifier appears. */
const BANNED_GLOBALS = new Set(["structuredClone", "BigInt"]);

/** Each use of a banned API in `source`, as "<what> (line N)". */
function findBannedApis(source: string): string[] {
  const file = ts.createSourceFile("scanned.ts", source, ts.ScriptTarget.ES2022, true);
  const found: string[] = [];
  const report = (node: ts.Node, what: string): void => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    found.push(`${what} (line ${line + 1})`);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (BANNED_METHODS.has(name)) report(node, `.${name}()`);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const receiver = node.expression.text;
      const name = node.name.text;
      for (const [r, m] of BANNED_MEMBERS) if (receiver === r && name === m) report(node, `${r}.${m}`);
    }
    if (ts.isIdentifier(node) && BANNED_GLOBALS.has(node.text)) report(node, node.text);
    if (node.kind === ts.SyntaxKind.BigIntLiteral) report(node, "BigInt literal");
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("the es2017 runtime-API scanner", () => {
  it("finds every banned API", () => {
    const source = [
      "Object.fromEntries([]);",
      "[[1]].flat();",
      "[1].flatMap((x) => x);",
      "[1].at(0);",
      "'a'.replaceAll('a', 'b');",
      "'a'.matchAll(/a/g);",
      "structuredClone({});",
      "crypto.randomUUID();",
      "Promise.allSettled([]);",
      "BigInt(1);",
      "const n = 10n;",
      "AbortSignal.timeout(5);",
    ].join("\n");
    const found = new Set(findBannedApis(source).map((hit) => hit.replace(/ \(line \d+\)$/, "")));
    for (const what of [
      "Object.fromEntries",
      ".flat()",
      ".flatMap()",
      ".at()",
      ".replaceAll()",
      ".matchAll()",
      "structuredClone",
      ".randomUUID()",
      "Promise.allSettled",
      "BigInt",
      "BigInt literal",
      "AbortSignal.timeout",
    ]) {
      expect(found.has(what), what).toBe(true);
    }
  });

  it("reports the line", () => {
    expect(findBannedApis("const a = 1;\n\nObject.fromEntries([]);")).toEqual(["Object.fromEntries (line 3)"]);
  });

  it("ignores comments, strings and look-alikes", () => {
    const source = [
      "// Object.fromEntries and crypto.randomUUID() are banned; so is structuredClone",
      "/* arr.flat(), str.replaceAll('a', 'b'), BigInt(1) */",
      "const s = 'Promise.allSettled and AbortSignal.timeout(5)';",
      "const t = `x.at(0) ${s}`;",
      "const o = { flat: true, at: 1 };",
      "Object.entries(o); [1, 2].slice(0); 'a'.split('a'); Promise.all([]);",
    ].join("\n");
    expect(findBannedApis(source)).toEqual([]);
  });
});

describe("the room's client files", () => {
  it("use no runtime API the es2017 target leaves unlowered", () => {
    const failures: string[] = [];
    for (const path of FILES) {
      for (const hit of findBannedApis(readFileSync(path, "utf8"))) failures.push(`${path}: ${hit}`);
    }
    expect(failures).toEqual([]);
  });
});
