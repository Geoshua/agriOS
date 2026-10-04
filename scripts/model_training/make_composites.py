"""
Synthesise phone-camera-like training images from BRACOL.

Why: BRACOL leaves fill a landscape photo on a white background. A phone frame
shows a smaller leaf, at any angle, on soil / foliage / a table. Measured on
held-out photos, that shift took the model from 79% to 29% confident-correct
(and 26% confidently wrong) — see TRAINING.md → "Field-framing robustness".

What it does: splits each class into the same validation (first 20%, sorted —
what Keras' validation_split uses) and training files; cuts each TRAINING leaf
out of its white background; pastes it, rotated (any angle) and scaled (35–95%
of frame width), onto procedurally generated backgrounds in a 3:4 portrait
frame; centre-crops to square exactly like the app (lib/tflite.ts); then varies
light, blur and JPEG quality.

Output:
  <out>/train/<class>/   original training photos + N composites each   (SYNTHETIC composites)
  <out>/val/<class>/     untouched held-out originals

With --other-src, also builds an "other" class ("not a coffee leaf"; the app
shows it as unknown): leaves of other crops (e.g. PlantVillage, CC BY-SA), as-is
and composited, plus empty scenes with no leaf. Without it the model must call
every leaf one of the five coffee classes — measured: 33% of non-coffee
leaves got a confident coffee diagnosis.

Usage:
  python make_composites.py --src ~/bracol_small --out ~/bracol_split --per-image 3       [--other-src ~/plantvillage_other --empty-scenes 400]
"""

import argparse
import io
import random
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
from scipy import ndimage


def leaf_mask(im: Image.Image) -> np.ndarray:
    """Leaf = everything not connected-to-the-border low-saturation bright pixels."""
    hsv = np.asarray(im.convert("HSV"), dtype=np.float32) / 255.0
    s, v = hsv[..., 1], hsv[..., 2]
    bgish = (s < 0.22) & (v > 0.35)  # white paper + grey shadows
    lab, _ = ndimage.label(bgish)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bg = np.isin(lab, border[border > 0])
    leaf = ~bg
    leaf = ndimage.binary_opening(leaf, iterations=2)
    lab, n = ndimage.label(leaf)
    if n == 0:
        return leaf
    sizes = ndimage.sum(leaf, lab, range(1, n + 1))
    leaf = lab == (1 + int(np.argmax(sizes)))
    return ndimage.binary_fill_holes(leaf)


