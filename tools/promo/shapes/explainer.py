"""Explainer Shape compiler: <work>/showcase.json -> the `graph` section of <work>/cuts.json.

    python3 tools/promo/shapes/explainer.py --work DIR

The explainer is a calm 9:16 + 16:9 video for someone already interested: intro, gallery, the drop, the
wiring, optional feature chapters, a shuffle of scene shots, an end card (.claude/commands/video-explainer.md
says why). This file turns showcase.json (showcase/showcase.example.json is the schema) into one cut list per
format, copying showcase/edit.py's timeline arithmetic verbatim, in the same order, so the floats are
bit-equal and edit.py can render the result without recomputing it.

Added to that arithmetic:
- `chapters` [{id, shots:[[clip, bars]]}] are cut on the bed's beat grid right after the wiring, like the
  drop's shots; each id is a caption anchor at the video time its first shot starts. With none, nothing
  changes.
- a clip window of 'auto' is read from <clips.dir>/<name>-<fmt>.mp4.json, key songAtClip0 (capture.mjs writes it).

Per format the graph holds {V, A, C, FADE, END, bed_len, total, anchors}; graph also carries songs, the
loudness target, the caps dir and each caption's text (the plan table prints them). showcase.json's `work`
must be DIR.
"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import cuts

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))


def _work(cfg):
    work = cfg.get("work", "tools/.cache/showcase")
    return work if os.path.isabs(work) else os.path.join(REPO, work)


def _p(cfg, rel):
    """A config path: absolute stays, relative is under the work dir (showcase/config.py p)."""
    return rel if os.path.isabs(rel) else os.path.join(cfg["_work"], rel)


def _windows(cfg, fmt):
    win = dict(cfg["clips"]["windows"])
    for name, w in win.items():
        if w == "auto":
            side = json.load(open(f"{_p(cfg, cfg['clips']['dir'])}/{name}-{fmt}.mp4.json"))
            win[name] = side["songAtClip0"]
    return win


def graph_for(cfg, fmt):
    BED = cfg["bed"]
    BEAT = 60 / BED["bpm"]
    BAR = 4 * BEAT
    DROP = BED["drop"]  # song time where the bass enters, on the beat grid

    def clip(name):
        return f"{_p(cfg, cfg['clips']['dir'])}/{name}-{fmt}.mp4"

    WIN = _windows(cfg, fmt)  # song time at clip t=0

    # --- video pieces: (file, in, dur)
    V = []
    _im = json.load(open(_p(cfg, f"intro-{fmt}.mp4.json")))
    INTRO_ZOOM, MARKS = _im["dur"], _im["marks"]
    V.append((_p(cfg, f"intro-{fmt}.mp4"), 0, INTRO_ZOOM))
    GAL_DUR = json.load(open(_p(cfg, f"gallery-{fmt}.mp4.json")))["dur"]
    V.append((_p(cfg, f"gallery-{fmt}.mp4"), 0, GAL_DUR))
    INTRO = INTRO_ZOOM + GAL_DUR
    s = DROP
    for name, bars in cfg["drop"]["shots"]:
        d = bars * BAR
        V.append((clip(name), s - WIN[name], d))
        s += d
    drop_bars = sum(bars for _, bars in cfg["drop"]["shots"])
    assert abs(s - (DROP + drop_bars * BAR)) < 1e-6
    WR = cfg["wiring"]
    w0 = s - WR["t0"]
    if fmt == "h":
        V.append((_p(cfg, WR["h"]["cam"]), w0, WR["beats"] * BEAT))
    else:
        beat = lambda k: w0 + k * BEAT
        for col, k0, k1 in WR["v"]["plan"]:
            V.append((_p(cfg, WR["v"]["takes"][col]), beat(k0), beat(k1) - beat(k0)))
    # chapters: shots on the bed's grid after the wiring, cut like the drop's
    s += WR["beats"] * BEAT
    chapters, chap_bars = {}, 0
    for ch in cfg.get("chapters", []):
        chapters[ch["id"]] = INTRO + drop_bars * BAR + WR["beats"] * BEAT + chap_bars * BAR
        for name, bars in ch["shots"]:
            d = bars * BAR
            V.append((clip(name), s - WIN[name], d))
            s += d
            chap_bars += bars
    bed_len = sum(d for _, _, d in V)
    SHOT = cfg["shuffle"]["shot"]
    END = cfg["end"]["length"]
    shuffle = [tuple(x) for x in cfg["shuffle"]["shots"]]
    for name, _, st in shuffle:
        V.append((clip(name), st - WIN[name], SHOT))
    total = sum(d for _, _, d in V) + END

    A = [(BED["song"], DROP - INTRO, bed_len)] + [(sid, st, SHOT) for _, sid, st in shuffle]
    A[-1] = (A[-1][0], A[-1][1], SHOT + END)

    ANCHORS = {"start": 0.0, "introCut": MARKS[1], "introEnd": MARKS[2], "galleryEnd": INTRO,
               "wiringStart": INTRO + drop_bars * BAR, "shuffleStart": bed_len}
    ANCHORS.update(chapters)
    C = [(c["id"], ANCHORS[c["from"][0]] + c["from"][1], ANCHORS[c["to"][0]] + c["to"][1]) for c in cfg["captions"]["items"]]
    FADE = {c["id"]: c["fade"] for c in cfg["captions"]["items"]}
    return dict(V=V, A=A, C=C, FADE=FADE, END=END, bed_len=bed_len, total=total, anchors=ANCHORS)


def caption_text(item):
    return " - ".join(x.replace("<br>", " ") for x in (item.get("big"), item.get("small")) if x)


def compile_explainer(work):
    sty = cuts.style()["videos"]["explainer"]
    cfg = json.load(open(f"{work}/showcase.json"))
    cfg["_work"] = _work(cfg)
    if os.path.abspath(cfg["_work"]) != os.path.abspath(work):
        sys.exit(f"showcase.json work is {cfg['_work']}, not {work}")
    graph = dict(songs={k: _p(cfg, v) for k, v in cfg["songs"].items()}, loudnessLufs=cfg["loudnessLufs"],
                 caps=f"{work}/caps", texts={c["id"]: caption_text(c) for c in cfg["captions"]["items"]})
    for fmt in sty["formats"]:
        graph[fmt] = graph_for(cfg, fmt)
    return dict(schema=1, video="explainer", work=os.path.abspath(work), renderer=sty["renderer"], fps=sty["fps"],
                formats=sty["formats"], maxSec=sty["maxSec"], graph=graph)


def main(argv):
    if "--work" not in argv:
        sys.exit("usage: explainer.py --work DIR")
    work = os.path.abspath(argv[argv.index("--work") + 1])
    d = compile_explainer(work)
    cuts.write_cuts(work, d)
    for fmt in d["formats"]:
        g = d["graph"][fmt]
        print(f"{fmt}: {len(g['V'])} pieces, bed {g['bed_len']:.3f}s, total {g['total']:.3f}s")


if __name__ == "__main__":
    main(sys.argv[1:])
