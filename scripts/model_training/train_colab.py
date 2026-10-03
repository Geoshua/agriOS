"""
agriOS — Coffee Leaf Disease TFLite Model Training
====================================================
Run this in Google Colab (GPU runtime).
Runtime > Change runtime type > T4 GPU

Trains MobileNetV2 on BRACOL + augmented PlantVillage coffee data.
Exports INT8 quantized TFLite model (~4–6MB).

Steps:
  1. Open https://colab.research.google.com
  2. File > Upload notebook > upload this file (or paste code cell by cell)
  3. Runtime > Change runtime type > T4 GPU (free)
  4. Run all cells
  5. Download 'plant_disease.tflite' + 'labels.json' from /content/output/
  6. Place in agriOS/assets/model/
"""

# ── CELL 1: Install deps ─────────────────────────────────────────────────────
# !pip install tensorflow kaggle albumentations pillow -q

# ── CELL 2: Mount Drive + Kaggle credentials ─────────────────────────────────
# If downloading from Kaggle, upload your kaggle.json first:
# from google.colab import files
# files.upload()  # upload kaggle.json
# !mkdir -p ~/.kaggle && cp kaggle.json ~/.kaggle/ && chmod 600 ~/.kaggle/kaggle.json

# ── CELL 3: Download BRACOL dataset ──────────────────────────────────────────
import os, json, shutil, zipfile
import numpy as np
from pathlib import Path

DATA_DIR = Path("/content/data")
OUTPUT_DIR = Path("/content/output")
OUTPUT_DIR.mkdir(exist_ok=True)

# Option A: Kaggle (recommended — run after uploading kaggle.json)
# !kaggle datasets download -d alvarole/coffee-leaves-disease -p /content/data --unzip

# Option B: Manual upload — download BRACOL from:
#   https://data.mendeley.com/datasets/yy2k5y8mxg/1
#   Unzip to /content/data/
# Then set DATA_DIR to the extracted folder.

print("Dataset location:", DATA_DIR)
print("Files:", list(DATA_DIR.rglob("*.jpg"))[:5] if DATA_DIR.exists() else "Not yet downloaded")

# ── CELL 4: Inspect and map classes ──────────────────────────────────────────
import tensorflow as tf
from tensorflow import keras

# BRACOL class names → agriOS disease IDs
# Adjust these keys to match actual folder names in your downloaded dataset
CLASS_MAPPING = {
    # Folder name in dataset → agriOS disease ID
    "rust":         "coffee_leaf_rust",
    "miner":        "coffee_leaf_miner",
    "phoma":        "coffee_phoma",
    "cercospora":   "coffee_brown_eye",
    "healthy":      "healthy",
    # Aliases (BRACOL uses different names in some versions)
    "leaf_rust":    "coffee_leaf_rust",
    "leaf_miner":   "coffee_leaf_miner",
    "brown_spot":   "coffee_phoma",
    "brown_eye_spot": "coffee_brown_eye",
    "Rust":         "coffee_leaf_rust",
    "Miner":        "coffee_leaf_miner",
    "Phoma":        "coffee_phoma",
    "Cercospora":   "coffee_brown_eye",
    "Healthy":      "healthy",
}

IMG_SIZE = 224
BATCH_SIZE = 32
EPOCHS = 20
NUM_CLASSES = 5  # rust, miner, phoma, cercospora, healthy

# ── CELL 5: Build dataset ────────────────────────────────────────────────────
from tensorflow.keras.preprocessing.image import ImageDataGenerator

# Find the dataset root (adjust path based on actual download structure)
# Walk the data dir to find image folders
def find_image_root(base: Path):
    for p in base.rglob("*"):
        if p.is_dir() and any(f.suffix.lower() in {".jpg", ".jpeg", ".png"} for f in p.iterdir()):
            parent = p.parent
            classes = [d.name for d in parent.iterdir() if d.is_dir()]
            if len(classes) >= 3:
                return parent
    return base

image_root = find_image_root(DATA_DIR)
print("Image root:", image_root)
print("Classes found:", [d.name for d in image_root.iterdir() if d.is_dir()])

# Standard augmentation matching real field conditions
train_datagen = ImageDataGenerator(
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
    channel_shift_range=30.0,   # poor white balance
    fill_mode="nearest",
)

train_gen = train_datagen.flow_from_directory(
    image_root,
    target_size=(IMG_SIZE, IMG_SIZE),
    batch_size=BATCH_SIZE,
    class_mode="categorical",
    subset="training",
    shuffle=True,
)