def background(w: int, h: int, rng: random.Random) -> Image.Image:
    kind = rng.choice(["soil", "foliage", "wood", "sky_foliage", "plain", "noise"])
    base = {
        "soil": (rng.randint(70, 130), rng.randint(50, 90), rng.randint(30, 60)),
        "foliage": (rng.randint(20, 70), rng.randint(70, 140), rng.randint(20, 70)),
        "wood": (rng.randint(120, 180), rng.randint(85, 130), rng.randint(50, 90)),
        "sky_foliage": (rng.randint(150, 210), rng.randint(180, 230), rng.randint(200, 250)),
        "plain": tuple(rng.randint(40, 230) for _ in range(3)),
        "noise": tuple(rng.randint(60, 180) for _ in range(3)),
    }[kind]
    arr = np.ones((h, w, 3), dtype=np.float32) * np.array(base, dtype=np.float32)
    nprng = np.random.default_rng(rng.randint(0, 2**31))
    # gradient + coarse and fine noise
    gy = np.linspace(-1, 1, h)[:, None, None] * rng.uniform(-30, 30)
    arr += gy
    coarse = nprng.normal(0, 1, (h // 40 + 2, w // 40 + 2, 3))
    coarse = np.asarray(Image.fromarray(((coarse - coarse.min()) / (np.ptp(coarse) + 1e-6) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), dtype=np.float32) - 128
    arr += coarse * rng.uniform(0.1, 0.5)
    arr += nprng.normal(0, rng.uniform(3, 18), (h, w, 3))
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    if kind == "wood":
        for _ in range(rng.randint(8, 20)):
            y = rng.randint(0, h)
            c = tuple(int(x * rng.uniform(0.75, 1.1)) for x in base)
            d.line([(0, y), (w, y + rng.randint(-60, 60))], fill=c, width=rng.randint(2, 10))
    if kind in ("foliage", "sky_foliage", "soil"):
        for _ in range(rng.randint(15, 60)):  # blurry leaf / clod blobs
            x, y, r = rng.randint(0, w), rng.randint(0, h), rng.randint(8, 70)
            g = (rng.randint(20, 90), rng.randint(60, 160), rng.randint(20, 80)) if kind != "soil" else \
                (rng.randint(60, 120), rng.randint(40, 85), rng.randint(25, 55))
            d.ellipse([x - r, y - r * rng.uniform(0.4, 1), x + r, y + r * rng.uniform(0.4, 1)], fill=g)
    return img.filter(ImageFilter.GaussianBlur(rng.uniform(0.5, 4)))


def composite(im: Image.Image, mask: np.ndarray, rng: random.Random) -> Image.Image:
    W, H = 600, 800  # phone portrait 3:4
    rgba = im.convert("RGBA")
    alpha = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    rgba.putalpha(alpha)
    bbox = alpha.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    rgba = rgba.rotate(rng.uniform(0, 360), expand=True, resample=Image.BICUBIC)
    rgba = rgba.crop(rgba.getbbox() or (0, 0, rgba.width, rgba.height))
    frac = rng.uniform(0.35, 0.95)
    scale = frac * W / max(rgba.width, 1)
    leaf = rgba.resize((max(1, int(rgba.width * scale)), max(1, int(rgba.height * scale))), Image.BICUBIC)
    bg = background(W, H, rng)
    # soft drop shadow sometimes (leaf on a surface)
    if rng.random() < 0.5:
        sh = Image.new("RGBA", leaf.size, (0, 0, 0, 0))
        sh.putalpha(leaf.getchannel("A").point(lambda a: int(a * 0.35)))
        sh = sh.filter(ImageFilter.GaussianBlur(8))
    else:
        sh = None
    cx = W // 2 + int(rng.uniform(-0.12, 0.12) * W) - leaf.width // 2
    cy = H // 2 + int(rng.uniform(-0.12, 0.12) * H) - leaf.height // 2
    if sh:
        bg.paste(sh, (cx + 10, cy + 12), sh)
    bg.paste(leaf, (cx, cy), leaf)
    # centre square, as lib/tflite.ts does with the camera frame
    s = min(W, H)
    out = bg.crop(((W - s) // 2, (H - s) // 2, (W + s) // 2, (H + s) // 2))
    out = ImageEnhance.Brightness(out).enhance(rng.uniform(0.55, 1.35))
    out = ImageEnhance.Contrast(out).enhance(rng.uniform(0.7, 1.3))
    out = ImageEnhance.Color(out).enhance(rng.uniform(0.75, 1.3))
    if rng.random() < 0.4:
        out = out.filter(ImageFilter.GaussianBlur(rng.uniform(0.5, 2.5)))
    buf = io.BytesIO()
    out.convert("RGB").resize((320, 320), Image.BILINEAR).save(buf, "JPEG", quality=rng.randint(35, 90))
    return Image.open(io.BytesIO(buf.getvalue()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--per-image", type=int, default=3)
    ap.add_argument("--val-split", type=float, default=0.2)
    ap.add_argument("--other-src", default=None, help="Folder of non-coffee leaf photos for an 'other' class")
    ap.add_argument("--empty-scenes", type=int, default=400, help="Leaf-free background images added to 'other'")
    ap.add_argument("--preview", type=int, default=0, help="Only write N composites to <out>/preview and stop")
    args = ap.parse_args()
    src, out = Path(args.src).expanduser(), Path(args.out).expanduser()
    rng = random.Random(20261004)

    if args.preview:
        (out / "preview").mkdir(parents=True, exist_ok=True)
        files = sorted(p for c in sorted(src.iterdir()) for p in sorted(c.iterdir()))
        for i, p in enumerate(rng.sample(files, args.preview)):
            im = Image.open(p).convert("RGB")
            m = leaf_mask(im)
            Image.fromarray((m * 255).astype(np.uint8)).save(out / "preview" / f"{i}_mask.png")
            composite(im, m, rng).save(out / "preview" / f"{i}_{p.parent.name}.jpg")
        return

    if out.exists():
        shutil.rmtree(out)
    stats = {}
    for cdir in sorted(src.iterdir()):
        files = sorted(cdir.iterdir())
        n_val = int(len(files) * args.val_split)
        (out / "val" / cdir.name).mkdir(parents=True)
        (out / "train" / cdir.name).mkdir(parents=True)
        for p in files[:n_val]:
            shutil.copy(p, out / "val" / cdir.name / p.name)
        made = 0
        for p in files[n_val:]:
            shutil.copy(p, out / "train" / cdir.name / p.name)
            im = Image.open(p).convert("RGB")
            m = leaf_mask(im)
            if m.mean() < 0.03:  # segmentation failed — keep the original only
                continue
            for k in range(args.per_image):
                composite(im, m, rng).save(out / "train" / cdir.name / f"syn{k}_{p.stem}.jpg", quality=95)
                made += 1
        stats[cdir.name] = {"val": n_val, "train_orig": len(files) - n_val, "synthetic": made}

    if args.other_src:
        files = sorted(Path(args.other_src).expanduser().glob("*.jpg"))
        rng.shuffle(files)
        n_val = int(len(files) * 0.15)
        (out / "val" / "other").mkdir(parents=True)
        (out / "train" / "other").mkdir(parents=True)
        made = 0
        for i, p in enumerate(files):
            im = Image.open(p).convert("RGB")
            im.thumbnail((640, 640))
            if i < n_val:
                im.save(out / "val" / "other" / p.name, quality=92)
                continue
            im.save(out / "train" / "other" / p.name, quality=92)
            m = leaf_mask(im)
            if m.mean() > 0.03:
                composite(im, m, rng).save(out / "train" / "other" / f"syn_{p.stem}.jpg", quality=95)
                made += 1
        for k in range(args.empty_scenes):  # no leaf at all
            bg = background(600, 800, rng).crop((0, 100, 600, 700)).resize((320, 320))
            target = out / ("val" if k < args.empty_scenes * 0.15 else "train") / "other" / f"empty_{k}.jpg"
            bg.save(target, quality=rng.randint(40, 90))
        stats["other"] = {"val": n_val + int(args.empty_scenes * 0.15), "train_orig": len(files) - n_val,
                          "synthetic": made, "empty_scenes": args.empty_scenes}
    print(stats)


if __name__ == "__main__":
    main()
