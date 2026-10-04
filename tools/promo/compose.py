# Lays the cards over the recorded takes and writes the video's frames, every cut on a beat of the song.
#
#   uv run -q --with pillow python tools/promo/compose.py          (promo.mjs runs this)
#
# Reads <work>: song.json (tempo), cards/ (cards.mjs), takes/ (record.mjs), plan.json (optional).
# Writes <work>/frames/00000.jpg … + frames/meta.json {total, frames, fps}: 1080x1920, constant 30 fps,
# each frame taken from the NEAREST source frame (a repeated or late frame reads as lag).
#
# Shape of the video: a short opening look, the release card ("0.2.0 - beta"), then one segment per
# group in lines.json — "carousel" groups ride a bottom carousel over clear scene footage with a lively
# camera (bar-hit zoom, slow roll, orbiting pan, a punch on every beat); "card" groups show one list card
# over dimmed panel footage, whose camera leans toward the tracked part of the interface. It ends with a
# two-beat fade. Backdrops are allocated from two pools of takes; plan.json can name them per group:
#
#   { "intro": {"take": "intro", "t0": 0}, "step": 2, "hold": 4, "back": {"<key>": [["<take>", 0, 8], …]} }
#
# step = beats per carousel card, hold = beats a list card stays up after its last row lands, back =
# [take, first beat in the take, beats] pieces for a group. The opening look is the `intro` take when
# there is one, else a Physarum 2 stand-in. The first scene piece is Physarum 2, which re-rolls every
# 10 beats from take beat 0 — with an 8-beat opening that puts a re-roll on video beat 18, which is
# where promo.mjs places the song's drop (--drop-beat).
import bisect, json, math, os, shutil
from PIL import Image, ImageDraw, ImageFilter

WORK = os.environ.get("PROMO_WORK") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".cache", "promo")
song = json.load(open(f"{WORK}/song.json"))
P = 60.0 / song["bpm"]
FPS, TAIL, FADE_BEATS = 30, 0.9, 2
W, H = 1080, 1920
plan = json.load(open(f"{WORK}/plan.json")) if os.path.exists(f"{WORK}/plan.json") else {}
STEP, HOLD = plan.get("step", 2), plan.get("hold", 4)
META = json.load(open(f"{WORK}/cards/meta.json"))
LINES = json.load(open(f"{WORK}/lines.json"))
GROUPS = [g["key"] for g in LINES["groups"]]

REAL = {"cuep": "cuep_main", "room": "room_main"}           # composited takes: the controller's own take
TAKE_BEATS = {"cuep": 9, "room": 6.5}                         # usable beats of the short takes (the rest: 8 or 32)
def take_beats(name): return TAKE_BEATS.get(name, 8 if name.startswith("ui_") or name == "intro" else 32)

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
def cuep_frame(b): return inset(fit(frame_at("cuep", b)).copy(), frame_at("cuep_out", b), (780, 439), (150, 1472))
def room_frame(b): return inset(fit(frame_at("room", b)).copy(), frame_at("room_tv", b), (440, 248), (590, 1180))
def backdrop(name, b):
    if name == "cuep": return cuep_frame(b)
    if name == "room": return room_frame(b)
    return fit(frame_at(name, b))

# ---- which take sits behind which group ------------------------------------------------------------
INTRO = plan.get("intro") or ({"take": "intro", "t0": 0} if os.path.isdir(f"{WORK}/takes/intro") else {"take": "fb_p2b", "t0": 4})
SCENE_POOL = [("fb_cau", 0, 6), ("fb_chl", 0, 8), ("fb_cau", 8, 12), ("fb_p2b", 16, 8), ("fb_chl", 8, 8), ("fb_cau", 20, 8)]
UI_POOL = [("cuep", 0, 9), ("room", 1.5, 5), ("ui_hits", 0, 8), ("ui_wire", 0, 3), ("ui_palettes", 0, 6), ("ui_master", 0, 4), ("ui_pads", 0, 5)]
cursor = {"scene": 0, "ui": 0}
def allocate(dur, kind, first=None):
    pool = SCENE_POOL if kind == "scene" else UI_POOL
    pieces, left = [], dur
    if first:
        n = min(left, first[2]); pieces.append((first[0], first[1], n)); left -= n
    while left > 0.01:
        take, tb, nb = pool[cursor[kind] % len(pool)]; cursor[kind] += 1
        n = min(left, nb); pieces.append((take, tb, n)); left -= n
    return pieces

SEGS = [("look", [(INTRO["take"], INTRO["t0"], 3)], None, 3), ("intro", [(INTRO["take"], INTRO["t0"] + 3, 5)], None, 5)]
first_scene = True
for g in GROUPS:
    n = META[g]["n"]; carousel = META[g]["style"] == "carousel"
    dur = n * STEP if carousel else n + HOLD
    if g in plan.get("back", {}):
        pieces = [tuple(p) for p in plan["back"][g]]
    elif carousel:
        pieces = allocate(dur, "scene", first=("fb_p2a", 0, 18) if first_scene else None); first_scene = False
    else:
        pieces = allocate(dur, "ui")
    SEGS.append((g, pieces, g, dur))
