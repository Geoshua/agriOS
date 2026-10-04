"""
agriOS — per-class evaluation of the exported TFLite model.

Scores the TFLite model (the file that ships) on the same held-out 20%
validation split that train.py uses — not the full dataset, which would
include training images and inflate the numbers.

Usage:
    python evaluate.py --data-dir /path/to/bracol --model-dir ./output
"""

import argparse
import json
from pathlib import Path

import numpy as np


def main():
    parser = argparse.ArgumentParser(description="agriOS TFLite per-class evaluation")
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--model-dir", default="./output")
    parser.add_argument("--min-accuracy", type=float, default=0.88)
    parser.add_argument("--min-recall", type=float, default=0.75)
    args = parser.parse_args()

    import tensorflow as tf
    from tensorflow.keras.preprocessing.image import ImageDataGenerator

    sys_path = Path(__file__).resolve().parent
    import sys
    sys.path.insert(0, str(sys_path))
    from train import find_image_root

    model_dir = Path(args.model_dir)
    labels = json.loads((model_dir / "labels.json").read_text())
    id_to_name = {int(k): v for k, v in labels["index_to_agrios_id"].items()}
    size = labels["input_size"]
    threshold = labels["confidence_threshold"]

    image_root = find_image_root(Path(args.data_dir).expanduser().resolve())
    gen = ImageDataGenerator(rescale=1.0 / 255, validation_split=0.2).flow_from_directory(
        image_root,
        target_size=(size, size),
        batch_size=32,
        class_mode="categorical",
        subset="validation",
        shuffle=False,
    )

    interp = tf.lite.Interpreter(model_path=str(model_dir / "plant_disease.tflite"))
    interp.allocate_tensors()
    inp, out = interp.get_input_details()[0], interp.get_output_details()[0]

    preds, trues, confs = [], [], []
    for imgs, lbls in gen:
        for img, lbl in zip(imgs, lbls):
            if inp["dtype"] == np.uint8:
                pixel = np.round(img * 255).astype(np.uint8)[np.newaxis]
            else:
                pixel = img.astype(np.float32)[np.newaxis]
            interp.set_tensor(inp["index"], pixel)
            interp.invoke()
            probs = interp.get_tensor(out["index"])[0]
            preds.append(int(np.argmax(probs)))
            confs.append(float(np.max(probs)))
            trues.append(int(np.argmax(lbl)))
        if len(preds) >= gen.samples:
            break

    preds, trues, confs = np.array(preds), np.array(trues), np.array(confs)
    n = len(id_to_name)
    acc = float((preds == trues).mean())

    print(f"\nTFLite INT8 on held-out validation split ({len(trues)} images)")
    print(f"{'class':<20}{'precision':>10}{'recall':>8}{'support':>9}")
    min_recall = 1.0
    for i in range(n):
        tp = int(((preds == i) & (trues == i)).sum())
        p = tp / max(int((preds == i).sum()), 1)
        r = tp / max(int((trues == i).sum()), 1)
        min_recall = min(min_recall, r)
        print(f"{id_to_name[i]:<20}{p:>10.2f}{r:>8.2f}{int((trues == i).sum()):>9}")

    print("\nConfusion matrix (rows = true, cols = predicted):")
    cm = np.zeros((n, n), dtype=int)
    for t, p in zip(trues, preds):
        cm[t, p] += 1
    print(cm)

    confident = confs >= threshold
    print(f"\nOverall accuracy:          {acc:.4f}")
    print(f"Below threshold ({threshold:.2f}) → 'unknown': {(~confident).mean():.1%}")
    if confident.any():
        print(f"Accuracy when confident:   {(preds[confident] == trues[confident]).mean():.4f}")

    passed = acc >= args.min_accuracy and min_recall >= args.min_recall
    print(f"\nGOAL (acc ≥ {args.min_accuracy}, every recall ≥ {args.min_recall}): "
          f"{'PASS' if passed else 'FAIL'}  (acc {acc:.3f}, min recall {min_recall:.3f})")


if __name__ == "__main__":
    main()
