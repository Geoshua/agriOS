# agriOS — Model Training Guide

> **For the Claude Code instance on the GPU PC:** Read this file top to bottom before doing anything. Every command is explicit and in order. Check each expected output before proceeding to the next step.

---

## What you are training

A **MobileNetV2** image classifier, fine-tuned on the **BRACOL** dataset (Brazilian Arabica Coffee Leaf disease photos). The output is a TFLite INT8 model (~4–6 MB) that the agriOS app loads for **offline, on-device** crop disease detection.

**5 output classes:**
- `coffee_leaf_rust` — orange/yellow powdery spots (Hemileia vastatrix)
- `coffee_leaf_miner` — pale serpentine trails (Leucoptera coffeella)
- `coffee_phoma` — dark brown circular lesions (Phoma tarda)
- `coffee_brown_eye` — circles with brown centre + yellow halo (Cercospora coffeicola)
- `healthy` — no visible disease

**Expected outcome after training:**
- Validation accuracy: **85–93%** on the held-out 20% split
- Model file: `plant_disease.tflite` (~4–6 MB)
- Labels file: `labels.json` (~1 KB)
- Training time: **30–60 min** on RTX 3080/4080; ~90 min on older GPUs

---

## Step 0 — Verify environment

```bash
# Confirm Python version (3.10 or 3.11 recommended)
python --version
# Expected: Python 3.10.x or 3.11.x

# Confirm CUDA is available
nvidia-smi
# Expected: shows your GPU (e.g. NVIDIA GeForce RTX 4080) and CUDA version

# Confirm you're in the agriOS repo root
ls scripts/model_training/train.py
# Expected: scripts/model_training/train.py
```

If `nvidia-smi` fails, the GPU driver is not installed. TensorFlow will still run on CPU but training will take several hours.

---

## Step 1 — Install Python dependencies

```bash
pip install -r scripts/model_training/requirements_training.txt
```

**Verify:**
```bash
python -c "import tensorflow as tf; print('TF version:', tf.__version__); print('GPUs:', tf.config.list_physical_devices('GPU'))"
```

Expected output:
```
TF version: 2.15.x (or 2.16.x)
GPUs: [PhysicalDevice(name='/physical_device:GPU:0', device_type='GPU')]
```

If GPUs list is empty but `nvidia-smi` works, install the CUDA-enabled wheel:
```bash
pip install tensorflow[and-cuda]>=2.15
```

---

## Step 2 — Download the BRACOL dataset

BRACOL is the official dataset from the World Bank hackathon brief (Annex B). It contains ~1,700 labelled Arabica coffee leaf photos across 5 disease classes.

### Option A — Kaggle (fastest, automated)

1. Go to https://www.kaggle.com/settings → API → Create New Token → download `kaggle.json`
2. Place it:
   ```bash
   mkdir -p ~/.kaggle
   cp /path/to/kaggle.json ~/.kaggle/
   chmod 600 ~/.kaggle/kaggle.json
   ```
3. Download:
   ```bash
   kaggle datasets download -d alvarole/coffee-leaves-disease -p /tmp/bracol --unzip
   ```

**Verify:**
```bash
ls /tmp/bracol/
# Expected: several folders like rust/, miner/, phoma/, cercospora/, healthy/
# OR a nested structure — train.py auto-detects the image root.
```

### Option B — Mendeley Data (no account needed)

Download manually from: https://data.mendeley.com/datasets/yy2k5y8mxg/1

- Click "Download All" → save ZIP → extract to `/tmp/bracol/`

### Option C — Roboflow export (alternative, pre-split)

If you have a Roboflow account:
```bash
# Install Roboflow CLI if needed
pip install roboflow

# Then export from the Roboflow BRACOL-VALIDADO project
# See scripts/test_model_api.mjs for the project slug
```

---

## Step 3 — Run training

```bash
python scripts/model_training/train.py \
  --data-dir /tmp/bracol \
  --output-dir ./output
```

**What this does (two training phases):**

1. **Phase 1 (up to 10 epochs):** Backbone frozen, only the classification head trains. Fast. Establishes a baseline ~70–80% accuracy.
2. **Phase 2 (up to 20 epochs):** Top 30 layers of MobileNetV2 unfrozen, fine-tuned at low learning rate (1e-4). Pushes accuracy to 85–93%.

EarlyStopping is active — training ends automatically when validation accuracy stops improving. Total epochs may be less than the maximums.

