// The part of tools/fix-conflicts-auto.mjs that needs no git: read the text
// `git merge-file -p --diff3` prints and settle the conflicts a person would
// settle without thinking, so the model in tools/fix-conflicts.sh only ever
// sees the rest and a run that has nothing else costs no tokens at all.
//
// A conflict is settled here when
//   - both sides made the same change: keep it once;
//   - one side left the original lines alone: keep the other side's change
//     (git usually does this itself; the case costs nothing to cover);
//   - both sides only ADDED lines at the same spot (the original had nothing
//     there): keep both, upstream's first. This is the common one: two
//     branches each adding an entry to the same list, script table, import
//     block or "Next up" section.
// Anything else (both sides changed the same original lines differently) is
// a judgment and stays in the file as ordinary conflict markers, ours then
// theirs, for the model.

const MARKER = /^(<{7}|\|{7}|={7}|>{7})( .*)?$/;

/** Split diff3 text into plain runs and conflicts. A plain run is
 *  `{ lines }`; a conflict is `{ ours, base, theirs }`, each an array of
 *  lines that keep their trailing newline. */
export function parseDiff3(text) {
  const lines = text.split(/(?<=\n)/);
  const segments = [];
  let plain = [];
  let conflict = null;
  let part = null;
  for (const line of lines) {
    const m = MARKER.exec(line.replace(/\r?\n$/, ""));
    if (!conflict) {
      if (m && m[1] === "<<<<<<<") {
        if (plain.length) segments.push({ lines: plain });
        plain = [];
        conflict = { ours: [], base: [], theirs: [] };
        part = "ours";
      } else {
        plain.push(line);
      }
    } else if (m && m[1] === "|||||||") {
      part = "base";
    } else if (m && m[1] === "=======") {
      part = "theirs";
    } else if (m && m[1] === ">>>>>>>") {
      segments.push(conflict);
      conflict = null;
      part = null;
    } else {
      conflict[part].push(line);
    }
  }
  if (conflict) throw new Error("unterminated conflict");
  if (plain.length) segments.push({ lines: plain });
  return segments;
}

const same = (a, b) => a.length === b.length && a.every((line, i) => line === b[i]);

/** A line that is the last of a file may lack its newline; add one so two
 *  runs of lines can follow each other. */
function endWithNewline(lines) {
  if (!lines.length) return lines;
  const last = lines[lines.length - 1];
  return last.endsWith("\n") ? lines : [...lines.slice(0, -1), `${last}\n`];
}

/** The lines that replace a conflict, or null when it needs judgment. */
function settle({ ours, base, theirs }) {
  if (same(ours, theirs)) return ours;
  if (same(ours, base)) return theirs;
  if (same(theirs, base)) return ours;
  if (base.length === 0) return [...endWithNewline(ours), ...theirs];
  return null;
}

/** Settle every conflict in `segments` that `settle` can. Returns the file's
 *  new text and how many conflicts it settled and left (left ones carry
 *  `<<<<<<< ours` / `=======` / `>>>>>>> theirs` markers). */
export function resolveSegments(segments) {
  let text = "";
  let settled = 0;
  let left = 0;
  for (const segment of segments) {
    if (segment.lines) {
      text += segment.lines.join("");
      continue;
    }
    const lines = settle(segment);
    if (lines) {
      settled++;
      text += lines.join("");
    } else {
      left++;
      text += `<<<<<<< ours\n${endWithNewline(segment.ours).join("")}=======\n${endWithNewline(segment.theirs).join("")}>>>>>>> theirs\n`;
    }
  }
  return { text, settled, left };
}

/** Files the pre-pass may settle. Code is included on purpose: two branches
 *  each adding an import or a registry entry is the typical conflict, and the
 *  pre-push hook (`npm run check`) still type-checks the result. The lockfile
 *  is never merged by hand; a model regenerates or picks a side. */
export function autoResolvable(path) {
  if (/(^|\/)package-lock\.json$/.test(path)) return false;
  return /\.(md|txt|json|ya?ml|ts|mjs|js|css|html|sh)$/.test(path);
}
