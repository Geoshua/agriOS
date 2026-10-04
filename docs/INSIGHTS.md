# Plant insights: how they work

How agriOS turns scans into per-tree and per-block health, suggestions and
"what worked" evidence — and what it deliberately does **not** claim.

_Last updated: 2026-10-04._

---

## Data model (all on the phone, SQLite, offline)

| Table | What | Notes |
|---|---|---|
| `issues` | Every logged scan: result, confidence, time, GPS, **block**, optional **tree** (`plant_id`), **photo**, notes | `source = 'seed'` marks demo history (replaced on reseed); `'user'` = the farmer's |
| `plants` | **Tagged trees** — a number painted on the tree (`tag`), block, position | Tagging is optional; untagged scans just belong to their block |
| `actions` | What the farmer did: sprayed, pruned, fertilised, removed leaves, watered, it rained, nothing | Linked to a tree and/or block and (optionally) the scan that prompted it; `synced` = sent to the hub |

**Blocks** (A–D) are areas of trees. Every scan belongs to one. A scan can also
be tagged to a tree right after logging (the app suggests the nearest tagged
tree from GPS; budget-phone GPS drifts 5–15 m, so the farmer confirms) or later
from history.

**Photos**: every logged scan keeps the image that produced the result
(512 px JPEG, ~50 KB; newest 300 kept — older scans keep their result, lose the
image). The farmer can open any scan, see the photo, its tree/block and rough
position, re-tag it, or **delete it as a false positive** — deleted scans drop
out of every estimate and statistic.

## Insight engine — `lib/insights.ts`

Pure, deterministic TypeScript (no network, no React Native) — unit-tested in
`tests/insights.test.ts`; hub endpoints in `tests/server.test.ts`; watering
and tasks in `tests/tasks.test.ts`. Run all with `npm test`.

### Health estimate
- Recency-weighted severity of scans in the last 28 days (newest weigh most;
  ~10-day decay). Severity weights: high 1, medium 0.6, low 0.3, unclear 0.35,
  healthy 0. Score = 100 × (1 − weighted severity).
- Level: **Healthy** ≥ 75, **Watch** ≥ 45, otherwise **Sick**; **Not checked**
  with no scans.
- **Confidence** is always shown: ≤ 2 scans "rough", 3–5 "fair", ≥ 6 "good";
  only-old scans are flagged stale.

### The pentagon (five 0–5 axes)
| Axis | From | Missing data |
|---|---|---|
| Leaves | the health estimate | "no data" |
| Recovery | trend over 4 weeks (last 2 vs previous 2) | needs ≥ 2 recent scans |
| Neighbours | share of sick scans nearby in 2 weeks (other trees; other blocks for a block) — never the subject's own scans | "no data" |
| Soil | pH distance from coffee's 6.0–6.5 band, low nitrogen (bundled SoilGrids grid) | "no data" |
| Care | days since last check, minus untreated problems | "no data" |

Axes without data are drawn hollow and say "no data" — never a fake zero.
There is **no yield axis**: no harvest data is recorded.

### Suggestions (rules, each with a "why")
Agronomy rules triggered by the subject's own data, ranked Now / This week /
When you can, each pointing at a zone of the coffee-bush diagram:
active rust → spray copper under the leaves; leaf miner → pick off mined
leaves; phoma → open the centre; brown eye → feed; unclear result (or
confidence < 60 %) → ask the extension officer, **never spray**; spraying
didn't clear it → check product/coverage; disease came back (separate
episodes in 6 weeks) → prune lower branches; sick neighbours → check weekly;
not checked 14+ days → scan again; soil pH/nitrogen → lime/acidify/compost;
healthy streak → remove suckers.

The **coffee-bush diagram** is a generic Arabica bush (we can't see a tree's
real structure from leaf scans) that highlights where to act.

## Learning loop — "did it work?"

1. **On the phone** (`computeOutcomes`): for each treatment, find the scan that
   prompted it and the next *clear* scan of the same tree 3–28 days later
   (block-level treatments compare the block's average). Success = healthier.
   One outcome per trigger. → "Worked 3 of 4 times on your farm".
2. **On the hub**: phones upload anonymous events (disease, action, success, a
   random install id — no GPS, no photos) to `POST /outcomes`; the hub tallies
   them (and forwards to the cloud) and serves `GET /outcome-stats`. Phones
   cache the regional tally for offline use → "70 % in your area (100 cases)"
   (quoted only from ≥ 5 cases).
3. **Hub LLM summary** (`POST /history-summary`): the co-op's local LLM writes
   a short plain-language summary of a tree's history for the extension
   officer. It explains the numbers; it doesn't decide anything.

This is transparent **counting, not model training** — suggestions improve as
logged outcomes accumulate, and every number can be traced back to scans.

### Roadmap (needs data first, then a GPU)
- **Season of outcomes + harvests** → per-block yield comparisons, treatment
  timing. Requires adding harvest logging (kg per block per season).
- **Outbreak forecasting** (rust risk from season, recurrence, neighbours,
  rainfall) — a model trained on a season+ of labelled outcomes across farms.
  Training needs a CUDA GPU machine (not the development laptop); inference is
  small enough for the hub. See also `docs/VOICE.md` §6 for GPU work.
- Until real outcomes exist, demo stats come from the seeded farm and are
  labelled as this farm's history — never present them as field results.

## Watering and to-dos

- **Watering plans** (`watering_plans`): water every N days per block,
  optionally overridden per tree. Default 7 days is a placeholder for Arabica in
  dry spells — the farmer adjusts it with −/+. History = `watered` / `rained`
  actions (rain counts as watering; a tree counts block-level watering). Shown
  on each tree/block report (`components/tasks/WateringCard.tsx`): last watered,
  next due / overdue, times in 30 days, average gap. Pure logic in
  `lib/watering.ts`.
- **To Do** (`app/tasks.tsx`, summary card on the Plants tab):
  - the farmer's own tasks (`tasks` table) — one-off or repeating, snooze,
    delete, undo;
  - **derived tasks**, recomputed, never stored: watering due per block/tree,
    and every "Now"/"This week" suggestion from the insight engine (deduped:
    block-wide items once per block). Ticking one logs the matching action
    (spray / prune / feed / remove leaves) — which then feeds "what worked".
    Snoozes and "handled" markers live in `task_marks`.
- Grouped Overdue / Today / This week / Later / Done. Pure logic in
  `lib/tasks.ts`, unit-tested in `tests/tasks.test.ts`.

## Demo data
`lib/seed.ts` seeds six weeks on the Kiambu demo farm: ten tagged trees with
stories (rust cured by spraying; rust that keeps coming back; untreated rust;
a healthy tree; brown eye fixed by feeding; leaf miner removed; phoma back after
pruning; untreated miner; a tree not checked for 3 weeks; an unclear scan),
untagged scans per block, actions and outcomes, plus watering and rain history
(Block C ends overdue). All marked `source = 'seed'`;
bump `SEED_VERSION` to reseed. Turn off with `SEED_DEMO_DATA = false`.
