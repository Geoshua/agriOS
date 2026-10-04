/// <reference types="node" />
/**
 * Unit tests for watering status and the to-do list. Run: npm test
 * (Node's built-in runner, TypeScript via native type stripping).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDemoWateringActions,
  DEFAULT_WATER_EVERY_DAYS,
  planFor,
  startOfDay,
  wateringActionsFor,
  wateringStatus,
} from '../lib/watering.ts';
import {
  actionForSuggestion,
  buildTaskList,
  completeTask,
  deriveSuggestionTasks,
  deriveWateringTasks,
  doneMark,
  dueLabel,
  snoozeDueAt,
  snoozeMark,
} from '../lib/tasks.ts';
import type { ActionRecord, ActionType, TaskRecord } from '../lib/db.ts';
import type { Suggestion } from '../lib/insights.ts';

const DAY = 86_400_000;
// Local noon, so day arithmetic is stable in any time zone.
const NOW = new Date(2026, 9, 4, 12).getTime();
const TODAY = startOfDay(NOW);

let nextId = 1;
function act(type: ActionType, daysAgo: number, extra: Partial<ActionRecord> = {}): ActionRecord {
  return { id: nextId++, type, plantId: null, block: 'A', issueId: null, diseaseId: null, timestamp: NOW - daysAgo * DAY, source: 'user', ...extra };
}

function task(extra: Partial<TaskRecord> = {}): TaskRecord {
  return { id: nextId++, title: 'Weed', plantId: null, block: 'A', dueAt: TODAY, repeatDays: null, doneAt: null, lastDoneAt: null, createdAt: NOW - 10 * DAY, notes: null, ...extra };
}

function sug(id: string, urgency: Suggestion['urgency'] = 'now', title = id): Suggestion {
  return { id, title, why: '', zone: 'whole', urgency };
}

// ── Watering ──────────────────────────────────────────────────────────────────

test('wateringStatus: no history → due now, honest "never logged"', () => {
  const s = wateringStatus({ everyDays: 7, actions: [], now: NOW });
  assert.equal(s.neverLogged, true);
  assert.equal(s.dueToday, true);
  assert.equal(s.lastWateredAt, null);
  assert.equal(s.nextDueAt, null);
  assert.equal(s.timesLast30Days, 0);
  assert.equal(s.averageIntervalDays, null);
});

test('wateringStatus: on schedule and overdue', () => {
  const fine = wateringStatus({ everyDays: 7, actions: [act('watered', 3)], now: NOW });
  assert.equal(fine.dueToday, false);
  assert.equal(fine.daysUntilDue, 4);
  assert.equal(fine.daysSinceLast, 3);
  assert.equal(fine.overdueDays, 0);

  const late = wateringStatus({ everyDays: 7, actions: [act('watered', 9), act('watered', 20)], now: NOW });
  assert.equal(late.dueToday, true);
  assert.equal(late.overdueDays, 2);
  assert.equal(late.lastSource, 'watered');
  assert.equal(late.timesLast30Days, 2);
  assert.equal(late.averageIntervalDays, 11);

  const dueNow = wateringStatus({ everyDays: 7, actions: [act('watered', 7)], now: NOW });
  assert.equal(dueNow.dueToday, true);
  assert.equal(dueNow.overdueDays, 0);
});

test('wateringStatus: rain counts as watering', () => {
  const s = wateringStatus({ everyDays: 7, actions: [act('watered', 10), act('rained', 1)], now: NOW });
  assert.equal(s.lastSource, 'rained');
  assert.equal(s.dueToday, false);
  assert.equal(s.rainedLast30Days, 1);
  assert.equal(s.timesLast30Days, 2);
});

test('wateringStatus: same-day watering counts once; ignores other actions; future clamps to now', () => {
  const s = wateringStatus({ everyDays: 7, actions: [act('watered', 2), act('rained', 2), act('sprayed', 0), act('watered', -3)], now: NOW });
  assert.equal(s.timesLast30Days, 2);
  assert.equal(s.daysSinceLast, 0);
});

test('wateringActionsFor: block actions count for its trees, tree actions not for the block', () => {
  const actions = [
    act('watered', 3, { block: 'A' }),
    act('watered', 1, { block: 'A', plantId: 7 }),
    act('rained', 2, { block: 'B' }),
    act('sprayed', 1, { block: 'A' }),
  ];
  const tree = wateringActionsFor({ kind: 'plant', id: 7, block: 'A' }, actions);
  assert.deepEqual(tree.map((a) => a.timestamp).sort(), [NOW - 3 * DAY, NOW - DAY].sort());
  const block = wateringActionsFor({ kind: 'block', block: 'A' }, actions);
  assert.equal(block.length, 1);
  const other = wateringActionsFor({ kind: 'plant', id: 9, block: 'A' }, actions);
  assert.equal(other.length, 1); // only the block watering
});

test('planFor: tree own plan > block plan > default', () => {
  const plans = [
    { subjectType: 'block' as const, subjectId: 'A', everyDays: 5, updatedAt: 0 },
    { subjectType: 'plant' as const, subjectId: '7', everyDays: 3, updatedAt: 0 },
  ];
  assert.deepEqual(planFor({ kind: 'plant', id: 7, block: 'A' }, plans), { everyDays: 3, from: 'own' });
  assert.deepEqual(planFor({ kind: 'plant', id: 8, block: 'A' }, plans), { everyDays: 5, from: 'block' });
  assert.deepEqual(planFor({ kind: 'block', block: 'B' }, plans), { everyDays: DEFAULT_WATER_EVERY_DAYS, from: 'default' });
});

test('buildDemoWateringActions: deterministic, seed-marked, a mix of states', () => {
  const a = buildDemoWateringActions({ blocks: ['A', 'B', 'C', 'D'], trees: [{ id: 1, block: 'A' }], now: NOW });
  const b = buildDemoWateringActions({ blocks: ['A', 'B', 'C', 'D'], trees: [{ id: 1, block: 'A' }], now: NOW });
  assert.deepEqual(a, b);
  assert.ok(a.every((x) => x.source === 'seed' && x.synced === true && x.timestamp <= NOW));
  assert.ok(a.some((x) => x.type === 'rained'));
  assert.ok(a.some((x) => x.plantId === 1));
  const status = (blk: string) =>
    wateringStatus({ everyDays: 7, actions: wateringActionsFor({ kind: 'block', block: blk }, a as ActionRecord[]), now: NOW });
  assert.equal(status('A').dueToday, false);
  assert.ok(status('C').overdueDays > 0);
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

test('buildTaskList groups into Overdue / Today / This week / Later / Done, sorted', () => {
  const custom = [
    task({ title: 'Later', dueAt: TODAY + 20 * DAY }),
    task({ title: 'Week', dueAt: TODAY + 3 * DAY }),
    task({ title: 'Late', dueAt: TODAY - 2 * DAY }),
    task({ title: 'Later late', dueAt: TODAY - 1 * DAY }),
    task({ title: 'Today', dueAt: TODAY }),
    task({ title: 'Finished', doneAt: NOW - DAY }),
    task({ title: 'Old', doneAt: NOW - 30 * DAY }),
  ];
  const list = buildTaskList({ custom, derived: [], marks: [], now: NOW });
  assert.deepEqual(list.groups.map((g) => g.key), ['overdue', 'today', 'week', 'later', 'done']);
  assert.deepEqual(list.groups[0].items.map((i) => i.title), ['Late', 'Later late']);
  assert.deepEqual(list.groups[4].items.map((i) => i.title), ['Finished']);
  assert.equal(list.counts.today, 1);
  assert.equal(list.open.length, 5);
});

test('buildTaskList: same day → urgent suggestion, then water, then own tasks', () => {
  const derived = [
    ...deriveSuggestionTasks([{ kind: 'plant', plantId: 3, block: 'A', suggestions: [sug('treat-rust', 'now')] }], NOW),
    ...deriveWateringTasks(
      [{ kind: 'block', plantId: null, block: 'B', status: wateringStatus({ everyDays: 7, actions: [act('watered', 7)], now: NOW }) }],
      NOW,
    ),
  ];
  const list = buildTaskList({ custom: [task({ title: 'Mine' })], derived, marks: [], now: NOW });
  const today = list.groups.find((g) => g.key === 'today')!;
  assert.deepEqual(today.items.map((i) => i.kind), ['suggestion', 'water', 'custom']);
});

test('completeTask: one-off is done; repeating advances past today', () => {
  const once = completeTask({ dueAt: TODAY, repeatDays: null }, NOW);
  assert.equal(once.doneAt, NOW);

  const weekly = completeTask({ dueAt: TODAY, repeatDays: 7 }, NOW);
  assert.equal(weekly.doneAt, null);
  assert.equal(weekly.lastDoneAt, NOW);
  assert.equal(startOfDay(weekly.dueAt), startOfDay(TODAY + 7 * DAY));

  // Three weeks late → next one in the future, not a pile of overdue copies.
  const late = completeTask({ dueAt: TODAY - 15 * DAY, repeatDays: 7 }, NOW);
  assert.equal(startOfDay(late.dueAt), startOfDay(TODAY + 6 * DAY));

  // Finished early → next due is one repeat after the old due date.
  const early = completeTask({ dueAt: TODAY + 2 * DAY, repeatDays: 14 }, NOW);
  assert.equal(startOfDay(early.dueAt), startOfDay(TODAY + 16 * DAY));
});

test('repeating task done recently shows under Done and stays open', () => {
  const t = task({ title: 'Weed', repeatDays: 7, dueAt: TODAY + 7 * DAY, lastDoneAt: NOW - DAY });
  const list = buildTaskList({ custom: [t], derived: [], marks: [], now: NOW });
  assert.equal(list.counts.week, 1);
  assert.equal(list.counts.done, 1);
});

test('snooze: custom moves a day; derived hidden until tomorrow', () => {
  assert.equal(startOfDay(snoozeDueAt(TODAY - 3 * DAY, NOW)), startOfDay(TODAY + DAY));
  assert.equal(startOfDay(snoozeDueAt(TODAY + 2 * DAY, NOW)), startOfDay(TODAY + 3 * DAY));

  const derived = deriveSuggestionTasks([{ kind: 'block', plantId: null, block: 'C', suggestions: [sug('ask-officer', 'soon')] }], NOW);
  const mark = snoozeMark(derived[0], NOW);
  assert.equal(buildTaskList({ custom: [], derived, marks: [mark], now: NOW }).open.length, 0);
  // Tomorrow it's back.
  assert.equal(buildTaskList({ custom: [], derived, marks: [mark], now: NOW + DAY }).open.length, 1);
});

test('done marks hide derived tasks and list them under Done', () => {
  const derived = deriveSuggestionTasks([{ kind: 'plant', plantId: 5, block: 'B', suggestions: [sug('recurring', 'soon', 'Prune')] }], NOW);
  const mark = doneMark(derived[0], NOW, 42);
  const list = buildTaskList({ custom: [], derived, marks: [mark], now: NOW });
  assert.equal(list.open.length, 0);
  assert.equal(list.counts.done, 1);
  assert.equal(list.groups[0].items[0].title, 'Prune');
});

test('suggestion → action mapping', () => {
  assert.equal(actionForSuggestion('treat-rust'), 'sprayed');
  assert.equal(actionForSuggestion('spray-not-working'), 'sprayed');
  assert.equal(actionForSuggestion('treat-miner'), 'removed_leaves');
  assert.equal(actionForSuggestion('treat-phoma'), 'pruned');
  assert.equal(actionForSuggestion('recurring'), 'pruned');
  for (const id of ['treat-brown-eye', 'nitrogen', 'lime', 'acidify']) assert.equal(actionForSuggestion(id), 'fertilised');
  for (const id of ['ask-officer', 'rescan', 'neighbours', 'made-up']) assert.equal(actionForSuggestion(id), null);
});

test('deriveSuggestionTasks: only now/soon, dedupes block-wide and tree-vs-block', () => {
  const tasks = deriveSuggestionTasks(
    [
      { kind: 'block', plantId: null, block: 'A', suggestions: [sug('treat-rust'), sug('neighbours', 'soon'), sug('lime', 'routine')] },
      { kind: 'plant', plantId: 1, block: 'A', suggestions: [sug('treat-rust'), sug('neighbours', 'soon')] },
      { kind: 'plant', plantId: 2, block: 'A', suggestions: [sug('neighbours', 'soon'), sug('rescan', 'routine')] },
      { kind: 'plant', plantId: 3, block: 'B', suggestions: [sug('neighbours', 'soon')] },
    ],
    NOW,
  );
  assert.deepEqual(tasks.map((t) => t.key).sort(), ['sug:neighbours:bA', 'sug:neighbours:bB', 'sug:treat-rust:p1']);
  const rust = tasks.find((t) => t.suggestionId === 'treat-rust')!;
  assert.equal(dueLabel(rust.dueAt, NOW), 'Today');
});

test('dueLabel wording', () => {
  assert.equal(dueLabel(TODAY - 2 * DAY, NOW), 'Overdue 2 days');
  assert.equal(dueLabel(TODAY - DAY, NOW), 'Overdue 1 day');
  assert.equal(dueLabel(TODAY + DAY, NOW), 'Tomorrow');
  assert.equal(dueLabel(TODAY + 3 * DAY, NOW).length, 3); // weekday
});
