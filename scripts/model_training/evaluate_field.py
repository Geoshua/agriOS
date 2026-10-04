"""
Outdoor evaluation of the shipped TFLite model on PlantDoc's TEST split
(real field photos, never trained on), with the app's own rules: centre-square
crop, 0.60 confidence threshold → "Not sure".

For healthy field leaves: how often "Healthy" / "Not sure" / a problem is flagged.
For diseased field leaves: how often a problem is flagged / missed as healthy / "Not sure".

Usage: python evaluate_field.py --test-dir ~/leaf_split/test_field --model-dir ./output
"""
import argparse, json
from pathlib import Path
import numpy as np
from PIL import Image

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test-dir", required=True)
    ap.add_argument("--model-dir", required=True)
    a = ap.parse_args()
    import tensorflow as tf
    md = Path(a.model_dir).expanduser()
    lab = json.loads((md / "labels.json").read_text())
    ids = lab["index_to_agrios_id"]; size = lab["input_size"]; th = lab["confidence_threshold"]
    it = tf.lite.Interpreter(model_path=str(md / "plant_disease.tflite")); it.allocate_tensors()
    I = it.get_input_details()[0]; O = it.get_output_details()[0]
    problems = {"coffee_leaf_rust", "coffee_leaf_miner", "coffee_phoma", "coffee_brown_eye", "other_disease"}
    for truth in ("healthy", "other_disease"):
        files = sorted((Path(a.test_dir).expanduser() / truth).glob("*.jpg"))
        out = {"healthy": 0, "problem flagged": 0, "not sure": 0, "no leaf": 0}
        for f in files:
            im = Image.open(f).convert("RGB"); w, h = im.size; s = min(w, h)
            im = im.crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2)).resize((size, size), Image.BILINEAR)
            x = np.asarray(im, dtype=np.float32)[None] / 255.0
            if I["dtype"] == np.uint8: x = np.round(x * 255).astype(np.uint8)
            it.set_tensor(I["index"], x); it.invoke(); p = it.get_tensor(O["index"])[0]
            k = str(int(p.argmax())); c = float(p.max()); pid = ids.get(k, "unknown")
            if c < th: out["not sure"] += 1
            elif pid == "healthy": out["healthy"] += 1
            elif pid == "no_leaf": out["no leaf"] += 1
            elif pid in problems: out["problem flagged"] += 1
        n = len(files)
        print(f"field {truth:<14} n={n:<4} " + "  ".join(f"{k}: {v/n:.0%}" for k, v in out.items()))

if __name__ == "__main__":
    main()
