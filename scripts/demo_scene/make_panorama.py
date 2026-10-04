"""
Builds the 360° demo scene used by the scan screen's "Demo" mode.

Output:
  assets/demo-scene/panorama.jpg  — (W + MARGIN) x H JPEG. The first W columns are one
                                    full turn; the last MARGIN columns repeat columns
                                    0..MARGIN so any view window can be cropped from a
                                    single rectangle (no stitching across the seam).
  assets/demo-scene/leaves.json   — ground truth: class, source file and centre x of
                                    each leaf (fraction of W).

The background is procedural (periodic FFT noise + soft foliage blobs + soil), so the
seam at x = 0 / x = W is continuous. Leaves are held-out BRACOL photos with the white
background removed.

Usage:  python scripts/demo_scene/make_panorama.py [--photos DIR]
"""

import argparse
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W = 3584          # one full turn, px (≈ 10 px per degree)
MARGIN = 512      # wrap margin appended on the right; must exceed the widest view window
H = 1024
LEAF_W = 300      # ≈ 70 % of the ~420 px view window the app shows
SEED = 7

# 2 rust, 1 phoma, 1 miner, 1 brown eye (cercospora), 3 healthy — interleaved so
# neighbours differ.
LEAVES = [
    ('rust', 'rust_1.jpg'),
    ('healthy', 'healthy_1.jpg'),
    ('phoma', 'phoma_1.jpg'),
    ('miner', 'miner_1.jpg'),
    ('healthy', 'healthy_2.jpg'),
    ('cercospora', 'cercospora_1.jpg'),
    ('rust', 'rust_2.jpg'),
    ('healthy', 'healthy_3.jpg'),
]

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_DIR = os.path.join(ROOT, 'assets', 'demo-scene')


def periodic_noise(rng, h, w, falloff):
    """Fractal noise that tiles in both axes (inverse FFT of a 1/f^falloff spectrum)."""
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1
    spectrum = (rng.normal(size=(h, w)) + 1j * rng.normal(size=(h, w))) / f ** falloff
    spectrum[0, 0] = 0
    n = np.real(np.fft.ifft2(spectrum))
    n -= n.min()
    return n / n.max()


def background(rng):
    y = np.linspace(0, 1, H)[:, None]
    n1 = periodic_noise(rng, H, W, 1.6)
    n2 = periodic_noise(rng, H, W, 1.1)

    # Canopy greens with light dappling.
    canopy = np.stack([
        28 + 40 * n1 + 25 * n2,
        58 + 70 * n1 + 30 * n2,
        24 + 30 * n1 + 10 * n2,
    ], axis=-1)
    # Hazy brighter foliage towards the top, darker under the bushes.
    canopy *= (1.15 - 0.45 * y)[..., None]

    soil = np.stack([96 + 50 * n2, 66 + 36 * n2, 40 + 22 * n2], axis=-1)
    # Wavy soil line, periodic in x.
    xs = np.arange(W)
    soil_line = 0.80 + 0.03 * np.sin(2 * math.pi * 3 * xs / W) + 0.02 * np.sin(2 * math.pi * 11 * xs / W + 1.3)
    t = np.clip((y - soil_line[None, :]) / 0.04, 0, 1)[..., None]
    img = canopy * (1 - t) + soil * t
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def wrapped(draw_fn, x, *args):
    """Draw something at x and its copies one turn left/right so it wraps cleanly."""
    for dx in (-W, 0, W):
        draw_fn(x + dx, *args)


def foliage(img, rng, count, size, colours, blur):
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(count):
        x = rng.uniform(0, W)
        yc = rng.uniform(0.05, 0.85) * H
        L = rng.uniform(*size)
        a = rng.uniform(0, math.pi)
        col = tuple(int(c) for c in colours[rng.integers(len(colours))]) + (int(rng.uniform(150, 235)),)

        def leaf_poly(cx, L=L, a=a, yc=yc, col=col):
            pts = []
            for k in range(24):
                s = k / 23 * 2 - 1  # -1..1 along the leaf
                half = 0.22 * L * math.sqrt(max(0.0, 1 - s * s))
                pts.append((s * L / 2, half))
            pts += [(px, -py) for px, py in reversed(pts)]
            ca, sa = math.cos(a), math.sin(a)
            d.polygon([(cx + px * ca - py * sa, yc + px * sa + py * ca) for px, py in pts], fill=col)

        wrapped(leaf_poly, x)
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    img.alpha_composite(layer)


