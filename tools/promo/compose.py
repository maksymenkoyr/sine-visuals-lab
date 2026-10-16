# Draws the video's frames from the resolved cut list: the cards laid over the recorded takes, every cut on a
# beat of the song. The Shape compilers (shapes/release.py, shapes/hook.py) decide what plays when; this file
# only draws it, so a new frames video needs a Shape and no change here.
#
#   uv run -q --with pillow==12.3.0 python tools/promo/compose.py --work DIR [--segments A-B]   (promo.mjs runs this)
#
# Reads <work>: cuts.json (renderer 'frames': fps, dropBeat, song tempo and drop time, lag, and
# frames.segments, each a take, its start beat, its length in beats and its layers), cards/ (cards.mjs, with
# its meta.json) and takes/ (capture.mjs --take). PROMO_WORK stands in for --work.
# Writes <work>/frames/00000.jpg ... + frames/meta.json {total, frames, fps, dropBeat}: constant frame rate,
# each frame taken from the NEAREST source frame (a repeated or late frame reads as lag).
#
# Section by section: each segment's frames are drawn into <work>/frames-cache/<key>/, the key hashing all
# that segment draws from (its entry in cuts.json and where it falls, the timing fields of cuts.json, the
# card PNGs and take files it reads, cards/meta.json and this file's source), and frames/ is hard links into
# the cache. So after an edit only the segments whose key changed are drawn again; a full run drops the
# cache entries it no longer uses. --segments A-B (1-based, as the plan table numbers them; promo.mjs
# render --section) draws only those segments and links them into <work>/preview/ instead, with
# preview/meta.json {start, total, frames, fps, dropBeat, segments}, `start` being the video time of its
# first frame; frames/ is left as it was.
#
# A segment's backdrop is the take's frame at the song time the video plays at that moment (scene takes heard
# the song, so the picture moves with the music you hear) or at the take's own beat (panel takes). A segment
# with backdrop 'devices' is the two-screen layout: a laptop with its Cue/Play keys over the second screen
# the segment names, from the takes <take>_main and <take>_out. Camera 'lean' zooms toward the tracked part
# of an interface take; any other camera is steady. Then the segment's layers, in order:
#   title    the PNG over the frame, when the file exists;
#   caption  {png, prev, y, bottom}: the caption slides in as the last one leaves, over a scrim. y is its
#            top, or bottom minus the card's height from cards/meta.json;
#   card     {png, at}: from beat `at` of the segment the frame dims and the card fades in over it;
#   list     {key, n}: the release's change list, a card whose rows scroll (scroller); its dwell and row
#            pace come from frames.list in cuts.json, its window from cards/meta.json.
# Nothing fades out unless a Shape says so. cuts.lag 'take' shifts a song take's source time by the
# reaction lag its frames.json records (meta.lagMs); 'none' draws the take as recorded.
import bisect, hashlib, json, math, os, shutil, sys
from PIL import Image, ImageDraw, ImageFilter

argv = sys.argv[1:]
_work = argv[argv.index("--work") + 1] if "--work" in argv else os.environ.get("PROMO_WORK")
if not _work: sys.exit("usage: compose.py --work DIR")
WORK = os.path.abspath(_work)
CUTS = json.load(open(f"{WORK}/cuts.json"))
if CUTS.get("renderer") != "frames": sys.exit(f"compose.py draws renderer 'frames', not {CUTS.get('renderer')!r}")
FPS = CUTS["fps"]
W, H = 1080, 1920
P = 60.0 / CUTS["song"]["bpm"]
DROP_BEAT = CUTS["dropBeat"]
SS = CUTS["song"]["dropTime"] - DROP_BEAT * P    # song time at video beat 0 (promo.mjs encode starts the song there)
LAG = CUTS.get("lag") == "take"
FR = CUTS["frames"]
SEGS = FR["segments"]
META = json.load(open(f"{WORK}/cards/meta.json"))
CARD, VISIBLE = META.get("card"), META.get("visible")             # the list card's row window (cards.mjs)
DWELL, ROW = (FR.get("list") or {}).get("dwell"), (FR.get("list") or {}).get("row")
def list_steps(n): return max(0, n - VISIBLE)

# the takes drawn as two screens: the controller's own take is <take>_main, the second screen's <take>_out
TWO = {s["take"]: s["second"] for s in SEGS if s["backdrop"] == "devices"}     # take -> the second screen's label

