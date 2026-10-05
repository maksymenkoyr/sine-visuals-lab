"""Release Shape compiler: <work>/lines.json (+ plan.json) -> <work>/cuts.json.

    python3 tools/promo/shapes/release.py --work DIR [--drop-beat N] [--print-segs]

The release video is the last Stable release's changes played over the user's song (.claude/commands/
video-release.md says why): the opening look, the version card, the demos with one caption each, every
group of changes as a list card, then the scene holding to a bar line. This file lays that out on the song's
beats, replaying the arithmetic of the approved v0.2.0 compose.py in the same order, so the floats match.

Reads <work>: song.json (tempo), lines.json {title, subtitle, demos:[{take, from?, beats, group, text}],
groups:[{key, title, rows}]} (shapes/release.example.json is a copy), plan.json (optional):

  { "intro": {"take": "intro", "t0": 0}, "look": 3, "version": 6, "dwell": 2, "row": 0.5, "hold": 2,
    "end": 6, "scenes": ["intro", "song_cau", "song_chl", "song_p2r"] }

The defaults are the constants below. look/version = beats of the opening and of the version card, dwell =
beats a list shows its first rows before it scrolls, row = beats per scroll step, hold = beats it rests on
its last rows, end = the least beats held after the last list, scenes = the takes behind the groups, in
turn. The rows a list shows at once come from style.json (videos.release.list.visible). The drop goes on
the first demo: --drop-beat or look + version.

--print-segs prints the segments in the shape tools/promo/regress.py compares and writes nothing.
"""
import json, math, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import cuts

CAP_Y = 1340     # the caption's top: above the band Stories covers (2b1faf9b compose.py CAP_Y)


def compile_release(work, drop_beat=None):
    sty = cuts.style()["videos"]["release"]
    song = cuts.song(work)
    P = 60.0 / song["bpm"]
    FPS = sty["fps"]
    plan = json.load(open(f"{work}/plan.json")) if os.path.exists(f"{work}/plan.json") else {}
    LOOK, VERSION, ROW, HOLD = plan.get("look", 3), plan.get("version", 6), plan.get("row", 0.5), plan.get("hold", 2)
    DWELL, END = plan.get("dwell", 2), plan.get("end", 6)
    VISIBLE = sty["list"]["visible"]
    LINES = json.load(open(f"{work}/lines.json"))
    groups = [dict(key=g["key"], n=len(g["rows"])) for g in LINES.get("groups", [])]
    def list_steps(n): return max(0, n - VISIBLE)
    def list_beats(n): return math.ceil(DWELL + list_steps(n) * ROW) + HOLD
    DROP_BEAT = int(drop_beat or LOOK + VERSION)
    SS = song["dropTime"] - DROP_BEAT * P

    INTRO = plan.get("intro") or {"take": "intro", "t0": 0}
    SCENE_POOL = plan.get("scenes") or ["intro", "song_cau", "song_chl", "song_p2r"]

    SEGS = [("look", (INTRO["take"], INTRO["t0"]), None, LOOK), ("version", (INTRO["take"], INTRO["t0"] + LOOK), None, VERSION)]
    for i, d in enumerate(LINES.get("demos", [])):
        SEGS.append(("demo", (d["take"], d.get("from", 0)), i, d["beats"]))
    for k, g in enumerate(groups):
        SEGS.append(("list", (SCENE_POOL[k % len(SCENE_POOL)], 0), g, list_beats(g["n"])))
    end = END
    while (sum(sg[3] for sg in SEGS) + end - DROP_BEAT) % 4: end += 1
    SEGS.append(("end", (SEGS[-1][1][0], 0), None, end))
    TOTAL_BEATS = sum(sg[3] for sg in SEGS)

    segments, b0 = [], 0
    demos = LINES.get("demos", [])
    for kind, (tk, tb), arg, dur in SEGS:
        layers, text, group = [], "", None
        if kind == "version":
            layers = [dict(op="card", png="intro.png", at=0)]
            text = LINES.get("title", "")
        elif kind == "demo":
            layers = [dict(op="caption", png=f"demo_{arg}.png", prev=f"demo_{arg - 1}.png" if arg > 0 else None, y=CAP_Y, bottom=None)]
            text, group = demos[arg]["text"], demos[arg].get("group")
        elif kind == "list":
            layers = [dict(op="list", key=arg["key"], n=arg["n"])]
            text = next((g["title"] for g in LINES["groups"] if g["key"] == arg["key"]), arg["key"])
            group = arg["key"]
        segments.append(cuts.segment(kind, tk, tb, dur, b0, layers, text, group))
        b0 += dur
    n_frames = round(TOTAL_BEATS * P * FPS)
    d = dict(schema=1, video="release", work=os.path.abspath(work), renderer=sty["renderer"], fps=FPS, formats=sty["formats"],
             maxSec=sty["maxSec"], lag=sty["lag"], dropBeat=DROP_BEAT,
             song=dict(file=song["file"], bpm=song["bpm"], dropTime=song["dropTime"]),
             frames=dict(ss=SS, totalBeats=TOTAL_BEATS, endBeats=end, nFrames=n_frames, list=dict(dwell=DWELL, row=ROW), segments=segments))
    return d, SEGS, P


def main(argv):
    if "--work" not in argv:
        sys.exit("usage: release.py --work DIR [--drop-beat N] [--print-segs]")
    work = os.path.abspath(argv[argv.index("--work") + 1])
    drop = argv[argv.index("--drop-beat") + 1] if "--drop-beat" in argv else None
    d, SEGS, P = compile_release(work, drop)
    f = d["frames"]
    if "--print-segs" in argv:
        print(json.dumps(dict(segs=[[sg[0], sg[1][0], sg[1][1], sg[3]] for sg in SEGS], totalBeats=f["totalBeats"],
                              endBeats=f["endBeats"], dropBeat=d["dropBeat"], nFrames=f["nFrames"]), indent=1))
        return
    cuts.write_cuts(work, d)
    print(f"{f['totalBeats']} beats ({f['endBeats']} held at the end) = {f['totalBeats'] * P:.3f}s = {f['nFrames']} frames @ {d['fps']}; drop on beat {d['dropBeat']}")


if __name__ == "__main__":
    main(sys.argv[1:])
