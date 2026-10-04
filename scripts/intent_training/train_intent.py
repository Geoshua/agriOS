"""
agriOS — train the offline question-intent classifier.

Maps a farmer's free-text question (Swahili or English) to one of the fixed
answer slots in assets/advisory_responses.json, or to "outOfScope" (→ "ask
your extension officer"). The app never generates text; this model only
chooses which reviewed answer to show, and defers when unsure.

Model: hashed bag of words / word bigrams / char 3–5-grams → multinomial
logistic regression (numpy). Weights exported as int8 (~90 KB JSON) and run in
pure TypeScript (lib/intentModel.ts) — no native code, works in Expo Go.

Data:
  * seed_questions.py — synthetic in-domain questions (hand-written, en + sw),
    augmented with prefixes / disease names.
  * Amazon MASSIVE 1.1 (CC BY 4.0), locales sw-KE + en-US, "train" partition —
    general assistant requests (alarms, weather, music…) labelled outOfScope.
  * eval_questions.json — 104 questions held out from training (never used to
    fit or tune). Written by the team, so still synthetic.

Usage:
  python train_intent.py --massive /path/to/1.1/data --out ../../assets/intent_model.json
"""

import argparse
import base64
import json
import random
import re
import sys
import unicodedata
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from seed_questions import DISEASE_WORDS, PREFIXES, SEED, SUFFIXES  # noqa: E402

INTENTS = ["summary", "doNow", "treatment", "prevention", "spread", "safety", "getHelp", "outOfScope"]
BUCKETS = 8192
SEED_RNG = 20261004


# ── Features (must match lib/intentModel.ts exactly) ─────────────────────────

