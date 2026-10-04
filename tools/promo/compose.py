# Lays the cards over the recorded takes and writes the video's frames, every cut on a beat of the song.
#
#   uv run -q --with pillow python tools/promo/compose.py          (promo.mjs runs this)
#
# Reads <work>: song.json (tempo), lines.json, cards/ (cards.mjs), takes/ (record.mjs), plan.json (optional).
# Writes <work>/frames/00000.jpg … + frames/meta.json {total, frames, fps, dropBeat}: 1080x1920, constant
# 30 fps, each frame taken from the NEAREST source frame (a repeated or late frame reads as lag).
#
# Shape of the video (the user's calls, 2026-10):
#   1. the opening look, then the release card ("0.2.0 - beta") held for a couple of seconds;
#   2. the demos from lines.json — clips that show a change happening, one caption at a time along the
#      bottom: the next caption slides in and pushes the old one out. The interface camera leans toward
#      the tracked part that changes; scene footage keeps a steady camera;
#   3. every group of lines.json as list pages over steady scene footage, rows landing in turn;
#   then a two-beat fade. The song's drop goes on the first demo (meta.dropBeat, which promo.mjs uses) —
#   make that demo a Physarum 2 take from a beat where it re-rolls.
# plan.json can override the timing, in beats:
#
#   { "intro": {"take": "intro", "t0": 0}, "look": 3, "version": 6, "row": 0.5, "hold": 3 }
#
# row = beats between list rows landing, hold = beats a page stays up after its last row. The opening
# look is the `intro` take when there is one, else a Physarum 2 stand-in.
import bisect, json, math, os, shutil
from PIL import Image, ImageDraw, ImageFilter

WORK = os.environ.get("PROMO_WORK") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".cache", "promo")
song = json.load(open(f"{WORK}/song.json"))
P = 60.0 / song["bpm"]
FPS, TAIL, FADE_BEATS = 30, 0.9, 2
W, H = 1080, 1920
plan = json.load(open(f"{WORK}/plan.json")) if os.path.exists(f"{WORK}/plan.json") else {}
LOOK, VERSION, ROW, HOLD = plan.get("look", 3), plan.get("version", 6), plan.get("row", 0.5), plan.get("hold", 3)
META = json.load(open(f"{WORK}/cards/meta.json"))
LINES = json.load(open(f"{WORK}/lines.json"))

REAL = {"cuep": "cuep_main", "room": "room_main"}           # composited takes: the controller's own take

def load_take(name):
    real = REAL.get(name, name)
    d = f"{WORK}/takes/{real}"
    j = json.load(open(f"{d}/frames.json"))
    tk = dict(dir=d, t0=j["meta"]["epochT0"], ts=[f["t"] for f in j["frames"]], files=[f["file"] for f in j["frames"]],
              vw=(j["meta"].get("view") or {}).get("width", 576))
    tf = f"{d}/track.json"
    tk["track"] = json.load(open(tf)) if os.path.exists(tf) else []
    tk["track_ts"] = [r[0] for r in tk["track"]]
    return tk
takes = {}
def get(name):
    if name not in takes: takes[name] = load_take(name)
    return takes[name]

def frame_at(name, beat):
    tk = get(name)
    src_t = tk["t0"] + beat * P
    k = bisect.bisect_left(tk["ts"], src_t)
    if k >= len(tk["ts"]) or (k > 0 and abs(tk["ts"][k - 1] - src_t) <= abs(tk["ts"][k] - src_t)): k = max(0, k - 1)
    return Image.open(f"{tk['dir']}/{tk['files'][k]}").convert("RGB")

def fit(im): return im if im.size == (W, H) else im.resize((W, H), Image.LANCZOS)