def load_take(name):
    real = f"{name}_main" if name in TWO else name
    d = f"{WORK}/takes/{real}"
    j = json.load(open(f"{d}/frames.json"))
    tk = dict(dir=d, t0=j["meta"]["epochT0"], ts=[f["t"] for f in j["frames"]], files=[f["file"] for f in j["frames"]],
              vw=(j["meta"].get("view") or {}).get("width", 576), songT0=j["meta"].get("songT0"), keys=j["meta"].get("keys", []),
              lagMs=j["meta"].get("lagMs"))
    tf = f"{d}/track.json"
    tk["track"] = json.load(open(tf)) if os.path.exists(tf) else []
    tk["track_ts"] = [r[0] for r in tk["track"]]
    return tk
takes = {}
def get(name):
    if name not in takes: takes[name] = load_take(name)
    return takes[name]

def src_time(tk, beat, video_beat=None):
    # a take that heard the song is cut at the song time the video plays here; others by their own beat
    t = tk["t0"] + (SS + video_beat * P - tk["songT0"] if tk["songT0"] is not None and video_beat is not None else beat * P)
    # the app reacts a little after the sound it hears (cuts.lag 'take'); a take with a key log is cut by its keys
    if LAG and tk["lagMs"] is not None and tk["songT0"] is not None and not tk["keys"]: t += tk["lagMs"] / 1000
    return t
def frame_at(name, beat, video_beat=None):
    tk = get(name)
    src_t = src_time(tk, beat, video_beat)
    k = bisect.bisect_left(tk["ts"], src_t)
    if k >= len(tk["ts"]) or (k > 0 and abs(tk["ts"][k - 1] - src_t) <= abs(tk["ts"][k] - src_t)): k = max(0, k - 1)
    return Image.open(f"{tk['dir']}/{tk['files'][k]}").convert("RGB")

def fit(im): return im if im.size == (W, H) else im.resize((W, H), Image.LANCZOS)

def tag_at(base, key, pos):
    t = png(f"label_{key}.png"); base.paste(t.convert("RGB"), pos, t.getchannel("A")); return base

# The two-screen proofs (capture.mjs take mode): drawn as devices — a laptop with its Cue (Space) and
# Play (Option) keys on the deck, lit while held, over the second screen it plays to, whose frame glows
# orange while Cue shows the laptop's look there and flashes green when Play sends it. Everything stays
# above the caption.
DEV_X, DEV_W, DEV_H, BEZEL, LAP_Y, OUT_Y = 120, 840, 473, 14, 262, 850
CUE_RGB, PLAY_RGB = (245, 165, 36), (63, 185, 80)              # the app's CUE and PLAY bar colours
def device(base, im, y, glow=0.0, rgb=PLAY_RGB):
    if glow > 0:
        g = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(g).rounded_rectangle((DEV_X - BEZEL - 8, y - BEZEL - 8, DEV_X + DEV_W + BEZEL + 8, y + DEV_H + BEZEL + 8),
                                            radius=26, outline=(*rgb, int(255 * glow)), width=12)
        g = g.filter(ImageFilter.GaussianBlur(9)); base.paste(g, (0, 0), g)
    ImageDraw.Draw(base).rounded_rectangle((DEV_X - BEZEL, y - BEZEL, DEV_X + DEV_W + BEZEL, y + DEV_H + BEZEL),
                                           radius=20, fill=(22, 25, 31), outline=(78, 84, 96), width=2)
    base.paste(im.resize((DEV_W, DEV_H), Image.LANCZOS), (DEV_X, y))
def keys_at(name, vb):
    tk = get(name); t = src_time(tk, 0, vb)
    down, play_up = {}, None
    for et, k, d in tk["keys"]:
        if et > t: break
        down[k] = d
        if k == "Alt" and not d: play_up = et
    # Cue (Space held) puts the laptop's look on the second screen while held: orange; Play: a green flash
    if down.get("Space"): return down, 1.0, CUE_RGB
    glow = 1.0 if down.get("Alt") else max(0.0, 1 - (t - play_up) / 0.6) if play_up else 0.0
    return down, glow, PLAY_RGB
