"""
Convert the Mendeley BRACOL download into the class-folder layout train.py expects.

The Mendeley archive (https://data.mendeley.com/datasets/yy2k5y8mxg/1) is NOT
split into class folders. It ships:
    coffee-datasets/leaf/images/<id>.jpg
    coffee-datasets/leaf/dataset.csv   (id, predominant_stress, miner, rust, phoma, cercospora, severity)

predominant_stress codes (verified against the per-stress columns):
    0 healthy · 1 miner · 2 rust · 3 phoma · 4 cercospora · 5 mixed, no predominant stress (skipped)

Also: the hosted ZIP is truncated (as of 2026-10) — standard unzip tools fail.
Extract with 7-Zip, which recovers ~1,400 of the 1,747 images; this script skips
any image that doesn't decode.

Images are downscaled (longest side 640 px) — the originals are 2048×1024 and
decoding them every epoch makes training CPU-bound.

Usage:
    python prepare_bracol.py --src /path/to/coffee-datasets/leaf --out ~/bracol_small
"""

import argparse
import csv
from pathlib import Path

from PIL import Image

CODE_TO_FOLDER = {"0": "healthy", "1": "miner", "2": "rust", "3": "phoma", "4": "cercospora"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", required=True, help="Folder containing dataset.csv and images/")
    parser.add_argument("--out", required=True)
    parser.add_argument("--max-side", type=int, default=640)
    args = parser.parse_args()

    src, out = Path(args.src).expanduser(), Path(args.out).expanduser()
    for name in CODE_TO_FOLDER.values():
        (out / name).mkdir(parents=True, exist_ok=True)

    kept, missing, broken, skipped = 0, 0, 0, 0
    with open(src / "dataset.csv", newline="") as f:
        for row in csv.DictReader(f):
            folder = CODE_TO_FOLDER.get(row["predominant_stress"])
            if folder is None:
                skipped += 1
                continue
            img_path = src / "images" / f"{row['id']}.jpg"
            if not img_path.exists():
                missing += 1
                continue
            try:
                im = Image.open(img_path)
                im.load()
            except Exception:
                broken += 1
                continue
            im = im.convert("RGB")
            im.thumbnail((args.max_side, args.max_side), Image.LANCZOS)
            im.save(out / folder / img_path.name, quality=92)
            kept += 1

    print(f"kept {kept} | missing {missing} | undecodable {broken} | mixed-stress skipped {skipped}")
    for name in CODE_TO_FOLDER.values():
        print(f"  {name:<11} {len(list((out / name).iterdir()))}")


if __name__ == "__main__":
    main()
