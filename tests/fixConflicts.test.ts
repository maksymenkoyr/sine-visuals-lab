import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { autoResolvable, parseDiff3, resolveSegments } from "../tools/fixConflictsLib.mjs";

const diff3 = (before: string, ours: string, base: string, theirs: string, after = "") =>
  `${before}<<<<<<< ours\n${ours}||||||| base\n${base}=======\n${theirs}>>>>>>> theirs\n${after}`;

describe("resolveSegments", () => {
  it("keeps both sides when both only added lines, upstream first", () => {
    const text = diff3("a\n", "from main\n", "", "from branch\n", "z\n");
    const r = resolveSegments(parseDiff3(text));
    expect(r).toEqual({ text: "a\nfrom main\nfrom branch\nz\n", settled: 1, left: 0 });
  });

  it("keeps one copy when both sides made the same change", () => {
    const r = resolveSegments(parseDiff3(diff3("", "x\n", "w\n", "x\n")));
    expect(r.text).toBe("x\n");
    expect(r.left).toBe(0);
  });

  it("takes the side that changed when the other left the original alone", () => {
    const r = resolveSegments(parseDiff3(diff3("", "w\n", "w\n", "x\n")));
    expect(r.text).toBe("x\n");
  });

  it("leaves a real disagreement as ours/theirs markers", () => {
    const r = resolveSegments(parseDiff3(diff3("a\n", "one\n", "w\n", "two\n", "z\n")));
    expect(r).toEqual({
      text: "a\n<<<<<<< ours\none\n=======\ntwo\n>>>>>>> theirs\nz\n",
      settled: 0,
      left: 1,
    });
  });

  it("settles the easy conflicts of a file and leaves the hard one", () => {
    const text = `${diff3("", "a\n", "", "b\n", "mid\n")}${diff3("", "one\n", "w\n", "two\n")}`;
    const r = resolveSegments(parseDiff3(text));
    expect(r.settled).toBe(1);
    expect(r.left).toBe(1);
    expect(r.text.startsWith("a\nb\nmid\n<<<<<<< ours\n")).toBe(true);
  });

  it("joins an inserted last line that has no newline", () => {
    const conflict = { ours: ["last"], base: [], theirs: ["more\n"] };
    expect(resolveSegments([conflict]).text).toBe("last\nmore\n");
  });

  it("rejects text that stops inside a conflict", () => {
    expect(() => parseDiff3("<<<<<<< ours\nx\n")).toThrow("unterminated");
  });
});

describe("fix-conflicts-auto.mjs in a stopped rebase", () => {
  it("settles list additions without a model and leaves a real disagreement", () => {
    const dir = mkdtempSync(join(tmpdir(), "fc-test-"));
    // Run from a git hook (pre-push), GIT_DIR and friends point at this repo; the temp repo must not inherit them.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    try {
      git("init", "-q", "-b", "main");
      writeFileSync(join(dir, "list.md"), "# list\n- a\n");
      writeFileSync(join(dir, "code.ts"), "export const x = 1;\n");
      writeFileSync(join(dir, "package-lock.json"), '{"v":1}\n');
      git("add", ".");
      git("commit", "-q", "-m", "base");
      git("checkout", "-q", "-b", "feature");
      writeFileSync(join(dir, "list.md"), "# list\n- a\n- from feature\n");
      writeFileSync(join(dir, "code.ts"), "export const x = 2;\n");
      writeFileSync(join(dir, "package-lock.json"), '{"v":3}\n');
      git("commit", "-qam", "feature");
      git("checkout", "-q", "main");
      writeFileSync(join(dir, "list.md"), "# list\n- a\n- from main\n");
      writeFileSync(join(dir, "code.ts"), "export const x = 3;\n");
      writeFileSync(join(dir, "package-lock.json"), '{"v":2}\n');
      git("commit", "-qam", "main");
      git("checkout", "-q", "feature");
      expect(() => git("rebase", "main")).toThrow();

      const out = execFileSync("node", [join(process.cwd(), "tools/fix-conflicts-auto.mjs")], { cwd: dir, env, encoding: "utf8" });
      expect(out).toContain("auto-resolved list.md");
      expect(readFileSync(join(dir, "list.md"), "utf8")).toBe("# list\n- a\n- from main\n- from feature\n");
      // A real disagreement and the lockfile stay for the model, still conflicted.
      expect(git("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean).sort()).toEqual(["code.ts", "package-lock.json"]);
      expect(readFileSync(join(dir, "code.ts"), "utf8")).toContain("<<<<<<<");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("autoResolvable", () => {
  it("covers docs, config and code but never the lockfile", () => {
    expect(autoResolvable("docs/status.md")).toBe(true);
    expect(autoResolvable("package.json")).toBe(true);
    expect(autoResolvable("src/render/scenes/index.ts")).toBe(true);
    expect(autoResolvable("package-lock.json")).toBe(false);
    expect(autoResolvable("assets/logo.png")).toBe(false);
  });
});