val_gen = train_datagen.flow_from_directory(
    image_root,
    target_size=(IMG_SIZE, IMG_SIZE),
    batch_size=BATCH_SIZE,
    class_mode="categorical",
    subset="validation",
    shuffle=False,
)

# Save the index → disease ID mapping
keras_classes = train_gen.class_indices  # e.g. {"healthy": 0, "miner": 1, ...}
index_to_agriOS = {}
for folder_name, idx in keras_classes.items():
    agriOS_id = CLASS_MAPPING.get(folder_name, "unknown")
    index_to_agriOS[str(idx)] = agriOS_id

print("Class mapping:", index_to_agriOS)
print("Training samples:", train_gen.samples)
print("Validation samples:", val_gen.samples)

# ── CELL 6: Build model ──────────────────────────────────────────────────────
base = keras.applications.MobileNetV2(
    input_shape=(IMG_SIZE, IMG_SIZE, 3),
    include_top=False,
    weights="imagenet",
)
base.trainable = False  # freeze backbone for first phase

model = keras.Sequential([
    base,
    keras.layers.GlobalAveragePooling2D(),
    keras.layers.Dropout(0.3),
    keras.layers.Dense(128, activation="relu"),
    keras.layers.Dropout(0.2),
    keras.layers.Dense(NUM_CLASSES, activation="softmax"),
])

model.compile(
    optimizer=keras.optimizers.Adam(1e-3),
    loss="categorical_crossentropy",
    metrics=["accuracy"],
)
model.summary()

# ── CELL 7: Phase 1 — train top layers only ──────────────────────────────────
callbacks = [
    keras.callbacks.EarlyStopping(patience=4, restore_best_weights=True),
    keras.callbacks.ReduceLROnPlateau(factor=0.5, patience=2, min_lr=1e-6),
]

history1 = model.fit(
    train_gen,
    validation_data=val_gen,
    epochs=10,
    callbacks=callbacks,
)

# ── CELL 8: Phase 2 — fine-tune top 30 layers of backbone ───────────────────
base.trainable = True
for layer in base.layers[:-30]:
    layer.trainable = False

model.compile(
    optimizer=keras.optimizers.Adam(1e-4),
    loss="categorical_crossentropy",
    metrics=["accuracy"],
)

history2 = model.fit(
    train_gen,
    validation_data=val_gen,
    epochs=EPOCHS,
    callbacks=callbacks,
)

val_acc = max(history2.history["val_accuracy"])
print(f"\nBest validation accuracy: {val_acc:.4f} ({val_acc*100:.1f}%)")

# ── CELL 9: Export to TFLite INT8 ────────────────────────────────────────────
def representative_dataset():
    """Feed real training images for INT8 calibration."""
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

tflite_model = converter.convert()

# Save model
tflite_path = OUTPUT_DIR / "plant_disease.tflite"
tflite_path.write_bytes(tflite_model)
print(f"TFLite model saved: {tflite_path} ({len(tflite_model)/1024:.0f}KB)")

# Save label mapping
labels_path = OUTPUT_DIR / "labels.json"
labels_data = {
    "index_to_agriOS_id": index_to_agriOS,
    "keras_class_indices": keras_classes,
    "val_accuracy": float(val_acc),
    "num_classes": NUM_CLASSES,
    "input_size": IMG_SIZE,
    "confidence_threshold": 0.60,
}
labels_path.write_text(json.dumps(labels_data, indent=2))
print("Labels saved:", labels_path)
print("Mapping:", json.dumps(index_to_agriOS, indent=2))

# ── CELL 10: Verify TFLite model ─────────────────────────────────────────────
interpreter = tf.lite.Interpreter(model_path=str(tflite_path))
interpreter.allocate_tensors()
input_details = interpreter.get_input_details()
output_details = interpreter.get_output_details()

print("\nTFLite model verified:")
print("  Input shape:", input_details[0]["shape"])
print("  Input dtype:", input_details[0]["dtype"])
print("  Output shape:", output_details[0]["shape"])

# Quick test with a random image
test_img = np.random.randint(0, 255, (1, IMG_SIZE, IMG_SIZE, 3), dtype=np.uint8)
interpreter.set_tensor(input_details[0]["index"], test_img)
interpreter.invoke()
output = interpreter.get_tensor(output_details[0]["index"])
print("  Test output (random image):", output)
print("\nReady! Download from /content/output/:")
print("  - plant_disease.tflite")
print("  - labels.json")
print("Place both in agriOS/assets/model/")

# ── CELL 11: Download files ───────────────────────────────────────────────────
# from google.colab import files
# files.download(str(tflite_path))
# files.download(str(labels_path))