def cut_out_leaf(path):
    """Remove the near-white / low-saturation background connected to the border."""
    src = Image.open(path).convert('RGB')
    small = src.resize((src.width // 2, src.height // 2), Image.LANCZOS)
    hsv = np.asarray(small.convert('HSV')).astype(np.int32)
    rgb = np.asarray(small).astype(np.int32)
    sat, val = hsv[..., 1], hsv[..., 2]
    # Background: grey/white paper (low saturation, fairly bright). Leaf tissue,
    # including yellow/brown lesions, is clearly more saturated.
    bg_like = (sat < 60) & (val > 110)
    # Flood fill from the border through background-like pixels.
    from collections import deque
    h, w = bg_like.shape
    seen = np.zeros_like(bg_like)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bg_like[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bg_like[y, x] and not seen[y, x]:
                seen[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and bg_like[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    alpha = Image.fromarray(np.where(seen, 0, 255).astype(np.uint8))
    # Close pinholes, then a soft 1–2 px edge.
    alpha = alpha.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.5))
    leaf = Image.fromarray(rgb.astype(np.uint8)).convert('RGBA')
    leaf.putalpha(alpha)
    return leaf.crop(alpha.getbbox())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--photos', default=os.path.join(ROOT, 'dist', 'test-photos'))
    args = ap.parse_args()
    if not os.path.isdir(args.photos):
        # Worktrees don't carry dist/; fall back to the main checkout's copy.
        args.photos = r'C:\Projects\agriOS\dist\test-photos'

    rng = np.random.default_rng(SEED)
    scene = background(rng).convert('RGBA')
    # Out-of-focus foliage in two depth layers, then a few soft branches.
    foliage(scene, rng, 260, (60, 160), [(30, 70, 28), (48, 96, 40), (70, 120, 52)], 9)
    foliage(scene, rng, 140, (110, 220), [(22, 52, 22), (40, 84, 34), (86, 132, 60)], 5)

    n = len(LEAVES)
    spacing = W / n
    records = []
    branch = Image.new('RGBA', scene.size, (0, 0, 0, 0))
    bd = ImageDraw.Draw(branch)
    centres = []
    for i, (cls, fname) in enumerate(LEAVES):
        cx = (i + 0.5) * spacing
        cy = H / 2 + rng.uniform(-30, 30)
        centres.append((cx, cy))
        # A stem from a branch below up to the leaf, so the leaf reads as "on a bush".
        def stem(x, cy=cy):
            bd.line([(x - 40, H * 0.82), (x - 10, cy + 60), (x, cy)], fill=(84, 62, 38, 255), width=9)
        wrapped(stem, cx)
    scene.alpha_composite(branch.filter(ImageFilter.GaussianBlur(2)))

    for i, (cls, fname) in enumerate(LEAVES):
        cx, cy = centres[i]
        leaf = cut_out_leaf(os.path.join(args.photos, fname))
        scale = LEAF_W / leaf.width
        leaf = leaf.resize((LEAF_W, max(1, round(leaf.height * scale))), Image.LANCZOS)
        leaf = leaf.rotate(rng.uniform(-14, 14), resample=Image.BICUBIC, expand=True)
        # Soft drop shadow so the leaf sits on the foliage rather than floating.
        shadow = Image.new('RGBA', leaf.size, (0, 0, 0, 0))
        shadow.putalpha(leaf.getchannel('A').point(lambda a: int(a * 0.45)))
        shadow = shadow.filter(ImageFilter.GaussianBlur(8))
        x0 = round(cx - leaf.width / 2)
        y0 = round(cy - leaf.height / 2)
        for dx in (-W, 0, W):
            composite(scene, shadow, x0 + dx + 10, y0 + 14)
            composite(scene, leaf, x0 + dx, y0)
        records.append({
            'class': cls,
            'source': fname,
            'x': round(cx / W, 5),
            'y': round(cy / H, 5),
            'widthPx': leaf.width,
            'heightPx': leaf.height,
        })

    logical = scene.convert('RGB')
    full = Image.new('RGB', (W + MARGIN, H))
    full.paste(logical, (0, 0))
    full.paste(logical.crop((0, 0, MARGIN, H)), (W, 0))

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, 'panorama.jpg')
    full.save(out, 'JPEG', quality=84, optimize=True, progressive=False)
    meta = {
        'image': 'panorama.jpg',
        'width': W,
        'wrapMargin': MARGIN,
        'height': H,
        'note': 'x/y are leaf centres as a fraction of width (one full turn, excluding the wrap margin) and height.',
        'leaves': records,
    }
    with open(os.path.join(OUT_DIR, 'leaves.json'), 'w') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')
    print(f'{out}: {full.width}x{full.height}, {os.path.getsize(out) / 1024:.0f} KB')


def composite(scene, im, x, y):
    """alpha_composite() that clips `im` to the scene (it rejects out-of-range offsets)."""
    l, t = max(0, -x), max(0, -y)
    r, b = min(im.width, scene.width - x), min(im.height, scene.height - y)
    if r > l and b > t:
        scene.alpha_composite(im.crop((l, t, r, b)), (x + l, y + t))


if __name__ == '__main__':
    main()