def two_screens(name, b, vb):
    base = Image.new("RGB", (W, H), (6, 8, 13))
    down, glow, rgb = keys_at(name, vb)
    device(base, frame_at(name, b, vb), LAP_Y)
    y0 = LAP_Y + DEV_H + BEZEL                                 # the laptop's deck, with its two output keys
    ImageDraw.Draw(base).polygon([(DEV_X - BEZEL, y0), (DEV_X + DEV_W + BEZEL, y0), (DEV_X + DEV_W + 70, y0 + 66), (DEV_X - 70, y0 + 66)],
                                 fill=(34, 38, 46), outline=(80, 86, 98))
    ks, ko = png(f"key_space_{'on' if down.get('Space') else 'off'}.png"), png(f"key_option_{'on' if down.get('Alt') else 'off'}.png")
    x = (W - ks.width - 24 - ko.width) // 2
    base.paste(ks.convert("RGB"), (x, y0 + 4), ks.getchannel("A")); base.paste(ko.convert("RGB"), (x + ks.width + 24, y0 + 4), ko.getchannel("A"))
    device(base, frame_at(f"{name}_out", b, vb), OUT_Y, glow, rgb)
    tag_at(base, "laptop", (DEV_X + 10, LAP_Y + 10)); tag_at(base, TWO[name], (DEV_X + 10, OUT_Y + 10))
    return base
def backdrop(name, b, video_beat):
    if name in TWO: return two_screens(name, b, video_beat)
    return fit(frame_at(name, b, video_beat))

# ---- camera -----------------------------------------------------------------------------------------
def ease(t): t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)
def zoom(im, z, cx, cy):
    cw, ch = W / z, H / z
    x0 = min(max(cx - cw / 2, 0), W - cw); y0 = min(max(cy - ch / 2, 0), H - ch)
    return im.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch))
def track_box(tk, src_t, scale):
    k = bisect.bisect_right(tk["track_ts"], src_t) - 1
    if k < 0 or len(tk["track"][k]) != 5 or src_t - tk["track"][k][0] > 0.3: return None
    recent = [r for r in tk["track"][max(0, k - 2):k + 1] if len(r) == 5]
    r = [sum(x[i] for x in recent) / len(recent) for i in range(1, 5)]
    return [v * scale for v in r]
def camera(im, name, local, take_beat):
    if name.startswith("ui_"):
        tk = get(name)
        bx = track_box(tk, tk["t0"] + take_beat * P, W / tk["vw"])
        cx, cy = (bx[0] + bx[2] / 2, bx[1] + bx[3] / 2) if bx else (W * 0.62, H * 0.5)
        cx = W * 0.5 + (cx - W * 0.5) * 0.8; cy = H * 0.5 + (cy - H * 0.5) * 0.8
        return zoom(im, 1.0 + 0.40 * ease(local / 3), cx, cy)
    return im   # scene footage: a steady camera

# ---- layers -----------------------------------------------------------------------------------------
_png = {}
def png(path):
    if path not in _png: _png[path] = Image.open(f"{WORK}/cards/{path}").convert("RGBA")
    return _png[path]
def with_alpha(lay, a):
    lay = lay.copy(); lay.putalpha(lay.getchannel("A").point(lambda v: int(v * a))); return lay
def over(im, lay):
    o = im.convert("RGBA"); o.alpha_composite(lay); return o.convert("RGB")

_scrims = {}
def scrim(top, strength):   # darkens the bottom of the frame from `top` down, so the text reads
    if (top, strength) not in _scrims:
        a = Image.new("L", (W, H), 0); d = ImageDraw.Draw(a)
        for y in range(top, H): d.line((0, y, W, y), fill=int(strength * min(1, (y - top) / 300)))
        _scrims[(top, strength)] = a
    return _scrims[(top, strength)]
def darken(im, top, strength): return Image.composite(Image.new("RGB", im.size, (3, 5, 10)), im, scrim(top, strength))

