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

BRACOL is the official dataset from the World Bank hackathon brief (Annex B). It contains ~1,700 labelled Arabica coffee leaf photos across 5 disease classes, photographed under real field conditions in Brazil.

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

## Step 2b — Check class balance

BRACOL is **uneven**: rust is the most common class (~40% of images), while phoma and cercospora have significantly fewer examples. If left unaddressed, the model may reach high overall accuracy but perform poorly on the rarer classes.

**Check your download's distribution:**
```bash
find /tmp/bracol -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.png" \) \
  | awk -F'/' '{print $(NF-1)}' | sort | uniq -c | sort -rn
```

Expected output (approximate):
```
 680  rust
 340  healthy
 270  miner
 230  cercospora
 180  phoma
```

**If phoma + cercospora together total < 300 images**, add class weights to compensate. Open `train.py` and add this block just before the first `model.fit()` call:

```python
# Compute class weights to compensate for class imbalance
from sklearn.utils.class_weight import compute_class_weight
import numpy as np

class_weight_array = compute_class_weight(
    class_weight='balanced',
    classes=np.arange(train_gen.num_classes),
    y=train_gen.classes,
)
class_weight_dict = dict(enumerate(class_weight_array))
log.info("Class weights: %s", class_weight_dict)
```

Then pass it to both `model.fit()` calls:
```python
model.fit(train_gen, ..., class_weight=class_weight_dict)
```

**Why this matters:** Without weighting, phoma accuracy may be 30–50% even when overall val accuracy is 88%. The app shows "unknown" below 0.60 confidence, so a weak phoma classifier just means more "consult expert" results — not dangerous — but weighting improves it cheaply.

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

### Data augmentation (configured in train.py)

The training generator applies the following augmentations on every epoch to simulate real field conditions:

| Augmentation | Setting | Why |
|---|---|---|
| Rotation | ±30° | Leaves photographed at any angle |
| Width/height shift | ±15% | Leaf not centred in frame |
| Shear | 10% | Camera tilt / perspective |
| Zoom | ±20% | Distance variation (close-up vs wider) |
| Horizontal flip | Yes | Leaves look the same mirrored |
| Vertical flip | Yes | Phone held upside-down in field |
| Brightness | 0.6× – 1.4× | Morning shade vs midday sun |
| Channel shift | ±30 | Different phone camera white balance |
| Fill mode | nearest | Avoids black border artefacts |

These augmentations make the model robust to typical farmer photo-taking behaviour (shaky, off-angle, varying light). They are applied only during training — validation images are resized and rescaled only.

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

**Check per-class accuracy** (strongly recommended before deploying):
```python
# Run this after training, in the same Python environment:
import tensorflow as tf, json
import numpy as np
from tensorflow.keras.preprocessing.image import ImageDataGenerator

tflite_path = './output/plant_disease.tflite'
labels = json.load(open('./output/labels.json'))

gen = ImageDataGenerator(rescale=1./255).flow_from_directory(
    '/tmp/bracol', target_size=(224, 224), batch_size=32,
    class_mode='categorical', shuffle=False
)

interp = tf.lite.Interpreter(model_path=tflite_path)
interp.allocate_tensors()
inp, out = interp.get_input_details()[0], interp.get_output_details()[0]

preds, trues = [], []
for imgs, lbls in gen:
    for img, lbl in zip(imgs, lbls):
        # INT8 input: scale to 0-255
        pixel = (img * 255).astype(np.uint8)[np.newaxis]
        interp.set_tensor(inp['index'], pixel)
        interp.invoke()
        preds.append(np.argmax(interp.get_tensor(out['index'])))
        trues.append(np.argmax(lbl))
    if len(preds) >= gen.samples: break

from sklearn.metrics import classification_report
id_to_name = {int(k): v for k, v in labels['index_to_agrios_id'].items()}
print(classification_report(trues, preds, target_names=[id_to_name[i] for i in range(5)]))
```

A healthy result looks like this — all classes above 0.75 precision/recall:
```
                    precision  recall  f1-score
coffee_leaf_rust       0.94    0.96      0.95
coffee_leaf_miner      0.88    0.85      0.86
coffee_phoma           0.78    0.72      0.75   ← lowest, expected
coffee_brown_eye       0.82    0.80      0.81
healthy                0.93    0.95      0.94
```

If phoma recall is below 0.60, add class weighting (see Step 2b) and retrain.

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
1. Hub server `/classify` (LAN, fastest)
2. HF Qwen2-VL (online)
3. **TFLite on-device (offline, now active)**
4. Mock cycling (dev fallback)

---

## Supplementary datasets

BRACOL alone is ~1,700 images. More data improves generalisation, especially for rarer classes. These sources are compatible with the current training pipeline — just merge their images into the same folder structure under `/tmp/bracol/`.

### PlantVillage (coffee subset)
- **Where:** https://www.kaggle.com/datasets/emmarex/plantdisease
- **What:** ~54,000 plant disease images, including a coffee leaf subset
- **Caveat:** Studio/controlled lighting — images look cleaner than real field photos. Adding them improves class volume but may reduce robustness to harsh field conditions. Use sparingly (e.g. 200–300 images per class as a supplement, not the main source).
- **Compatibility:** Use only the `Coffee___Cercospora_Leaf_Spot` and similar subfolders; add them to the matching BRACOL class folder.

### iNaturalist coffee disease observations
- **Where:** https://www.inaturalist.org/observations?taxon_name=coffea&quality_grade=research
- **What:** Researcher-verified field photos; varied lighting, angles, phone cameras — much closer to Noor's actual photos
- **Caveat:** Labels require manual verification; some observations will have multiple diseases in one image
- **How to download:** Export via iNaturalist API or use GBIF: https://www.gbif.org/species/search?q=coffea+leaf+disease

### Roboflow Universe (augmented BRACOL)
- **Where:** https://universe.roboflow.com — search "coffee leaf disease"
- **What:** Community-augmented versions of BRACOL, sometimes with additional field photos
- **Caveat:** Quality varies by project. Prefer projects with >500 images and public labelling history.

**Rule of thumb:** if supplementing, keep BRACOL as the majority (≥60% of each class). The model is evaluated against BRACOL-like field conditions, so studio data should stay minority.

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

**Phoma or cercospora recall below 0.60**
→ Add class weighting (Step 2b). These are the two rarest BRACOL classes and most likely to underfit without it.

**Val accuracy much lower than train accuracy (overfitting)**
→ Reduce `--phase2-epochs` to 10 or add more aggressive dropout. Overfitting is less common with augmentation active but can occur with small datasets.

---

## What NOT to do

- Do not push `plant_disease.tflite` or `labels.json` to GitHub — the `.gitignore` already excludes `assets/model/`. Transfer them to the phone/emulator directly.
- Do not delete `checkpoint_phase2.h5` until you have verified `plant_disease.tflite` runs in the app.
- Do not change `confidence_threshold` below 0.50 — the app uses this to decide when to show "uncertain, consult expert" instead of a specific diagnosis. False confidence is worse than admitting uncertainty.
- Do not report accuracy without running per-class metrics (Step 4). 88% overall with 40% phoma recall is not a deployable model.
