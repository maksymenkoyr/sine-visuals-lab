"""Sky: sets named constants in sky.ts for a tuning round.

Handles GLSL `const float NAME = v;` and TS `const NAME = v;` lines, and
DRIFTER_SEEDS given as a count. Prints each change; fails on a name it
can't find exactly once.

usage: python3 set_consts.py '{"CLOUD_LOW": 0.2, "DRIFTER_FORCE": 3, "DRIFTER_SEEDS": 12}'
Written 2026-09-27 for the scattered-cumulus tuning.
"""
import json
import re
import sys

PATH = "src/render/scenes/sky/sky.ts"
src = open(PATH).read()
for name, value in json.loads(sys.argv[1]).items():
    if name == "DRIFTER_SEEDS":
        seeds = ", ".join(str(i) for i in range(1, int(value) + 1))
        pat = re.compile(r"(const DRIFTER_SEEDS: readonly number\[\] = \[)[^\]]*(\];)")
        rep = lambda m: m.group(1) + seeds + m.group(2)
    else:
        pat = re.compile(r"(const (?:float )?" + re.escape(name) + r" = )([-0-9.e]+)(;)")
        is_glsl = f"const float {name} =" in src
        text = f"{float(value):.4f}".rstrip("0") if is_glsl else repr(value)
        if is_glsl and text.endswith("."):
            text += "0"
        rep = lambda m, t=text: m.group(1) + t + m.group(3)
    found = pat.findall(src)
    if len(found) != 1:
        sys.exit(f"{name}: found {len(found)} times")
    src = pat.sub(rep, src)
    print(f"{name} = {value}")
open(PATH, "w").write(src)