def inset(base, im, size, pos, pad=3):
    x, y = pos; w, h = size
    sh = Image.new("RGBA", (w + 60, h + 60), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle((30, 30, 30 + w, 30 + h), fill=(0, 0, 0, 190))
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    base.paste(sh, (x - 30, y - 24), sh)
    ImageDraw.Draw(base).rectangle((x - pad, y - pad, x + w + pad - 1, y + h + pad - 1), outline=(235, 240, 255), width=3)
    base.paste(im.resize(size, Image.LANCZOS), pos)
    return base
# the inset sits above the caption band (the caption covers y 1340..1530)
def cuep_frame(b): return inset(fit(frame_at("cuep", b)).copy(), frame_at("cuep_out", b), (700, 394), (190, 900))
def room_frame(b): return inset(fit(frame_at("room", b)).copy(), frame_at("room_tv", b), (440, 248), (590, 1050))
def backdrop(name, b):
    if name == "cuep": return cuep_frame(b)
    if name == "room": return room_frame(b)
    return fit(frame_at(name, b))

# ---- segments ---------------------------------------------------------------------------------------
INTRO = plan.get("intro") or ({"take": "intro", "t0": 0} if os.path.isdir(f"{WORK}/takes/intro") else {"take": "fb_p2b", "t0": 4})
# list pages cycle through the scene takes, each picking up where it last left off
SCENE_POOL = ["fb_p2b", "fb_cau", "fb_chl", "fb_p2a"]
scene_at = {"fb_p2a": 8, "fb_p2b": 0, "fb_cau": 0, "fb_chl": 0}

SEGS = [("look", (INTRO["take"], INTRO["t0"]), None, LOOK), ("version", (INTRO["take"], INTRO["t0"] + LOOK), None, VERSION)]
for i, d in enumerate(LINES.get("demos", [])):
    SEGS.append(("demo", (d["take"], d.get("from", 0)), i, d["beats"]))
for k, pg in enumerate(META["pages"]):
    dur = math.ceil(pg["n"] * ROW) + HOLD
    take = SCENE_POOL[k % len(SCENE_POOL)]
    if scene_at[take] + dur > 32: scene_at[take] = 0
    SEGS.append(("page", (take, scene_at[take]), pg, dur)); scene_at[take] += dur
TOTAL_BEATS = sum(sg[3] for sg in SEGS)
DROP_BEAT = LOOK + VERSION

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
def camera(im, name, local, plen, take_beat):
    if name in ("cuep", "room"):
        return zoom(im, 1.0 + 0.10 * ease(local / max(plen, 1)), W * 0.5, H * 0.42)
    if name.startswith("ui_"):
        tk = get(name)
        bx = track_box(tk, tk["t0"] + take_beat * P, W / tk["vw"])
        cx, cy = (bx[0] + bx[2] / 2, bx[1] + bx[3] / 2) if bx else (W * 0.62, H * 0.5)
        cx = W * 0.5 + (cx - W * 0.5) * 0.8; cy = H * 0.5 + (cy - H * 0.5) * 0.8
        return zoom(im, 1.0 + 0.40 * ease(local / 3), cx, cy)
    return im   # scene footage: a steady camera

# ---- text layers ------------------------------------------------------------------------------------
_png = {}
def png(path):
    if path not in _png: _png[path] = Image.open(f"{WORK}/cards/{path}").convert("RGBA")
    return _png[path]
_static = {}
def static_layer(key, k):
    if (key, k) not in _static:
        lay = png(f"chrome_{key}.png").copy()
        for i in range(k): lay.alpha_composite(png(f"row_{key}_{i}.png"))
        _static[(key, k)] = lay
    return _static[(key, k)]
def with_alpha(lay, a):
    lay = lay.copy(); lay.putalpha(lay.getchannel("A").point(lambda v: int(v * a))); return lay
def fade_row(key, i, a):
    r = png(f"row_{key}_{i}.png"); lay = Image.new("RGBA", r.size, (0, 0, 0, 0)); lay.paste(r, (0, int((1 - a) * 14)))
    return with_alpha(lay, a)

_scrim = None
def scrim():
    global _scrim
    if _scrim is None:
        a = Image.new("L", (W, H), 0); d = ImageDraw.Draw(a)
        for y in range(1180, H): d.line((0, y, W, y), fill=int(150 * min(1, (y - 1180) / 300)))
        _scrim = a
    return _scrim
CAP_X, CAP_Y, CAP_SLIDE, CAP_T = 70, 1340, 300, 0.4   # caption position; slide distance (px) and time (s)
def caption(im, i, local):
    im = Image.composite(Image.new("RGB", im.size, (3, 5, 10)), im, scrim())
    a = ease(local * P / CAP_T)
    if i > 0 and a < 1:
        c = png(f"demo_{i - 1}.png")
        im.paste(c.convert("RGB"), (int(CAP_X - a * CAP_SLIDE), CAP_Y), c.getchannel("A").point(lambda v: int(v * (1 - a))))
    c = png(f"demo_{i}.png")
    im.paste(c.convert("RGB"), (int(CAP_X + (1 - a) * CAP_SLIDE), CAP_Y), c.getchannel("A").point(lambda v: int(v * a)))
    return im
def dim(im, amount, t_in): return Image.blend(im, Image.new("RGB", im.size, (4, 6, 12)), amount * min(1.0, t_in / 0.3))

# ---- frames -----------------------------------------------------------------------------------------
n_frames = int((TOTAL_BEATS * P + TAIL) * FPS)
print(f"{TOTAL_BEATS} beats, {TOTAL_BEATS * P:.3f}s + {TAIL}s tail = {n_frames} frames @ {FPS}; drop on beat {DROP_BEAT}")
bounds, b0 = [], 0
for sg in SEGS: bounds.append(b0); b0 += sg[3]
FRAMES = f"{WORK}/frames"
shutil.rmtree(FRAMES, ignore_errors=True); os.makedirs(FRAMES)
si = 0
for i in range(n_frames):
    bp = (i / FPS) / P
    if bp >= TOTAL_BEATS:
        im = Image.new("RGB", (W, H), (0, 0, 0))
    else:
        while si + 1 < len(SEGS) and bp >= bounds[si + 1] - 1e-9: si += 1
        kind, (tk, tb), arg, dur = SEGS[si]
        local = bp - bounds[si]; t_in = local * P
        im = camera(backdrop(tk, tb + local), tk, local, dur, tb + local)
        if kind == "version":
            im = dim(im, 0.30, t_in)
            o = im.convert("RGBA"); o.alpha_composite(with_alpha(png("intro.png"), min(1.0, t_in / 0.18))); im = o.convert("RGB")
        elif kind == "demo":
            im = caption(im, arg, local)
        elif kind == "page":
            key, n = arg["key"], arg["n"]
            im = dim(im, 0.45, t_in)
            o = im.convert("RGBA")
            ca = min(1.0, t_in / 0.15)
            k = min(n, int(local / ROW))
            o.alpha_composite(with_alpha(static_layer(key, k), ca) if ca < 1.0 else static_layer(key, k))
            if k < n: o.alpha_composite(fade_row(key, k, min(1.0, (local - k * ROW) * P / 0.18) * ca))
            im = o.convert("RGB")
        if bp > TOTAL_BEATS - FADE_BEATS:
            f = max(0.0, 1 - (bp - (TOTAL_BEATS - FADE_BEATS)) / FADE_BEATS)
            im = Image.eval(im, lambda v: int(v * f))
    im.save(f"{FRAMES}/{i:05d}.jpg", quality=94, subsampling=0)
    if i % 150 == 0: print(i, f"beat {bp:.1f}", SEGS[si][0] if bp < TOTAL_BEATS else "tail", flush=True)
json.dump(dict(total=TOTAL_BEATS * P + TAIL, frames=n_frames, fps=FPS, dropBeat=DROP_BEAT), open(f"{FRAMES}/meta.json", "w"))