def scroller(im, g, local):
    key, n, rh = g["key"], g["n"], CARD["row"]
    im = darken(im, CARD["y"] - 380, 170)
    o = im.convert("RGBA")
    fade = min(1.0, local * P / 0.2)
    chrome = png(f"chrome_{key}.png")
    o.alpha_composite(with_alpha(chrome, fade) if fade < 1 else chrome)
    k = (local - DWELL) / ROW
    s = 0.0 if k <= 0 else min(list_steps(n), math.floor(k) + ease((k % 1) / 0.6))   # ticks on each step
    win = Image.new("RGBA", (CARD["w"], (VISIBLE + 2) * rh), (0, 0, 0, 0))          # a row of margin each side
    for j in range(int(s), min(n, int(s) + VISIBLE + 1)):
        y = (j - s) * rh
        a = max(0.0, min(1.0, 1 + y / rh, 1 - (y - (VISIBLE - 1) * rh) / rh))       # out at the top, in at the bottom
        if a > 0: win.alpha_composite(with_alpha(png(f"row_{key}_{j}.png"), a * fade), (0, int(round(y)) + rh))
    o.alpha_composite(win.crop((0, rh, CARD["w"], (VISIBLE + 1) * rh)), (CARD["x"], CARD["y"]))
    return o.convert("RGB")

# a caption's slide-in: its distance (px) and time (s), and its left edge
CAP_X, CAP_SLIDE, CAP_T = 70, 300, 0.4
def caption(im, L, local):
    a = ease(local * P / CAP_T)
    prev, cur = png(L["prev"]) if L.get("prev") and a < 1 else None, png(L["png"]) if L.get("png") else None
    if not prev and not cur: return im
    y = L["y"] if L.get("y") is not None else L["bottom"] - META["cap"]["h"]
    im = darken(im, y - 160, int(150 * (1 if cur else 1 - a)))   # the band fades with a caption that leaves alone
    if prev:
        im.paste(prev.convert("RGB"), (int(CAP_X - a * CAP_SLIDE), y), prev.getchannel("A").point(lambda v: int(v * (1 - a))))
    if cur:
        im.paste(cur.convert("RGB"), (int(CAP_X + (1 - a) * CAP_SLIDE), y), cur.getchannel("A").point(lambda v: int(v * a)))
    return im
def dim(im, amount, t_in): return Image.blend(im, Image.new("RGB", im.size, (4, 6, 12)), amount * min(1.0, t_in / 0.3))
def card(im, L, local):
    if local < L["at"]: return im
    t = (local - L["at"]) * P
    return over(dim(im, 0.30, t), with_alpha(png(L["png"]), min(1.0, t / 0.18)))
def title(im, L):
    return over(im, png(L["png"])) if os.path.exists(f"{WORK}/cards/{L['png']}") else im
def layer(im, L, local):
    op = L["op"]
    if op == "caption": return caption(im, L, local)
    if op == "card": return card(im, L, local)
    if op == "title": return title(im, L)
    if op == "list": return scroller(im, L, local)
    raise SystemExit(f"cuts.json: unknown layer op {op!r}")

# ---- frames -----------------------------------------------------------------------------------------
TOTAL_BEATS, end = FR["totalBeats"], FR["endBeats"]
n_frames = round(TOTAL_BEATS * P * FPS)
print(f"{TOTAL_BEATS} beats ({end} held at the end) = {TOTAL_BEATS * P:.3f}s = {n_frames} frames @ {FPS}; drop on beat {DROP_BEAT}")
bounds, b0 = [], 0
for sg in SEGS: bounds.append(b0); b0 += sg["beats"]
seg_of, si = [], 0                                     # the segment each frame belongs to
for i in range(n_frames):
    bp = (i / FPS) / P
    while si + 1 < len(SEGS) and bp >= bounds[si + 1] - 1e-9: si += 1
    seg_of.append(si)
first = {}
for i, si in enumerate(seg_of): first.setdefault(si, i)
count = {si: seg_of.count(si) for si in first}

def draw(i):
    bp = (i / FPS) / P
    si = seg_of[i]
    sg = SEGS[si]
    tk, tb = sg["take"], sg["t0"]
    local = bp - bounds[si]
    im = backdrop(tk, tb + local, bp)
    if sg["backdrop"] != "devices" and sg["camera"] == "lean": im = camera(im, tk, local, tb + local)   # the two-screen layout stays put
    for L in sg["layers"]: im = layer(im, L, local)
    return im

# ---- the per-segment cache --------------------------------------------------------------------------
def digest(path):
    if not os.path.exists(path): return None
    with open(path, "rb") as f: return hashlib.sha1(f.read()).hexdigest()