def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("’", "'")
    text = re.sub(r"[^a-z0-9']+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for ch in s:  # normalize() leaves ASCII only, so chars == bytes
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def features(text: str) -> list[int]:
    toks = normalize(text).split()
    feats = []
    for t in toks:
        feats.append("w:" + t)
        padded = f" {t} "
        for n in (3, 4, 5):
            for i in range(len(padded) - n + 1):
                feats.append("c:" + padded[i:i + n])
    for a, b in zip(toks, toks[1:]):
        feats.append(f"b:{a}_{b}")
    return sorted({fnv1a(f) % BUCKETS for f in feats})


def vectorize(texts):
    X = np.zeros((len(texts), BUCKETS), dtype=np.float32)
    for i, t in enumerate(texts):
        idx = features(t)
        if idx:
            X[i, idx] = 1.0 / np.sqrt(len(idx))
    return X


# Policy block-list (must match lib/intentModel.ts): topics the app must never
# answer whatever the model says — banned pesticides, and money/prices (the app
# has no price data). Matched on normalized text, whole words.
GUARD = re.compile(
    r"\b(ddt|endosulfan|paraquat|lindane|aldrin|dieldrin|furadan|carbofuran|"
    r"price|prices|cost|costs|pay|paid|sell|selling|buyer|loan|money|mpesa|"
    r"bei|gharama|lipa|kulipa|atalipa|uza|kuuza|niuze|mnunuzi|mkopo|pesa)\b"
)


def guarded(text: str) -> bool:
    return bool(GUARD.search(normalize(text)))


# ── Data ─────────────────────────────────────────────────────────────────────

def augment(cores_by_intent, rng):
    """cores_by_intent: list of (core, intent, lang). Each core → itself + 3 variants."""
    rows = []
    for core, intent, lang in cores_by_intent:
        rows.append((core, intent))
        for _ in range(3):
            p = rng.choice(PREFIXES[lang])
            s = rng.choice(SUFFIXES[lang]).replace("{d}", rng.choice(DISEASE_WORDS[lang]))
            rows.append((p + core + s, intent))
    return rows


def load_massive(path: Path, per_locale: int, partition: str, rng):
    rows = []
    for loc in ("sw-KE", "en-US"):
        lines = [json.loads(l) for l in open(path / f"{loc}.jsonl", encoding="utf-8")]
        utts = [r["utt"] for r in lines if r["partition"] == partition]
        rng.shuffle(utts)
        rows += [(u, "outOfScope") for u in utts[:per_locale]]
    return rows


# ── Model ────────────────────────────────────────────────────────────────────

def softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def train(X, y, class_w, epochs=300, lr=0.05, l2=1e-4):
    n, d = X.shape
    k = len(INTENTS)
    W = np.zeros((d, k), dtype=np.float32)
    b = np.zeros(k, dtype=np.float32)
    Y = np.eye(k, dtype=np.float32)[y]
    sw = class_w[y][:, None]
    m_W, v_W, m_b, v_b = 0, 0, 0, 0
    for t in range(1, epochs + 1):
        P = softmax(X @ W + b)
        G = (P - Y) * sw / sw.sum()
        gW = X.T @ G + l2 * W
        gb = G.sum(axis=0)
        # Adam
        m_W = 0.9 * m_W + 0.1 * gW; v_W = 0.999 * v_W + 0.001 * gW**2
        m_b = 0.9 * m_b + 0.1 * gb; v_b = 0.999 * v_b + 0.001 * gb**2
        W -= lr * (m_W / (1 - 0.9**t)) / (np.sqrt(v_W / (1 - 0.999**t)) + 1e-8)
        b -= lr * (m_b / (1 - 0.9**t)) / (np.sqrt(v_b / (1 - 0.999**t)) + 1e-8)
    return W, b


def quantize(W):
    scale = np.abs(W).max(axis=0) / 127.0  # per class
    scale[scale == 0] = 1.0
    q = np.clip(np.round(W / scale), -127, 127).astype(np.int8)
    return q, scale.astype(np.float32)


def route(P, threshold, texts=None):
    """Answer intent index, or None to defer ('ask your extension officer')."""
    top = P.argmax(axis=1)
    conf = P.max(axis=1)
    oos = INTENTS.index("outOfScope")
    g = [guarded(t) for t in texts] if texts is not None else [False] * len(top)
    return [None if (gi or t == oos or c < threshold) else int(t) for t, c, gi in zip(top, conf, g)]


def score(P, y, threshold, texts=None):
    """correct = right answer or correctly deferred an out-of-scope question."""
    oos = INTENTS.index("outOfScope")
    r = route(P, threshold, texts)
    correct = sum((p is None and t == oos) or (p == t) for p, t in zip(r, y))
    wrong = sum(p is not None and p != t for p, t in zip(r, y))
    deferred = sum(p is None and t != oos for p, t in zip(r, y))
    return correct, wrong, deferred


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--massive", required=True, help="MASSIVE 1.1 data dir (sw-KE.jsonl, en-US.jsonl)")
    ap.add_argument("--out", default=str(Path(__file__).parents[2] / "assets" / "intent_model.json"))
    ap.add_argument("--massive-per-locale", type=int, default=2000)
    ap.add_argument("--max-wrong-rate", type=float, default=0.03,
                    help="Pick the lowest confidence threshold whose validation wrong-answer rate stays below this")
    args = ap.parse_args()
    rng = random.Random(SEED_RNG)

    evalset = json.load(open(Path(__file__).parent / "eval_questions.json", encoding="utf-8"))
    eval_norm = {normalize(e["text"]) for e in evalset}

    # Split by ORIGINAL question before augmenting, so variants of one question
    # never sit on both sides (that leak made validation far too easy).
    cores = [(c, i, lang) for i, langs in SEED.items() for lang, cs in langs.items() for c in cs]
    cores = [x for x in cores if normalize(x[0]) not in eval_norm]
    rng.shuffle(cores)
    va_cores, tr_cores = [], []
    for intent in INTENTS:
        group = [x for x in cores if x[1] == intent]
        cut = max(2, int(len(group) * 0.2))
        va_cores += group[:cut]
        tr_cores += group[cut:]
    massive = load_massive(Path(args.massive), args.massive_per_locale, "train", rng)
    massive = [(t, i) for t, i in massive if normalize(t) not in eval_norm]
    m_cut = int(len(massive) * 0.15)
    tr = augment(tr_cores, rng) + massive[m_cut:]
    va = augment(va_cores, rng) + massive[:m_cut]
    print(f"training rows: {len(tr)}, validation rows: {len(va)} "
          f"(validation questions are unseen originals, not variants of training ones)")
    print("per intent (train):", {i: sum(1 for _, j in tr if j == i) for i in INTENTS})

    Xtr = vectorize([t for t, _ in tr]); ytr = np.array([INTENTS.index(i) for _, i in tr])
    Xva = vectorize([t for t, _ in va]); yva = np.array([INTENTS.index(i) for _, i in va])
    counts = np.bincount(ytr, minlength=len(INTENTS)).astype(np.float32)
    class_w = (counts.sum() / (len(INTENTS) * counts)).astype(np.float32)

    W, b = train(Xtr, ytr, class_w)
    q, scale = quantize(W)
    Wq = q.astype(np.float32) * scale  # evaluate the model that ships

    Pva = softmax(Xva @ Wq + b)
    threshold = 0.9
    for th in np.arange(0.30, 0.91, 0.05):
        c, w, d = score(Pva, yva, th, [t for t, _ in va])
        if w / len(yva) <= args.max_wrong_rate:
            threshold = float(round(th, 2))
            break
    c, w, d = score(Pva, yva, threshold, [t for t, _ in va])
    print(f"validation ({len(yva)}): threshold {threshold} → correct {c}, wrong {w}, deferred {d}")

    # Held-out eval questions.
    Xe = vectorize([e["text"] for e in evalset]); ye = np.array([INTENTS.index(e["intent"]) for e in evalset])
    Pe = softmax(Xe @ Wq + b)
    etexts = [e['text'] for e in evalset]
    c, w, d = score(Pe, ye, threshold, etexts)
    c0, w0, d0 = score(Pe, ye, threshold)
    print(f"(model alone, no block-list: correct {c0}, wrong {w0}, deferred {d0})")
    print(f"\nEVAL questions ({len(ye)}, never trained on): correct {c}, wrong {w}, deferred {d}")
    for sub in ["DEV", "HELD_OUT", "FRESH", "FINAL"]:
        m = np.array([e["set"] == sub for e in evalset])
        cs, ws, ds = score(Pe[m], ye[m], threshold, [t for t, k in zip(etexts, m) if k])
        print(f"  {sub:<9} correct {cs}/{m.sum()}, wrong {ws}, deferred {ds}")
    r = route(Pe, threshold, etexts)
    for e, p, conf in zip(evalset, r, Pe.max(axis=1)):
        got = "DEFER" if p is None else INTENTS[p]
        want = e["intent"]
        if not ((p is None and want == "outOfScope") or got == want):
            tag = "defer" if p is None else "WRONG"
            print(f"    {tag}  {e['text']!r} → {got} ({conf:.2f}), want {want}")

    # MASSIVE test partition: how often does a general request get a farm answer?
    mt = load_massive(Path(args.massive), 100000, "test", random.Random(1))
    Pm = softmax(vectorize([t for t, _ in mt]) @ Wq + b)
    fa = sum(p is not None for p in route(Pm, threshold, [t for t, _ in mt]))
    print(f"\nMASSIVE test off-topic ({len(mt)}): wrongly answered {fa} ({fa / len(mt):.1%})")

    out = {
        "version": 1,
        "intents": INTENTS,
        "buckets": BUCKETS,
        "threshold": threshold,
        "bias": [float(x) for x in b],
        "scale": [float(x) for x in scale],
        # int8, row-major [bucket][intent]
        "weights": base64.b64encode(q.tobytes()).decode("ascii"),
        "note": "Generated by scripts/intent_training/train_intent.py — do not edit.",
    }
    Path(args.out).write_text(json.dumps(out), encoding="utf-8")
    print(f"\nwrote {args.out} ({Path(args.out).stat().st_size / 1024:.0f} KB)")

    # Golden vectors so the TypeScript port can be checked for identical output.
    golden = [{"text": e["text"], "features": features(e["text"]), "probs": [round(float(x), 5) for x in p]}
              for e, p in list(zip(evalset, Pe))[:12]]
    (Path(__file__).parent / "golden.json").write_text(json.dumps(golden, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
