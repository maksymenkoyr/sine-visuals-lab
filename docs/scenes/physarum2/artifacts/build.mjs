// Inlines ./engine.js at /*ENGINE*/ and ./strainPreview.js at /*PREVIEW*/
// into lab.src.html, writing ./physarum2-controls.html. Run with:
//   node build.mjs
import { readFile, writeFile } from "node:fs/promises";

const dir = new URL(".", import.meta.url);
const [src, engine, preview] = await Promise.all([
  readFile(new URL("lab.src.html", dir), "utf8"),
  readFile(new URL("engine.js", dir), "utf8"),
  readFile(new URL("strainPreview.js", dir), "utf8"),
]);

if (!src.includes("/*ENGINE*/")) throw new Error("lab.src.html is missing the /*ENGINE*/ marker");
if (!src.includes("/*PREVIEW*/")) throw new Error("lab.src.html is missing the /*PREVIEW*/ marker");

const out = src
  .replace("/*ENGINE*/", () => engine)
  .replace("/*PREVIEW*/", () => preview);

const outUrl = new URL("physarum2-controls.html", dir);
await writeFile(outUrl, out, "utf8");
console.log("built", outUrl.pathname);
