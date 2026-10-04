/// <reference types="node" />
/**
 * Unit tests for the insight engine. Run: npm test  (Node's built-in runner,
 * TypeScript via Node's native type stripping — no extra dependencies).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateOutcomes,
  computeInsight,
  computeOutcomes,
  healthEstimate,
  trendOf,
  weeklyStrip,
} from '../lib/insights.ts';
import type { ActionRecord, IssueRecord } from '../lib/db.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 4, 12);

const DISEASES: Record<string, { name: string; severity: string }> = {
  coffee_leaf_rust: { name: 'Coffee Leaf Rust', severity: 'high' },
  coffee_leaf_miner: { name: 'Coffee Leaf Miner', severity: 'medium' },
  coffee_phoma: { name: 'Phoma Leaf Spot', severity: 'medium' },
  coffee_brown_eye: { name: 'Brown Eye Spot', severity: 'low' },
  healthy: { name: 'Healthy Plant', severity: 'none' },
  unknown: { name: 'Not Sure', severity: 'unknown' },
};

let nextId = 1;
function scan(diseaseId: string, daysAgo: number, extra: Partial<IssueRecord> = {}): IssueRecord {
  const d = DISEASES[diseaseId];
  return {
    id: nextId++,
    diseaseId,
    diseaseName: d.name,
    severity: d.severity,
    confidence: 0.9,
    lat: -1.17,
    lng: 36.83,
    photoUri: null,
    timestamp: NOW - daysAgo * DAY,
    notes: null,
    block: 'A',
    plantId: 1,
    source: 'user',
    ...extra,
  };
}
function action(type: ActionRecord['type'], daysAgo: number, extra: Partial<ActionRecord> = {}): ActionRecord {
  return { id: nextId++, type, plantId: 1, block: 'A', issueId: null, diseaseId: null, timestamp: NOW - daysAgo * DAY, ...extra };
}
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

// ── Health ────────────────────────────────────────────────────────────────────

test('no scans → unknown with no confidence', () => {
  const h = healthEstimate([], NOW);
  assert.equal(h.level, 'unknown');
  assert.equal(h.score, null);
  assert.equal(h.confidence, 'none');
});

test('recent healthy scans → good, confidence grows with scan count', () => {
  const two = healthEstimate([scan('healthy', 9), scan('healthy', 2)], NOW);
  assert.equal(two.level, 'good');
  assert.equal(two.score, 100);
  assert.equal(two.confidence, 'low');
  const six = healthEstimate([1, 4, 8, 12, 16, 20].map((d) => scan('healthy', d)), NOW);
  assert.equal(six.confidence, 'high');
});

test('newest scan weighs most: recent rust after old health → sick', () => {
  const h = healthEstimate([scan('healthy', 25), scan('healthy', 20), scan('coffee_leaf_rust', 1)], NOW);
  assert.ok(h.score! < 45, `score ${h.score}`);
  assert.equal(h.level, 'sick');
});

test('only old scans → stale, low confidence', () => {
  const h = healthEstimate([scan('healthy', 60), scan('healthy', 40)], NOW);
  assert.equal(h.stale, true);
  assert.equal(h.confidence, 'low');
});

// ── Trend ─────────────────────────────────────────────────────────────────────

test('trend: improving, worsening, new', () => {
  assert.equal(trendOf([scan('coffee_leaf_rust', 20), scan('healthy', 3)], NOW), 'improving');
  assert.equal(trendOf([scan('healthy', 20), scan('coffee_leaf_rust', 3)], NOW), 'worsening');
  assert.equal(trendOf([scan('healthy', 3)], NOW), 'new');
});

// ── Suggestions ───────────────────────────────────────────────────────────────

test('fresh rust with no spraying → "spray" first, urgent, pointing at leaf undersides', () => {
  const i = computeInsight({ scans: [scan('healthy', 10), scan('coffee_leaf_rust', 1)], actions: [], now: NOW });
  assert.equal(i.suggestions[0].id, 'treat-rust');
  assert.equal(i.suggestions[0].urgency, 'now');
  assert.equal(i.suggestions[0].zone, 'leaves_underside');
});

test('rust already sprayed → no "spray" suggestion', () => {
  const rust = scan('coffee_leaf_rust', 3);
  const i = computeInsight({ scans: [rust], actions: [action('sprayed', 2, { diseaseId: 'coffee_leaf_rust', issueId: rust.id })], now: NOW });
  assert.ok(!ids(i.suggestions).includes('treat-rust'));
});

test('rust found again 10+ days after spraying → "spraying hasn’t cleared it"', () => {
  const i = computeInsight({
    scans: [scan('coffee_leaf_rust', 20), scan('coffee_leaf_rust', 2)],
    actions: [action('sprayed', 18, { diseaseId: 'coffee_leaf_rust' })],
    now: NOW,
  });
  assert.ok(ids(i.suggestions).includes('spray-not-working'));
});

test('disease seen twice in 6 weeks → recurring + prune lower branches', () => {
  const i = computeInsight({ scans: [scan('coffee_phoma', 30), scan('healthy', 15), scan('coffee_phoma', 2)], actions: [], now: NOW });
  assert.equal(i.recurring[0].diseaseId, 'coffee_phoma');
  assert.equal(i.recurring[0].count, 2);
  const rec = i.suggestions.find((s) => s.id === 'recurring');
  assert.equal(rec?.zone, 'lower_branches');
});

test('not checked for 3 weeks → "scan again"', () => {
  const i = computeInsight({ scans: [scan('healthy', 21)], actions: [], now: NOW });
  assert.ok(ids(i.suggestions).includes('rescan'));
});

test('acidic soil → lime suggestion and lower soil axis', () => {
  const i = computeInsight({ scans: [scan('healthy', 1)], actions: [], soil: { ph: 5.3, nitrogen: 2.5 }, now: NOW });
  assert.ok(ids(i.suggestions).includes('lime'));
  const soil = i.axes.find((a) => a.key === 'soil')!;
  assert.ok(soil.value! < 3, `soil axis ${soil.value}`);
});

test('healthy streak → routine sucker removal, nothing urgent', () => {
  const i = computeInsight({ scans: [scan('healthy', 8), scan('healthy', 1)], actions: [], soil: { ph: 6.2, nitrogen: 2.6 }, now: NOW });
  assert.deepEqual(ids(i.suggestions), ['routine']);
  assert.equal(i.suggestions[0].zone, 'suckers');
});

test('unclear scan → ask the extension officer, never "spray"', () => {
  const i = computeInsight({ scans: [scan('unknown', 1)], actions: [], now: NOW });
  assert.equal(i.suggestions[0].id, 'ask-officer');
  assert.ok(!i.suggestions.some((s) => /spray/i.test(s.title)));
});

// ── Axes ──────────────────────────────────────────────────────────────────────

test('five axes in fixed order; missing data is null, not zero', () => {
  const i = computeInsight({ scans: [scan('healthy', 1)], actions: [], now: NOW });
  assert.deepEqual(i.axes.map((a) => a.key), ['leaf', 'recovery', 'spread', 'soil', 'care']);
  assert.equal(i.axes.find((a) => a.key === 'soil')!.value, null);
  assert.equal(i.axes.find((a) => a.key === 'recovery')!.value, null); // one scan → no trend yet
});

test('spread risk ignores the tree itself and counts sick neighbours', () => {
  const own = [scan('coffee_leaf_rust', 1)];
  const neighbours = [scan('healthy', 2, { plantId: 2 }), scan('healthy', 3, { plantId: 3 })];
  const i = computeInsight({ scans: own, actions: [], blockScans: [...own, ...neighbours], plantId: 1, now: NOW });
  assert.equal(i.axes.find((a) => a.key === 'spread')!.value, 5);
});

test('untreated sick scan lowers the care axis', () => {
  const treated = computeInsight({ scans: [scan('coffee_leaf_rust', 6)], actions: [action('sprayed', 5)], now: NOW });
  const ignored = computeInsight({ scans: [scan('coffee_leaf_rust', 6)], actions: [], now: NOW });
  const care = (x: typeof treated) => x.axes.find((a) => a.key === 'care')!.value!;
  assert.ok(care(ignored) < care(treated));
});

// ── Weekly strip ──────────────────────────────────────────────────────────────

test('weekly strip: 8 weeks, worst severity per week, actions placed', () => {
  const weeks = weeklyStrip(
    [scan('healthy', 2), scan('coffee_leaf_rust', 3), scan('healthy', 30)],
    [action('sprayed', 2)],
    NOW,
  );
  assert.equal(weeks.length, 8);
  assert.equal(weeks[7].worst, 'high');
  assert.deepEqual(weeks[7].actions, ['sprayed']);
  assert.equal(weeks[6].worst, null);
});

// ── Outcomes ──────────────────────────────────────────────────────────────────

test('outcomes: next scan healthier = success; worse/same = failure; no follow-up = skipped', () => {
  const rust1 = scan('coffee_leaf_rust', 30, { plantId: 1 });
  const rust2 = scan('coffee_leaf_rust', 30, { plantId: 2 });
  const scans = [
    rust1,
    scan('healthy', 20, { plantId: 1 }),
    rust2,
    scan('coffee_leaf_rust', 20, { plantId: 2 }),
  ];
  const actions = [
    action('sprayed', 28, { plantId: 1, diseaseId: 'coffee_leaf_rust', issueId: rust1.id }),
    action('sprayed', 28, { plantId: 2, diseaseId: 'coffee_leaf_rust', issueId: rust2.id }),
    action('sprayed', 1, { plantId: 1, diseaseId: 'coffee_leaf_rust' }), // no follow-up yet
  ];
  const events = computeOutcomes(scans, actions);
  assert.equal(events.length, 2);
  const stats = aggregateOutcomes(events);
  assert.deepEqual(stats.coffee_leaf_rust?.sprayed, { success: 1, total: 2 });
});

test('evidence: farm tally and regional % appear on the matching suggestion', () => {
  const i = computeInsight({
    scans: [scan('coffee_leaf_rust', 1)],
    actions: [],
    localStats: { coffee_leaf_rust: { sprayed: { success: 3, total: 4 } } },
    regionalStats: { coffee_leaf_rust: { sprayed: { success: 70, total: 100 } } },
    now: NOW,
  });
  assert.equal(i.suggestions[0].evidence, 'Worked 3 of 4 times on your farm · 70% in your area (100 cases)');
});

test('regional stats need at least 5 cases before they are quoted', () => {
  const i = computeInsight({
    scans: [scan('coffee_leaf_rust', 1)],
    actions: [],
    regionalStats: { coffee_leaf_rust: { sprayed: { success: 2, total: 2 } } },
    now: NOW,
  });
  assert.equal(i.suggestions[0].evidence, undefined);
});

// ── Regression tests (verifier findings) ──────────────────────────────────────

test('outcomes: an unclear follow-up scan is not counted as success', () => {
  const rust = scan('coffee_leaf_rust', 20);
  const events = computeOutcomes([rust, scan('unknown', 15)], [action('sprayed', 19, { diseaseId: 'coffee_leaf_rust', issueId: rust.id })]);
  assert.equal(events.length, 0);
});

test('outcomes: a tree-linked action is judged on the same tree, not a neighbour', () => {
  const rust = scan('coffee_leaf_rust', 20, { plantId: 5 });
  const events = computeOutcomes(
    [rust, scan('healthy', 16, { plantId: 9 }), scan('coffee_leaf_rust', 14, { plantId: 5 })],
    [action('sprayed', 19, { plantId: null, block: 'A', diseaseId: 'coffee_leaf_rust', issueId: rust.id })],
  );
  assert.deepEqual(events.map((e) => e.success), [false]);
});

test('outcomes: block-level action uses the block average; no block and no tree is skipped', () => {
  const events = computeOutcomes(
    [scan('coffee_leaf_rust', 20, { plantId: null }), scan('healthy', 15, { plantId: null }), scan('healthy', 14, { plantId: null })],
    [
      action('sprayed', 19, { plantId: null, block: 'A', diseaseId: 'coffee_leaf_rust' }),
      action('sprayed', 19, { plantId: null, block: null, diseaseId: 'coffee_leaf_rust' }),
    ],
  );
  assert.deepEqual(events.map((e) => e.success), [true]);
});

test('outcomes: repeated logs for one trigger count once', () => {
  const rust = scan('coffee_leaf_rust', 20);
  const events = computeOutcomes(
    [rust, scan('healthy', 10)],
    [action('sprayed', 19, { diseaseId: 'coffee_leaf_rust', issueId: rust.id }), action('sprayed', 18, { diseaseId: 'coffee_leaf_rust', issueId: rust.id })],
  );
  assert.equal(events.length, 1);
});

test('outcomes, health and trend do not depend on input order', () => {
  const asc = [scan('coffee_leaf_rust', 25), scan('healthy', 10), scan('coffee_leaf_rust', 2)];
  const desc = [...asc].reverse();
  assert.deepEqual(healthEstimate(desc, NOW), healthEstimate(asc, NOW));
  assert.equal(trendOf(desc, NOW), trendOf(asc, NOW));
  const acts = [action('sprayed', 24, { diseaseId: 'coffee_leaf_rust' })];
  assert.deepEqual(computeOutcomes(desc, acts), computeOutcomes(asc, acts));
});

test('recurring: same-day scans are one episode; healthy in between starts a new one', () => {
  const sameDay = computeInsight({ scans: [scan('coffee_phoma', 2), scan('coffee_phoma', 2)], actions: [], now: NOW });
  assert.equal(sameDay.recurring.length, 0);
  const back = computeInsight({ scans: [scan('coffee_phoma', 6), scan('healthy', 4), scan('coffee_phoma', 2)], actions: [], now: NOW });
  assert.equal(back.recurring[0]?.count, 2);
});

test('spray-not-working: silent once the tree recovered, and never for unclear results', () => {
  const recovered = computeInsight({
    scans: [scan('coffee_leaf_rust', 18), scan('healthy', 2)],
    actions: [action('sprayed', 29, { diseaseId: 'coffee_leaf_rust' }), action('sprayed', 17, { diseaseId: 'coffee_leaf_rust' })],
    now: NOW,
  });
  assert.ok(!ids(recovered.suggestions).includes('spray-not-working'));
  const unclear = computeInsight({ scans: [scan('unknown', 20), scan('unknown', 2)], actions: [action('sprayed', 19, { diseaseId: 'unknown' })], now: NOW });
  assert.ok(!ids(unclear.suggestions).includes('spray-not-working'));
  assert.ok(!unclear.suggestions.some((s) => /spray/i.test(s.title)));
});

test('spray-not-working: catches a recent recurrence after an older one', () => {
  const i = computeInsight({
    scans: [scan('coffee_leaf_rust', 45), scan('coffee_leaf_rust', 5)],
    actions: [action('sprayed', 60, { diseaseId: 'coffee_leaf_rust' })],
    now: NOW,
  });
  assert.ok(ids(i.suggestions).includes('spray-not-working'));
});

test('low-confidence result is treated as unclear: ask the officer, no spray advice', () => {
  const i = computeInsight({ scans: [scan('coffee_leaf_rust', 1, { confidence: 0.4 })], actions: [], now: NOW });
  assert.equal(i.suggestions[0].id, 'ask-officer');
});

test('trend ignores scans older than 4 weeks', () => {
  assert.equal(trendOf([scan('coffee_leaf_rust', 200), scan('healthy', 100)], NOW), 'new');
});

test('block insight: its own scans never count as "neighbours"', () => {
  const own = [scan('coffee_leaf_rust', 1, { plantId: null }), scan('coffee_leaf_rust', 2, { plantId: null })];
  const i = computeInsight({ scans: own, actions: [], blockScans: own, kind: 'block', now: NOW });
  assert.equal(i.axes.find((a) => a.key === 'spread')!.value, null);
  assert.ok(!ids(i.suggestions).includes('neighbours'));
});

test('future-dated scan (clock skew): care says "today", and it shows in the current week', () => {
  const i = computeInsight({ scans: [scan('healthy', -0.5)], actions: [], now: NOW });
  assert.match(i.axes.find((a) => a.key === 'care')!.detail, /today/);
  assert.equal(i.weeks[7].scans, 1);
});

test('weekly strip boundaries: exactly 7 days ago lands in the previous week; 56+ days is excluded', () => {
  const weeks = weeklyStrip([scan('healthy', 7), scan('healthy', 56), scan('healthy', 57)], [], NOW);
  assert.equal(weeks[6].scans, 1);
  assert.equal(weeks.reduce((a, w) => a + w.scans, 0), 1);
});
