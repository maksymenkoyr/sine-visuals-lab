#!/usr/bin/env python3
"""Where Caustics' GPU time goes, and whether an optimisation changed the picture.

Used for the 2026-09-28 spray-loop fix (see the record's Decisions entry).
Each variant is a set of text substitutions on src/render/scenes/caustics.ts
that switches one part of FRAG off; the script applies it, times it with
tools/gpu-bench.mjs, and restores the file — always, even on error. Needs
`npm run dev -- --port P` running from the same checkout.

  python3 docs/scenes/caustics/scripts/shader-bisect.py --port P base noSpray base noLoop base
      Median GPU ms per 3024x1890 frame for each variant, in the order given.
      Interleave `base` between variants: GPU clocks drift over a run.

  python3 docs/scenes/caustics/scripts/shader-bisect.py --port P --pixdiff main
      Renders the same deterministic frames with caustics.ts as of <ref> and
      as in the working tree, and counts changed pixels; also against the
      working tree with the spray switched off, to show the spray was
      actually on screen in the frames compared.

The substitution strings match FRAG as of that fix; a variant whose text is
gone fails loudly instead of silently timing the unmodified shader.
"""
import json, pathlib, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[4]
SRC = ROOT / "src/render/scenes/caustics.ts"
BENCH = ROOT / "tools/gpu-bench.mjs"

VARIANTS = {
    "base": [],
    "flat": [("vec2 uv = roomUv(vUv);", "outColor = vec4(vUv, 0.0, 1.0); return;\n  vec2 uv = roomUv(vUv);")],
    "noSpray": [("if (sprayGain > 0.0) {", "if (false) {")],
    "noLoop": [("int iterations = int(mix(3.0, 6.0, uDetail));", "int iterations = 0;")],
    "noRipple": [("float ringCrestRaw = rippleSampleCrest(pLen);", "float ringCrestRaw = 0.0;"),
                 ("float ringSlopeRaw = rippleSampleSlope(pLen);", "float ringSlopeRaw = 0.0;")],
    "noSparkle": [("float sparkleNoise = noise(sparkleQ * sparkleFreq + sparkleFlow);", "float sparkleNoise = 0.5;")],
    "noFwidth": [("float aaSharp = min(sharp, 0.3 / max(fwidth(v), 1e-4));", "float aaSharp = sharp;")],
    # Upper bound on any hash speed-up: a near-free (and wrong-looking) hash.
    "freeHash": [("float a = hashCell(i, ${NOISE_MASK}, 0u);", "float a = fract(dot(i, vec2(0.1234, 0.5678)));"),
                 ("float b = hashCell(i + vec2(1.0, 0.0), ${NOISE_MASK}, 0u);", "float b = fract(dot(i, vec2(0.1234, 0.5678)) + 0.1234);"),
                 ("float c = hashCell(i + vec2(0.0, 1.0), ${NOISE_MASK}, 0u);", "float c = fract(dot(i, vec2(0.1234, 0.5678)) + 0.5678);"),
                 ("float d = hashCell(i + vec2(1.0, 1.0), ${NOISE_MASK}, 0u);", "float d = fract(dot(i, vec2(0.1234, 0.5678)) + 0.6912);")],
}


def apply(src, name):
    for a, b in VARIANTS[name]:
        if a not in src:
            sys.exit(f"variant {name}: FRAG no longer contains {a!r}")
        src = src.replace(a, b)
    return src


def bench(port, *extra):
    out = subprocess.run(["node", str(BENCH), "--port", port, "--scenes", "caustics", *extra],
                         capture_output=True, text=True, timeout=600, cwd=ROOT)
    if out.returncode:
        sys.exit(out.stderr)
    return out.stdout


def main():
    args = sys.argv[1:]
    port = args[args.index("--port") + 1] if "--port" in args else "5173"
    rest = [a for i, a in enumerate(args) if a != "--port" and (i == 0 or args[i - 1] != "--port")]
    original = SRC.read_text()

    def render(src):
        SRC.write_text(src)
        time.sleep(0.5)  # let Vite's watcher see the write

    try:
        if rest and rest[0] == "--pixdiff":
            ref = rest[1] if len(rest) > 1 else "HEAD"
            old = subprocess.run(["git", "show", f"{ref}:src/render/scenes/caustics.ts"],
                                 capture_output=True, text=True, check=True, cwd=ROOT).stdout
            frames = "30,75,140"
            with tempfile.TemporaryDirectory() as tmp:
                for name, src in (("old", old), ("new", original), ("nospray", apply(original, "noSpray"))):
                    render(src)
                    bench(port, "--w", "1280", "--h", "720", "--dump", frames, "--out", f"{tmp}/{name}")
                for f in frames.split(","):
                    for a, b in (("old", "new"), ("new", "nospray")):
                        cmp = subprocess.run(["node", str(BENCH), "--compare", f"{tmp}/{a}/caustics-{f}.rgba", f"{tmp}/{b}/caustics-{f}.rgba"],
                                             capture_output=True, text=True, cwd=ROOT).stdout.strip()
                        print(f"frame {f:>3}  {a:>3} vs {b:<7}  {cmp}")
            return
        for name in rest or ["base"]:
            render(apply(original, name))
            line = [l for l in bench(port, "--w", "3024", "--h", "1890", "--frames", "40").splitlines() if l.startswith("caustics")]
            print(f"{name:10s} {line[0][len('caustics'):].strip() if line else '?'}", flush=True)
    finally:
        SRC.write_text(original)


main()