TOTAL_BEATS = sum(sg[3] for sg in SEGS)

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
def camera(im, name, pidx, local, plen, take_beat):
    t = local / max(plen, 1)
    phase = (local % 1) * P
    if name in ("cuep", "room"):
        z, punch = 1.0 + 0.12 * ease(t), 1 + 0.035 * math.exp(-8 * phase)
        cx, cy = W * 0.5, H * (0.45 - 0.05 * t)
    elif name.startswith("ui_"):
        tk = get(name)
        bx = track_box(tk, tk["t0"] + take_beat * P, W / tk["vw"])
        z, punch = 1.0 + 0.40 * ease(local / 3), 1 + 0.015 * math.exp(-8 * phase)
        cx, cy = (bx[0] + bx[2] / 2, bx[1] + bx[3] / 2) if bx else (W * 0.62, H * 0.5)
        cx = W * 0.5 + (cx - W * 0.5) * 0.8; cy = H * 0.5 + (cy - H * 0.5) * 0.8
    else:   # scene footage: bar-hit zoom that relaxes over the bar, per-beat punch, slow roll, orbiting pan
        z = 1.14 + 0.07 * math.sin(2 * math.pi * local / 16 + pidx) + 0.24 * math.exp(-(local % 4) * 1.15)
        punch = 1 + 0.05 * math.exp(-8 * phase)
        cx = W * (0.5 + 0.07 * math.sin(2 * math.pi * local / 12 + pidx * 2)); cy = H * (0.5 + 0.06 * math.cos(2 * math.pi * local / 9 + pidx))
        im = im.rotate(2.6 * math.sin(2 * math.pi * local / 10 + pidx), resample=Image.BICUBIC, center=(cx, cy))
    return zoom(im, z * punch, cx, cy)

# ---- text layers ------------------------------------------------------------------------------------
_png = {}
def png(path):
    if path not in _png: _png[path] = Image.open(f"{WORK}/cards/{path}").convert("RGBA")
    return _png[path]
_static = {}
def static_layer(g, k):
    if (g, k) not in _static:
        lay = png(f"chrome_{g}.png").copy()
        for i in range(k): lay.alpha_composite(png(f"row_{g}_{i}.png"))
        _static[(g, k)] = lay
    return _static[(g, k)]
def with_alpha(lay, a):
    lay = lay.copy(); lay.putalpha(lay.getchannel("A").point(lambda v: int(v * a))); return lay
def fade_row(g, i, a):
    r = png(f"row_{g}_{i}.png"); lay = Image.new("RGBA", r.size, (0, 0, 0, 0)); lay.paste(r, (0, int((1 - a) * 14)))
    return with_alpha(lay, a)

_scrim = None
def scrim():
    global _scrim
    if _scrim is None:
        a = Image.new("L", (W, H), 0); d = ImageDraw.Draw(a)
        for y in range(1180, H): d.line((0, y, W, y), fill=int(150 * min(1, (y - 1180) / 300)))
        _scrim = a
    return _scrim
CARD_Y, CARD_W, CARD_PITCH, CARD_X0 = 1335, 460, 480, 70
def carousel(im, g, n, local):
    s = min(int(local // STEP) + ease((local % STEP - (STEP - 0.75)) / 0.75), n - 1)
    im = Image.composite(Image.new("RGB", im.size, (3, 5, 10)), im, scrim())
    for j in range(max(0, int(s) - 1), min(n, int(s) + 4)):
        x = int(round(CARD_X0 + (j - s) * CARD_PITCH))
        if x > W or x + CARD_W < 0: continue
        a_on = max(0.0, 1 - abs(j - s) * 1.6)
        edge = max(0.0, 1 - (CARD_X0 - x) / 360) if x < CARD_X0 else 1.0
        for variant, a in (("", 1.0), ("_on", a_on)):
            if a <= 0 or edge <= 0: continue
            c = png(f"car_{g}_{j}{variant}.png")
            im.paste(c.convert("RGB"), (x, CARD_Y), c.getchannel("A").point(lambda v: int(v * a * edge)))
    return im
def dim(im, amount, t_in): return Image.blend(im, Image.new("RGB", im.size, (4, 6, 12)), amount * min(1.0, t_in / 0.3))

# ---- frames -----------------------------------------------------------------------------------------
n_frames = int((TOTAL_BEATS * P + TAIL) * FPS)
print(f"{TOTAL_BEATS} beats, {TOTAL_BEATS * P:.3f}s + {TAIL}s tail = {n_frames} frames @ {FPS}")
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
        name, pieces, g, dur = SEGS[si]
        local = bp - bounds[si]; t_in = local * P
        acc = 0
        for pidx, (tk, tb, nb) in enumerate(pieces):
            if local < acc + nb or pidx == len(pieces) - 1:
                im = camera(backdrop(tk, tb + (local - acc)), tk, pidx, local - acc, nb, tb + (local - acc)); break
            acc += nb
        if name == "intro":
            im = dim(im, 0.30, t_in)
            o = im.convert("RGBA"); o.alpha_composite(with_alpha(png("intro.png"), min(1.0, t_in / 0.18))); im = o.convert("RGB")
        elif g and META[g]["style"] == "carousel":
            im = carousel(im, g, META[g]["n"], local)
        elif g:
            n = META[g]["n"]
            im = dim(im, 0.50, t_in)
            o = im.convert("RGBA")
            ca = min(1.0, t_in / 0.15)
            k = min(n, int(local))
            o.alpha_composite(with_alpha(static_layer(g, k), ca) if ca < 1.0 else static_layer(g, k))
            if k < n: o.alpha_composite(fade_row(g, k, min(1.0, (local - k) * P / 0.22) * ca))
            im = o.convert("RGB")
        if bp > TOTAL_BEATS - FADE_BEATS:
            f = max(0.0, 1 - (bp - (TOTAL_BEATS - FADE_BEATS)) / FADE_BEATS)
            im = Image.eval(im, lambda v: int(v * f))
    im.save(f"{FRAMES}/{i:05d}.jpg", quality=94, subsampling=0)
    if i % 150 == 0: print(i, f"beat {bp:.1f}", SEGS[si][0] if bp < TOTAL_BEATS else "tail", flush=True)
json.dump(dict(total=TOTAL_BEATS * P + TAIL, frames=n_frames, fps=FPS), open(f"{FRAMES}/meta.json", "w"))
