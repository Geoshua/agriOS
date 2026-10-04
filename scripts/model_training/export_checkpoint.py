"""
Export a Keras checkpoint saved during training (e.g. checkpoint_phase1.keras)
to the app's TFLite + labels.json format — for shipping an interim model while
a longer fine-tuning run continues.

Usage:
  python export_checkpoint.py --checkpoint ~/output_run10a/checkpoint_phase1.keras \\
      --data-dir ~/leaf_split/train --out ./interim
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from train import CLASS_MAPPING  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--data-dir", required=True, help="Training folder (class subfolders) — defines the class order")
    ap.add_argument("--out", required=True)
    ap.add_argument("--threshold", type=float, default=0.6)
    a = ap.parse_args()

    import keras
    import tensorflow as tf

    out = Path(a.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    model = keras.models.load_model(Path(a.checkpoint).expanduser())
    size = int(model.input_shape[1])
    classes = sorted(d.name for d in Path(a.data_dir).expanduser().iterdir() if d.is_dir())  # Keras order

    model.export(str(out / "saved_model"))
    conv = tf.lite.TFLiteConverter.from_saved_model(str(out / "saved_model"))
    conv.optimizations = [tf.lite.Optimize.DEFAULT]  # dynamic range, as train.py's default
    (out / "plant_disease.tflite").write_bytes(conv.convert())

    labels = {
        "index_to_agrios_id": {str(i): CLASS_MAPPING.get(c, "unknown") for i, c in enumerate(classes)},
        "keras_class_indices": {c: i for i, c in enumerate(classes)},
        "num_classes": len(classes),
        "input_size": size,
        "input_dtype": "float32",
        "quantization": "dynamic",
        "confidence_threshold": a.threshold,
        "source_checkpoint": str(Path(a.checkpoint).name),
    }
    (out / "labels.json").write_text(json.dumps(labels, indent=2))
    print(json.dumps(labels["index_to_agrios_id"]), f"{(out / 'plant_disease.tflite').stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
