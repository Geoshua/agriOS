"""
Builds the AgriOS brand kit from the measured logo composite.

Emblem and icon are clean vector geometry (measured proportions, exact
colours); the wordmark is traced from the composite because it needs the real
letterforms. Every PNG is rasterised from the same geometry at 8x and
downsampled, so SVG and PNG match.

Run: python scripts/brand/build_brand.py  (needs numpy, opencv-python, Pillow)
Outputs: assets/brand/* and the platform icons in assets/.
"""
import json, math, os
import numpy as np
import cv2
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "assets", "brand", "source", "logo-composite.jpg")
BRAND = os.path.join(ROOT, "assets", "brand")
os.makedirs(BRAND, exist_ok=True)

# ── Colours (medians sampled from the composite) ─────────────────────────────
TILE = "#1C1813"
CREAM = "#F2EAD8"
LIGHT = "#239B6D"
DARK = "#33644C"
INK = "#1E1811"

def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))

# ── Emblem geometry (box W x H, measured) ────────────────────────────────────
W = 100.0
H = round(100 / 0.7281, 2)  # 137.34
SH_TOP = 0.3375 * H
SH_BOT = 0.6719 * H
VEIN = 0.0815 * W
CUT_W = VEIN
# Centre line of the left diagonal cut, from measured samples.
P1 = (0.047 * W, 0.327 * H)
P2 = (0.408 * W, 0.583 * H)

def clip(poly, a, b, c):
    """Keep the part of convex `poly` where a*x + b*y + c >= 0 (Sutherland-Hodgman)."""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        fp, fq = a * p[0] + b * p[1] + c, a * q[0] + b * q[1] + c
        if fp >= 0:
            out.append(p)
        if (fp >= 0) != (fq >= 0):
            t = fp / (fp - fq)
            out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
    return out

def band_halfplanes(p1, p2, width):
    """Two half-planes: (above the band), (below the band) for the line p1→p2."""
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    L = math.hypot(dx, dy)
    nx, ny = dy / L, -dx / L  # unit normal
    # signed distance s(P) = n·(P - p1); "above" = towards the top tip (50, 0)
    s_top = nx * (50 - p1[0]) + ny * (0 - p1[1])
    sign = 1 if s_top > 0 else -1
    c0 = -(nx * p1[0] + ny * p1[1])
    above = (sign * nx, sign * ny, sign * c0 - width / 2)   # s*sign >= w/2
    below = (-sign * nx, -sign * ny, -sign * c0 - width / 2)  # -s*sign >= w/2
    return above, below

def emblem_pieces():
    left = [(50, 0), (0, SH_TOP), (0, SH_BOT), (50, H)]
    above, below = band_halfplanes(P1, P2, CUT_W)
    vein_left = (-1, 0, 50 - VEIN / 2)  # x <= 50 - vein/2
    lu = clip(clip(left, *vein_left), *above)
    ll = clip(clip(left, *vein_left), *below)
    mirror = lambda poly: [(W - x, y) for x, y in poly][::-1]
    return [(lu, LIGHT), (ll, LIGHT), (mirror(lu), DARK), (mirror(ll), DARK)]