def pngs_of(sg):   # every card PNG the segment's frames can read
    out = []
    if sg["backdrop"] == "devices":
        out += [f"key_{k}_{s}.png" for k in ("space", "option") for s in ("on", "off")] + ["label_laptop.png", f"label_{TWO[sg['take']]}.png"]
    for L in sg["layers"]:
        if L["op"] in ("title", "card"): out.append(L["png"])
        elif L["op"] == "caption": out += [x for x in (L.get("png"), L.get("prev")) if x]
        elif L["op"] == "list": out += [f"chrome_{L['key']}.png"] + [f"row_{L['key']}_{j}.png" for j in range(L["n"])]
    return out
COMMON = dict(src=digest(os.path.abspath(__file__)), size=[W, H], fps=FPS, song=CUTS["song"], dropBeat=DROP_BEAT, lag=LAG,
              list=FR.get("list"), meta=META)
def seg_key(si):
    sg = SEGS[si]
    names = [f"{sg['take']}_main", f"{sg['take']}_out"] if sg["take"] in TWO else [sg["take"]]
    takes = {n: [digest(f"{WORK}/takes/{n}/{f}") for f in ("frames.json", "track.json")] for n in names}
    d = dict(common=COMMON, seg=sg, bound=bounds[si], first=first[si], count=count[si], second=TWO.get(sg["take"]),
             takes=takes, pngs={p: digest(f"{WORK}/cards/{p}") for p in pngs_of(sg)})
    return hashlib.sha1(json.dumps(d, sort_keys=True).encode()).hexdigest()[:16]

CACHE = f"{WORK}/frames-cache"
os.makedirs(CACHE, exist_ok=True)
def cached(si):
    """The segment's frames, drawing them only when no cache entry has its key."""
    key = seg_key(si)
    d = f"{CACHE}/{key}"
    if os.path.isdir(d): return key, d, False
    part = f"{d}.part"
    shutil.rmtree(part, ignore_errors=True); os.makedirs(part)
    for j in range(count[si]):
        i = first[si] + j
        draw(i).save(f"{part}/{j:05d}.jpg", quality=94, subsampling=0)
        if j % 150 == 0: print(f"  segment {si + 1} ({SEGS[si]['kind']}, {SEGS[si]['take']}): frame {j}/{count[si]}", flush=True)
    os.replace(part, d)   # whole or not at all: an interrupted run leaves only a .part folder
    return key, d, True

def link_into(out, segs, start):
    shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
    drawn, keys = [], set()
    for si in segs:
        key, d, new = cached(si)
        keys.add(key)
        if new: drawn.append(si + 1)
        for j in range(count[si]):
            src, dst = f"{d}/{j:05d}.jpg", f"{out}/{first[si] + j - start:05d}.jpg"
            try: os.link(src, dst)
            except OSError: shutil.copyfile(src, dst)
    kept = [si + 1 for si in segs if si + 1 not in drawn]
    print(f"segments drawn: {drawn or 'none'}; reused from the cache: {kept or 'none'}")
    return keys

argv_segs = argv[argv.index("--segments") + 1] if "--segments" in argv else None
if argv_segs:
    a, _, b = argv_segs.partition("-")
    lo, hi = int(a) - 1, int(b or a) - 1
    if not (0 <= lo <= hi < len(SEGS)): sys.exit(f"--segments {argv_segs}: the plan has segments 1-{len(SEGS)}")
    segs = [si for si in range(lo, hi + 1) if si in first]
    if not segs: sys.exit(f"--segments {argv_segs}: no frames fall in them")
    PREVIEW = f"{WORK}/preview"
    link_into(PREVIEW, segs, first[segs[0]])
    n = sum(count[si] for si in segs)
    json.dump(dict(start=first[segs[0]] / FPS, total=n / FPS, frames=n, fps=FPS, dropBeat=DROP_BEAT, segments=[lo + 1, hi + 1]),
              open(f"{PREVIEW}/meta.json", "w"))
else:
    FRAMES = f"{WORK}/frames"
    used = link_into(FRAMES, sorted(first), 0)
    for e in os.listdir(CACHE):                         # entries this cut no longer uses, and interrupted ones
        if e not in used: shutil.rmtree(f"{CACHE}/{e}", ignore_errors=True)
    json.dump(dict(total=n_frames / FPS, frames=n_frames, fps=FPS, dropBeat=DROP_BEAT), open(f"{FRAMES}/meta.json", "w"))
