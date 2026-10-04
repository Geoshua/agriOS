"""
Build the "any leaf" training set: coffee diseases + healthy (any crop) +
other_disease (non-coffee leaf problems) + no_leaf.

Why: the coffee-only model (BRACOL on white paper) could not even recognise an
ordinary healthy leaf outdoors — it said "Not sure" or "Leaf rust". The bare
minimum is: is there a leaf, and does it look healthy?

Sources (cite in the submission):
  * BRACOL (Mendeley, CC BY 4.0) — via make_composites.py output (--coffee)
  * PlantVillage (CC BY-SA 3.0; lab photos, plain background) — healthy folders
    (--pv-healthy) and a sample of diseased classes (--pv-other: flat folder)
  * PlantDoc (CC BY 4.0; real field photos) — train split for training; its
    TEST split is written to <out>/test_field for an honest outdoor evaluation
  * no_leaf: procedurally generated empty scenes (SYNTHETIC)

Output: <out>/train/<class>/, <out>/val/<class>/, <out>/test_field/<healthy|other_disease>/

Usage:
  python make_leaf_dataset.py --coffee ~/bracol_split --pv-healthy <PlantVillage>/raw/color \\
      --pv-other ~/plantvillage_other --plantdoc <PlantDoc-Dataset-master> --out ~/leaf_split
"""

import argparse
import random
import shutil
from pathlib import Path

from PIL import Image

from make_composites import background

COFFEE = ["rust", "miner", "phoma", "cercospora", "healthy"]
# PlantDoc folder names without a disease word are healthy leaves.
PLANTDOC_HEALTHY = {"Apple leaf", "Bell_pepper leaf", "Blueberry leaf", "Cherry leaf", "Peach leaf",
                    "Raspberry leaf", "Soyabean leaf", "Strawberry leaf", "Tomato leaf", "grape leaf"}


def save_small(src: Path, dst: Path, size=448):
    try:
        im = Image.open(src).convert("RGB")
    except Exception:
        return False
    im.thumbnail((size, size))
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, quality=90)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--coffee", required=True, help="make_composites.py output (train/ and val/)")
    ap.add_argument("--pv-healthy", required=True, help="PlantVillage raw/color (folders *___healthy)")
    ap.add_argument("--pv-other", required=True, help="Flat folder of PlantVillage leaves (diseased ones are used)")
    ap.add_argument("--plantdoc", required=True, help="PlantDoc-Dataset-master (train/, test/)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--pv-healthy-per-crop", type=int, default=120)
    ap.add_argument("--empty-scenes", type=int, default=700)
    a = ap.parse_args()
    rng = random.Random(20261004)
    out = Path(a.out).expanduser()
    if out.exists():
        shutil.rmtree(out)

    # 1. Coffee: copy as is (validation = BRACOL held-out originals).
    for split in ("train", "val"):
        for c in COFFEE:
            src = Path(a.coffee).expanduser() / split / c
            dst = out / split / c
            shutil.copytree(src, dst)

    # 2. Healthy leaves of other crops (PlantVillage), 15% to validation.
    for d in sorted(Path(a.pv_healthy).expanduser().glob("*healthy*")):
        files = sorted(d.iterdir())
        rng.shuffle(files)
        files = files[: a.pv_healthy_per_crop]
        n_val = max(3, len(files) * 15 // 100)
        for i, f in enumerate(files):
            split = "val" if i < n_val else "train"
            save_small(f, out / split / "healthy" / f"pv_{d.name[:20]}_{i}.jpg")

    # 3. Diseased leaves of other crops (PlantVillage sample), 15% to validation.
    other = [f for f in sorted(Path(a.pv_other).expanduser().glob("*.jpg")) if "healthy" not in f.name.lower()]
    rng.shuffle(other)
    n_val = len(other) * 15 // 100
    for i, f in enumerate(other):
        save_small(f, out / ("val" if i < n_val else "train") / "other_disease" / f"pv_{f.name}")

    # 4. PlantDoc field photos: train split → train (x2 weight via duplicates not needed;
    #    augmentation varies them), test split → test_field (never trained on).
    pd = Path(a.plantdoc).expanduser()
    for split, target in (("train", "train"), ("test", "test_field")):
        for d in sorted((pd / split).iterdir()):
            cls = "healthy" if d.name in PLANTDOC_HEALTHY else "other_disease"
            for i, f in enumerate(sorted(d.iterdir())):
                save_small(f, out / target / cls / f"pd_{d.name.replace(' ', '_')}_{i}.jpg")

    # 5. No leaf: empty procedural scenes (SYNTHETIC).
    for k in range(a.empty_scenes):
        bg = background(600, 800, rng).crop((0, 100, 600, 700)).resize((320, 320))
        split = "val" if k < a.empty_scenes * 0.15 else "train"
        (out / split / "no_leaf").mkdir(parents=True, exist_ok=True)
        bg.save(out / split / "no_leaf" / f"empty_{k}.jpg", quality=rng.randint(40, 90))

    for split in ("train", "val", "test_field"):
        counts = {c.name: len(list(c.iterdir())) for c in sorted((out / split).iterdir())}
        print(split, counts)


if __name__ == "__main__":
    main()