def rounded_path(poly, r_outer=5.0, r_inner=1.0, flatten=False):
    """Path with softened corners: bigger radius on the outer-edge vertices."""
    n = len(poly)
    cmds = []
    pts = []
    for i in range(n):
        v, p, q = poly[i], poly[i - 1], poly[(i + 1) % n]
        r = r_outer if (v[0] < 0.5 or v[0] > W - 0.5) else r_inner
        d1 = math.hypot(v[0] - p[0], v[1] - p[1]); d2 = math.hypot(q[0] - v[0], q[1] - v[1])
        d = min(r, 0.45 * d1, 0.45 * d2)
        a = (v[0] + (p[0] - v[0]) / d1 * d, v[1] + (p[1] - v[1]) / d1 * d)
        b = (v[0] + (q[0] - v[0]) / d2 * d, v[1] + (q[1] - v[1]) / d2 * d)
        cmds.append(("%s%.3f %.3f" % ("M" if i == 0 else "L", a[0], a[1]), "Q%.3f %.3f %.3f %.3f" % (v[0], v[1], b[0], b[1])))
        # flattened quadratic for rasterising
        pts.append(a)
        for k in range(1, 7):
            t = k / 7
            pts.append(((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * v[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * v[1] + t * t * b[1]))
        pts.append(b)
    d = " ".join(m + " " + q for m, q in cmds) + " Z"
    return (pts if flatten else d)

PIECES = emblem_pieces()
EMBLEM_PATHS = [(rounded_path(p), col) for p, col in PIECES]
EMBLEM_POLYS = [(rounded_path(p, flatten=True), col) for p, col in PIECES]

# ── SVG writers ──────────────────────────────────────────────────────────────
def svg_emblem(path, mono=None):
    body = "\n".join('  <path d="%s" fill="%s"/>' % (d, mono or col) for d, col in EMBLEM_PATHS)
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" width="%g" height="%g">\n%s\n</svg>\n' % (W, H, W, H, body)
    open(path, "w", encoding="utf-8").write(svg)
    print("wrote", os.path.relpath(path, ROOT))

def emblem_group(x, y, h, mono=None):
    """<g> placing the emblem with its height = h, top-left at (x, y)."""
    s = h / H
    paths = "\n".join('    <path d="%s" fill="%s"/>' % (d, mono or col) for d, col in EMBLEM_PATHS)
    return '  <g transform="translate(%.2f %.2f) scale(%.5f)">\n%s\n  </g>' % (x, y, s, paths)

def brackets_svg(size, inset, arm, stroke, colour):
    r = stroke / 2
    parts = []
    for cx, cy, sx, sy in ((inset, inset, 1, 1), (size - inset, inset, -1, 1), (inset, size - inset, 1, -1), (size - inset, size - inset, -1, -1)):
        parts.append('  <path d="M%.1f %.1f H%.1f V%.1f" fill="none" stroke="%s" stroke-width="%.1f" stroke-linecap="round" stroke-linejoin="round"/>'
                     % (cx + sx * arm, cy, cx, cy + sy * arm, colour, stroke))
    return "\n".join(parts)

ICON = dict(size=1024, emblem_h=0.685, cy=0.491, radius=0.20, inset=0.112, arm=0.141, stroke=0.026)

def svg_icon(path, rounded=True):
    S = ICON["size"]
    eh = ICON["emblem_h"] * S
    ew = eh * W / H
    tile = '  <rect width="%d" height="%d" rx="%.0f" fill="%s"/>' % (S, S, ICON["radius"] * S if rounded else 0, TILE)
    out = [tile, brackets_svg(S, ICON["inset"] * S, ICON["arm"] * S, ICON["stroke"] * S, DARK), emblem_group((S - ew) / 2, ICON["cy"] * S - eh / 2, eh)]
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d">\n%s\n</svg>\n' % (S, S, S, S, "\n".join(out))
    open(path, "w", encoding="utf-8").write(svg)
    print("wrote", os.path.relpath(path, ROOT))

# ── Wordmark: trace the composite ────────────────────────────────────────────
img = cv2.cvtColor(cv2.imread(SRC), cv2.COLOR_BGR2RGB)
WX0, WY0, WX1, WY1 = 1164, 400, 1844, 596
PAD = 6
crop = img[WY0 - PAD:WY1 + PAD + 1, WX0 - PAD:WX1 + PAD + 1]
UP = 4
big = cv2.resize(crop, None, fx=UP, fy=UP, interpolation=cv2.INTER_CUBIC).astype(np.int32)
r, g, b = big[..., 0], big[..., 1], big[..., 2]
lum = (r + g + b) / 3
ink = (lum < 120).astype(np.uint8) * 255
grn = ((g > r + 25) & (g > b + 10) & (g > 70)).astype(np.uint8) * 255
def smooth(m):
    m = cv2.GaussianBlur(m, (0, 0), UP * 0.6)
    return (m > 127).astype(np.uint8) * 255
ink, grn = smooth(ink), smooth(grn)
WM_W, WM_H = crop.shape[1], crop.shape[0]

def trace(mask, eps=1.1):
    cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    polys = []
    for c in cs:
        if cv2.contourArea(c) < 40 * UP * UP:
            continue
        a = cv2.approxPolyDP(c, eps * UP / 2, True).reshape(-1, 2) / UP
        polys.append(a)
    return polys

INK_POLYS = trace(ink)
GRN_POLYS = trace(grn)
print("wordmark traced: %d ink contours, %d green contours, box %dx%d" % (len(INK_POLYS), len(GRN_POLYS), WM_W, WM_H))

def polys_to_d(polys):
    parts = []
    for p in polys:
        parts.append("M" + " L".join("%.2f %.2f" % (x, y) for x, y in p) + " Z")
    return " ".join(parts)

WM_INK_D = polys_to_d(INK_POLYS)
WM_GRN_D = polys_to_d(GRN_POLYS)

def svg_wordmark(path, ink_colour):
    body = '  <path d="%s" fill="%s" fill-rule="evenodd"/>\n  <path d="%s" fill="%s" fill-rule="evenodd"/>' % (WM_INK_D, ink_colour, WM_GRN_D, LIGHT)
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d">\n%s\n</svg>\n' % (WM_W, WM_H, WM_W, WM_H, body)
    open(path, "w", encoding="utf-8").write(svg)
    print("wrote", os.path.relpath(path, ROOT))

def wordmark_group(x, y, h, ink_colour):
    s = h / WM_H
    return ('  <g transform="translate(%.2f %.2f) scale(%.5f)">\n    <path d="%s" fill="%s" fill-rule="evenodd"/>\n    <path d="%s" fill="%s" fill-rule="evenodd"/>\n  </g>'
            % (x, y, s, WM_INK_D, ink_colour, WM_GRN_D, LIGHT))

# Lockup layout (from the composite): bracket block B square; wordmark height 0.72 B; gap 0.25 B.
def svg_lockup(path, dark):
    B = 400.0
    pad = 60.0
    wm_h = 0.72 * B
    wm_w = wm_h * WM_W / WM_H
    gap = 0.25 * B
    total_w = pad + B + gap + wm_w + pad
    total_h = pad + B + pad
    bg = TILE if dark else CREAM
    ink = CREAM if dark else INK
    inset, arm, stroke = 0.03 * B, 0.17 * B, 0.03 * B  # brackets hug the emblem in the lockup
    eh = 0.80 * B
    ew = eh * W / H
    parts = [
        '  <rect width="%.0f" height="%.0f" fill="%s"/>' % (total_w, total_h, bg),
        '  <g transform="translate(%.1f %.1f)">\n%s\n  </g>' % (pad, pad, "\n".join("  " + l for l in brackets_svg(B, inset, arm, stroke, DARK).split("\n"))),
        emblem_group(pad + (B - ew) / 2, pad + (B - eh) / 2, eh),
        wordmark_group(pad + B + gap, pad + (B - wm_h) / 2, wm_h, ink),
    ]
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.0f %.0f" width="%.0f" height="%.0f">\n%s\n</svg>\n' % (total_w, total_h, total_w, total_h, "\n".join(parts))
    open(path, "w", encoding="utf-8").write(svg)
    print("wrote", os.path.relpath(path, ROOT))
    return total_w, total_h

# ── Rasteriser (shared geometry, 8x supersample) ─────────────────────────────
SS = 8

def canvas(w, h, bg=None):
    im = np.zeros((h * SS, w * SS, 4), np.uint8)
    if bg:
        im[..., :3] = rgb(bg); im[..., 3] = 255
    return im

def fill(im, polys, colour, ox, oy, scale):
    pts = [np.round((np.array(p, np.float64) * scale + (ox, oy)) * SS).astype(np.int32) for p in polys]
    cv2.fillPoly(im, pts, (*rgb(colour), 255), lineType=cv2.LINE_AA)

def draw_emblem(im, x, y, h, mono=None):
    s = h / H
    for pts, col in EMBLEM_POLYS:
        fill(im, [pts], mono or col, x, y, s)

def draw_brackets(im, ox, oy, size, inset, arm, stroke, colour):
    t = int(round(stroke * SS))
    for cx, cy, sx, sy in ((inset, inset, 1, 1), (size - inset, inset, -1, 1), (inset, size - inset, 1, -1), (size - inset, size - inset, -1, -1)):
        p0 = (int(round((ox + cx + sx * arm) * SS)), int(round((oy + cy) * SS)))
        p1 = (int(round((ox + cx) * SS)), int(round((oy + cy) * SS)))
        p2 = (int(round((ox + cx) * SS)), int(round((oy + cy + sy * arm) * SS)))
        cv2.polylines(im, [np.array([p0, p1, p2], np.int32)], False, (*rgb(colour), 255), t, cv2.LINE_AA)

def draw_wordmark(im, x, y, h, ink_colour):
    s = h / WM_H
    fill(im, INK_POLYS, ink_colour, x, y, s)
    fill(im, GRN_POLYS, LIGHT, x, y, s)

def save(im, path, size=None):
    h, w = im.shape[0] // SS, im.shape[1] // SS
    out = cv2.resize(im, (w, h), interpolation=cv2.INTER_AREA)
    pil = Image.fromarray(out, "RGBA")
    if size:
        pil = pil.resize(size, Image.LANCZOS)
    pil.save(path)
    print("wrote", os.path.relpath(path, ROOT), pil.size)

def round_tile(im, radius):
    """Clip a square canvas to a rounded rect (alpha)."""
    h, w = im.shape[:2]
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=int(radius * SS), fill=255)
    im[..., 3] = np.minimum(im[..., 3], np.array(mask))

# ── Build ────────────────────────────────────────────────────────────────────
svg_emblem(os.path.join(BRAND, "emblem.svg"))
svg_emblem(os.path.join(BRAND, "emblem-mono.svg"), mono="currentColor")
svg_icon(os.path.join(BRAND, "app-icon.svg"))
svg_wordmark(os.path.join(BRAND, "wordmark.svg"), INK)
svg_wordmark(os.path.join(BRAND, "wordmark-on-dark.svg"), CREAM)
lw, lh = svg_lockup(os.path.join(BRAND, "lockup-light.svg"), dark=False)
svg_lockup(os.path.join(BRAND, "lockup-dark.svg"), dark=True)

# Emblem PNGs (transparent), two-tone and mono
for px in (1024, 512, 256, 128, 48, 16):
    im = canvas(int(round(px * W / H)) + 2, px + 2)
    draw_emblem(im, 1, 1, px)
    save(im, os.path.join(BRAND, "emblem-%d.png" % px))
for px in (256, 48, 16):
    for name, col in (("emerald", LIGHT), ("white", "#FFFFFF"), ("ink", INK)):
        im = canvas(int(round(px * W / H)) + 2, px + 2)
        draw_emblem(im, 1, 1, px, mono=col)
        save(im, os.path.join(BRAND, "emblem-mono-%s-%d.png" % (name, px)))

# App icon: presentational rounded tile + platform square
S = ICON["size"]
def icon_canvas():
    im = canvas(S, S, TILE)
    draw_brackets(im, 0, 0, S, ICON["inset"] * S, ICON["arm"] * S, ICON["stroke"] * S, DARK)
    eh = ICON["emblem_h"] * S
    draw_emblem(im, (S - eh * W / H) / 2, ICON["cy"] * S - eh / 2, eh)
    return im
im = icon_canvas(); round_tile(im, ICON["radius"] * S); save(im, os.path.join(BRAND, "app-icon-rounded-1024.png"))
save(icon_canvas(), os.path.join(ROOT, "assets", "icon.png"))

# Android adaptive: foreground emblem inside the safe zone, mono layer, splash
im = canvas(S, S); eh = 0.46 * S; draw_emblem(im, (S - eh * W / H) / 2, (S - eh) / 2, eh); save(im, os.path.join(ROOT, "assets", "adaptive-icon.png"))
im = canvas(S, S); draw_emblem(im, (S - eh * W / H) / 2, (S - eh) / 2, eh, mono="#FFFFFF"); save(im, os.path.join(ROOT, "assets", "adaptive-icon-mono.png"))
im = canvas(S, S); eh = 0.70 * S; draw_emblem(im, (S - eh * W / H) / 2, (S - eh) / 2, eh); save(im, os.path.join(ROOT, "assets", "splash-icon.png"))

# Wordmark PNGs
for px_h in (400, 128):
    im = canvas(int(round(px_h * WM_W / WM_H)), px_h)
    draw_wordmark(im, 0, 0, px_h, INK); save(im, os.path.join(BRAND, "wordmark-%d.png" % px_h))
    im = canvas(int(round(px_h * WM_W / WM_H)), px_h)
    draw_wordmark(im, 0, 0, px_h, CREAM); save(im, os.path.join(BRAND, "wordmark-on-dark-%d.png" % px_h))

# Lockup PNGs (same layout as the SVGs)
def lockup_png(path, dark):
    B = 400.0; pad = 60.0; wm_h = 0.72 * B; wm_w = wm_h * WM_W / WM_H; gap = 0.25 * B
    tw, th = int(round(pad + B + gap + wm_w + pad)), int(round(pad + B + pad))
    im = canvas(tw, th, TILE if dark else CREAM)
    draw_brackets(im, pad, pad, B, 0.03 * B, 0.17 * B, 0.03 * B, DARK)
    eh = 0.80 * B
    draw_emblem(im, pad + (B - eh * W / H) / 2, pad + (B - eh) / 2, eh)
    draw_wordmark(im, pad + B + gap, pad + (B - wm_h) / 2, wm_h, CREAM if dark else INK)
    save(im, path)
lockup_png(os.path.join(BRAND, "lockup-light.png"), False)
lockup_png(os.path.join(BRAND, "lockup-dark.png"), True)

# Geometry for the in-app SVG component
json.dump({"viewBox": [W, H], "paths": EMBLEM_PATHS, "colours": {"light": LIGHT, "dark": DARK, "tile": TILE, "cream": CREAM, "ink": INK}},
          open(os.path.join(BRAND, "emblem-geometry.json"), "w"), indent=1)
print("done")