**Expected log output (milestones to watch for):**
```
08:15:00  INFO  TensorFlow 2.15.x | GPUs: [PhysicalDevice(name='/physical_device:GPU:0')]
08:15:02  INFO  Image root: /tmp/bracol/...
08:15:02  INFO  Classes found: ['rust', 'miner', 'phoma', 'cercospora', 'healthy']
08:15:02  INFO  Index → agriOS mapping: {'0': 'coffee_brown_eye', '1': 'healthy', ...}
08:15:02  INFO  Train samples: 1360 | Val samples: 340
08:15:05  INFO  Building MobileNetV2 (ImageNet weights)…
08:15:05  INFO  Phase 1: training head only (10 epochs)…
...
08:30:xx  INFO  Phase 2: fine-tuning top 30 backbone layers (20 epochs)…
...
08:55:xx  INFO  Best val accuracy: 0.9118 (91.2%)
08:55:xx  INFO  Exporting TFLite INT8 model…
08:55:xx  INFO  TFLite model: ./output/plant_disease.tflite (4982 KB)
```

**If training is taking too long on CPU:** reduce epochs:
```bash
python scripts/model_training/train.py \
  --data-dir /tmp/bracol \
  --output-dir ./output \
  --phase1-epochs 5 \
  --phase2-epochs 10
```
This will finish in ~2–3 hours on CPU but may reduce accuracy by 5–8%.

---

## Step 4 — Verify output files

```bash
ls -lh ./output/
```

Expected:
```
-rw-r--r-- 1 user group 4.9M  plant_disease.tflite
-rw-r--r-- 1 user group  512  labels.json
-rw-r--r-- 1 user group  12M  checkpoint_phase2.h5   (can delete after)
```

Inspect labels.json to confirm the mapping:
```bash
cat ./output/labels.json
```

Expected structure:
```json
{
  "index_to_agrios_id": {
    "0": "coffee_brown_eye",
    "1": "coffee_leaf_miner",
    "2": "coffee_leaf_rust",
    "3": "coffee_phoma",
    "4": "healthy"
  },
  "val_accuracy": 0.912,
  "num_classes": 5,
  "input_size": 224,
  "confidence_threshold": 0.60
}
```

**If `val_accuracy` is below 0.75:** the dataset folder structure was not detected correctly, or the class mapping is wrong. Check `index_to_agrios_id` — if all values say `"unknown"`, update `CLASS_MAPPING` in `train.py` with the actual folder names from your BRACOL download.

---

## Step 5 — Copy files into the app

```bash
# From the agriOS repo root:
mkdir -p assets/model
cp ./output/plant_disease.tflite assets/model/
cp ./output/labels.json assets/model/
```

**Verify:**
```bash
ls -lh assets/model/
# Expected:
# -rw-r--r--  plant_disease.tflite  ~5MB
# -rw-r--r--  labels.json           ~1KB
```

---

## Step 6 — Enable TFLite inference in the app

Open `lib/inference.ts`. The TFLite block is currently commented out starting at line ~155.

**Install TF.js dependencies first (in the agriOS repo, not in the training venv):**
```bash
npx expo install @tensorflow/tfjs @tensorflow/tfjs-react-native
```

Then in `lib/inference.ts`, uncomment the TFLite section and add `runTFLiteInference` to the main `runInference` export. The comments in the file show exactly which lines to uncomment.

The inference priority order becomes:
1. HF Qwen2-VL (online, best accuracy)
2. **TFLite on-device (offline, now active)**
3. Mock cycling (dev fallback)

---

## Troubleshooting

**`No module named 'tensorflow'`**
→ Run `pip install -r scripts/model_training/requirements_training.txt` from the repo root.

**`Could not find class_indices`**
→ The dataset folder has an extra nesting level. Find the folder that has `rust/`, `healthy/` etc. as direct subdirectories and pass that as `--data-dir`.

**`Only 2–3 classes found`**
→ BRACOL sometimes ships with different folder names. Run `find /tmp/bracol -type d | head -20` to see the actual names, then update `CLASS_MAPPING` in `train.py`.

**GPU OOM (out of memory)**
→ Reduce batch size: `--batch-size 16` or `--batch-size 8`.

**`CUDA_ERROR_NO_DEVICE`**
→ Run `nvidia-smi` to check GPU status. May need to restart after driver update.

**Accuracy stuck below 60% after Phase 1**
→ The class mapping is wrong — most predictions are `"unknown"`. Print `train_gen.class_indices` to see what Keras sees, then fix `CLASS_MAPPING`.

---

## What NOT to do

- Do not push `plant_disease.tflite` or `labels.json` to GitHub — the `.gitignore` already excludes `assets/model/`. Transfer them to the phone/emulator directly.
- Do not delete `checkpoint_phase2.h5` until you have verified `plant_disease.tflite` runs in the app.
- Do not change `confidence_threshold` below 0.50 — the app uses this to decide when to show "uncertain, consult expert" instead of a specific diagnosis. False confidence is worse than admitting uncertainty.
