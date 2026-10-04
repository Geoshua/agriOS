"""
Offline check of the demo-scene crop logic in components/scan/DemoScene.tsx.

For each leaf in assets/demo-scene/leaves.json, centre the view on that leaf exactly
as the app does (view window VIEW_W px wide, 3:4 portrait crop, wrap via the margin)
and save the crop. Also verifies the wrap margin repeats the start of the panorama and
that a crop straddling the seam is continuous.

Usage:  python scripts/demo_scene/check_crops.py [OUT_DIR]
"""

import json
import os
import sys
import tempfile

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SCENE = os.path.join(ROOT, 'assets', 'demo-scene')
VIEW_W = 420  # must match VIEW_W_PX in DemoScene.tsx


def crop_rect(meta, cx, cy):
    """Mirror of cropRect() in DemoScene.tsx."""
    W, H, M = meta['width'], meta['height'], meta['wrapMargin']
    cw = min(VIEW_W, M)
    ch = min(round(cw * 4 / 3), H)
    x0 = (cx - cw / 2) % W
    y0 = min(max(cy - ch / 2, 0), H - ch)
    return round(x0) % W, round(y0), cw, ch


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), 'demo_scene_crops')
    os.makedirs(out, exist_ok=True)
    meta = json.load(open(os.path.join(SCENE, 'leaves.json')))
    pano = Image.open(os.path.join(SCENE, meta['image'])).convert('RGB')
    W, H, M = meta['width'], meta['height'], meta['wrapMargin']
    assert pano.size == (W + M, H), pano.size

    a = np.asarray(pano).astype(int)
    seam_err = np.abs(a[:, W:W + M] - a[:, :M]).mean()
    # JPEG blocks are 8 px aligned and W, M are multiples of 8, so the copy is near-exact.
    print(f'wrap margin vs start: mean abs diff {seam_err:.2f}')
    jump = np.abs(a[:, W - 1] - a[:, W]).mean()
    print(f'seam continuity (col W-1 vs W): mean abs diff {jump:.2f}')

    for i, leaf in enumerate(meta['leaves']):
        cx, cy = leaf['x'] * W, H / 2  # pitch 0 → vertical centre
        x, y, cw, ch = crop_rect(meta, cx, cy)
        assert x + cw <= W + M
        crop = pano.crop((x, y, x + cw, y + ch))
        path = os.path.join(out, f'{i}_{leaf["class"]}.jpg')
        crop.save(path, quality=90)
        print(f'{path}: {cw}x{ch} at ({x},{y}); leaf {leaf["widthPx"]}x{leaf["heightPx"]} '
              f'= {leaf["widthPx"] / cw:.0%} of view width')

    # A view centred exactly on the seam must come out of the margin, not wrap.
    x, y, cw, ch = crop_rect(meta, 0, H / 2)
    pano.crop((x, y, x + cw, y + ch)).save(os.path.join(out, 'seam.jpg'), quality=90)
    print(f'seam crop at x={x} (W={W}): ok')

    pano.resize(((W + M) // 4, H // 4)).save(os.path.join(out, 'overview.jpg'), quality=85)


if __name__ == '__main__':
    main()
