"""
agriOS — Coffee Leaf Disease Classifier — Local GPU Training Script
====================================================================
Standalone script for training on a local machine with a CUDA GPU.
Trains MobileNetV2 on BRACOL dataset, exports INT8-quantised TFLite model.

Usage:
    python train.py --data-dir /path/to/bracol --output-dir ./output

Typical runtime: 30–60 min on RTX 3080/4080 with BRACOL (~1,700 images).
Expected validation accuracy: 85–93% after fine-tuning.

See TRAINING.md for full setup instructions and expected output.
"""

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("agrios-train")


# ── Config ────────────────────────────────────────────────────────────────────

IMG_SIZE = 224
BATCH_SIZE = 32
PHASE1_EPOCHS = 10   # train head only
PHASE2_EPOCHS = 20   # fine-tune top backbone layers
NUM_CLASSES = 5

# BRACOL folder name → agriOS disease ID.
# Covers the naming variations seen across BRACOL dataset versions.
CLASS_MAPPING = {
    "rust":             "coffee_leaf_rust",
    "leaf_rust":        "coffee_leaf_rust",
    "Rust":             "coffee_leaf_rust",
    "Leaf_Rust":        "coffee_leaf_rust",
    "miner":            "coffee_leaf_miner",
    "leaf_miner":       "coffee_leaf_miner",
    "Miner":            "coffee_leaf_miner",
    "Leaf_Miner":       "coffee_leaf_miner",
    "phoma":            "coffee_phoma",
    "brown_spot":       "coffee_phoma",
    "Phoma":            "coffee_phoma",
    "Brown_Spot":       "coffee_phoma",
    "cercospora":       "coffee_brown_eye",
    "brown_eye_spot":   "coffee_brown_eye",
    "Cercospora":       "coffee_brown_eye",
    "Brown_Eye_Spot":   "coffee_brown_eye",
    "healthy":          "healthy",
    "Healthy":          "healthy",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def find_image_root(base: Path) -> Path:
    """Walk base to find the directory whose subdirs each contain images."""
    for p in sorted(base.rglob("*")):
        if not p.is_dir():
            continue
        subdirs = [d for d in p.iterdir() if d.is_dir()]
        if len(subdirs) >= 3:
            has_images = any(
                any(f.suffix.lower() in {".jpg", ".jpeg", ".png"} for f in d.iterdir())
                for d in subdirs[:3]
            )
            if has_images:
                return p
    return base


def check_classes(image_root: Path) -> list[str]:
    known = set(CLASS_MAPPING.keys())
    found = [d.name for d in image_root.iterdir() if d.is_dir()]
    unmapped = [c for c in found if c not in known]
    if unmapped:
        log.warning(
            "These dataset folders have no mapping: %s\n"
            "Add them to CLASS_MAPPING in train.py if they are disease classes.",
            unmapped,
        )
    return found


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="agriOS TFLite model training")
    parser.add_argument("--data-dir", required=True, help="Path to extracted BRACOL dataset")
    parser.add_argument("--output-dir", default="./output", help="Where to save model files")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--phase1-epochs", type=int, default=PHASE1_EPOCHS)
    parser.add_argument("--phase2-epochs", type=int, default=PHASE2_EPOCHS)
    args = parser.parse_args()

    data_dir = Path(args.data_dir).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if not data_dir.exists():
        log.error("Data directory does not exist: %s", data_dir)
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)
    log.info("Data dir:   %s", data_dir)
    log.info("Output dir: %s", output_dir)

    # Import TF after arg parse so --help is fast
    log.info("Importing TensorFlow…")
    import tensorflow as tf
    from tensorflow import keras
    from tensorflow.keras.preprocessing.image import ImageDataGenerator

    log.info("TensorFlow %s | GPUs: %s", tf.__version__, tf.config.list_physical_devices("GPU"))

    # ── Dataset ───────────────────────────────────────────────────────────────
    image_root = find_image_root(data_dir)
    log.info("Image root: %s", image_root)
    classes = check_classes(image_root)
    log.info("Classes found: %s", classes)

    augment = ImageDataGenerator(
        rescale=1.0 / 255,
        validation_split=0.2,
        rotation_range=30,
        width_shift_range=0.15,
        height_shift_range=0.15,
        shear_range=0.1,
        zoom_range=0.2,
        horizontal_flip=True,
        vertical_flip=True,
        brightness_range=[0.6, 1.4],
        channel_shift_range=30.0,
        fill_mode="nearest",
    )

    train_gen = augment.flow_from_directory(
        image_root,
        target_size=(IMG_SIZE, IMG_SIZE),
        batch_size=args.batch_size,
        class_mode="categorical",
        subset="training",
        shuffle=True,
    )

    val_gen = augment.flow_from_directory(
        image_root,
        target_size=(IMG_SIZE, IMG_SIZE),
        batch_size=args.batch_size,
        class_mode="categorical",
        subset="validation",
        shuffle=False,
    )

    keras_classes = train_gen.class_indices
    index_to_agrios = {
        str(idx): CLASS_MAPPING.get(name, "unknown")
        for name, idx in keras_classes.items()
    }
    log.info("Index → agriOS mapping: %s", index_to_agrios)
    log.info("Train samples: %d | Val samples: %d", train_gen.samples, val_gen.samples)

    # ── Model ─────────────────────────────────────────────────────────────────
    log.info("Building MobileNetV2 (ImageNet weights)…")
    base = keras.applications.MobileNetV2(
        input_shape=(IMG_SIZE, IMG_SIZE, 3),
        include_top=False,
        weights="imagenet",
    )
    base.trainable = False

    model = keras.Sequential([
        base,
        keras.layers.GlobalAveragePooling2D(),
        keras.layers.Dropout(0.3),
        keras.layers.Dense(128, activation="relu"),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(train_gen.num_classes, activation="softmax"),
    ])

    model.compile(
        optimizer=keras.optimizers.Adam(1e-3),
        loss="categorical_crossentropy",
        metrics=["accuracy"],
    )

    callbacks = [
        keras.callbacks.EarlyStopping(patience=4, restore_best_weights=True),
        keras.callbacks.ReduceLROnPlateau(factor=0.5, patience=2, min_lr=1e-6),
        keras.callbacks.ModelCheckpoint(
            str(output_dir / "checkpoint_phase1.h5"),
            save_best_only=True,
            monitor="val_accuracy",
        ),
    ]

    # ── Phase 1: train head only ───────────────────────────────────────────────
    log.info("Phase 1: training head only (%d epochs)…", args.phase1_epochs)
    t0 = time.time()
    model.fit(train_gen, validation_data=val_gen, epochs=args.phase1_epochs, callbacks=callbacks)
    log.info("Phase 1 done in %.1f min", (time.time() - t0) / 60)

    # ── Phase 2: fine-tune top backbone layers ─────────────────────────────────
    log.info("Phase 2: fine-tuning top 30 backbone layers (%d epochs)…", args.phase2_epochs)
    base.trainable = True
    for layer in base.layers[:-30]:
        layer.trainable = False

    callbacks[2] = keras.callbacks.ModelCheckpoint(
        str(output_dir / "checkpoint_phase2.h5"),
        save_best_only=True,
        monitor="val_accuracy",
    )

    model.compile(
        optimizer=keras.optimizers.Adam(1e-4),
        loss="categorical_crossentropy",
        metrics=["accuracy"],
    )

    t0 = time.time()
    history = model.fit(
        train_gen,
        validation_data=val_gen,
        epochs=args.phase2_epochs,
        callbacks=callbacks,
    )
    log.info("Phase 2 done in %.1f min", (time.time() - t0) / 60)

    val_acc = max(history.history["val_accuracy"])
    log.info("Best val accuracy: %.4f (%.1f%%)", val_acc, val_acc * 100)

    # ── TFLite INT8 export ────────────────────────────────────────────────────
    log.info("Exporting TFLite INT8 model…")

    def representative_dataset():
        for images, _ in train_gen:
            for img in images[:4]:
                yield [np.expand_dims(img, 0).astype(np.float32)]
            break

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = representative_dataset
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.uint8
    converter.inference_output_type = tf.float32

    tflite_bytes = converter.convert()

    tflite_path = output_dir / "plant_disease.tflite"
    tflite_path.write_bytes(tflite_bytes)
    log.info("TFLite model: %s (%.0f KB)", tflite_path, len(tflite_bytes) / 1024)

    # ── Labels JSON ───────────────────────────────────────────────────────────
    labels_data = {
        "index_to_agrios_id": index_to_agrios,
        "keras_class_indices": keras_classes,
        "val_accuracy": float(val_acc),
        "num_classes": int(train_gen.num_classes),
        "input_size": IMG_SIZE,
        "confidence_threshold": 0.60,
    }
    labels_path = output_dir / "labels.json"
    labels_path.write_text(json.dumps(labels_data, indent=2))
    log.info("Labels JSON: %s", labels_path)

    # ── Verify ────────────────────────────────────────────────────────────────
    log.info("Verifying TFLite model…")
    interpreter = tf.lite.Interpreter(model_path=str(tflite_path))
    interpreter.allocate_tensors()
    inp = interpreter.get_input_details()
    out = interpreter.get_output_details()
    log.info("  Input:  shape=%s  dtype=%s", inp[0]["shape"], inp[0]["dtype"])
    log.info("  Output: shape=%s  dtype=%s", out[0]["shape"], out[0]["dtype"])

    test = np.random.randint(0, 255, tuple(inp[0]["shape"]), dtype=np.uint8)
    interpreter.set_tensor(inp[0]["index"], test)
    interpreter.invoke()
    log.info("  Test prediction (random noise): %s", interpreter.get_tensor(out[0]["index"]))

    print("\n" + "=" * 60)
    print("TRAINING COMPLETE")
    print("=" * 60)
    print(f"Validation accuracy : {val_acc * 100:.1f}%")
    print(f"Model size          : {len(tflite_bytes) / 1024:.0f} KB")
    print(f"Output files        :")
    print(f"  {tflite_path}")
    print(f"  {labels_path}")
    print()
    print("Next step — copy both files into the app:")
    print(f"  cp {tflite_path} <agriOS-repo>/assets/model/plant_disease.tflite")
    print(f"  cp {labels_path} <agriOS-repo>/assets/model/labels.json")
    print()
    print("Then uncomment the TFLite block in agriOS/lib/inference.ts")
    print("and run: npx expo start --android")
    print("=" * 60)


if __name__ == "__main__":
    main()
