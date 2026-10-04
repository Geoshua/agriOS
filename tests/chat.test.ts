/// <reference types="node" />
/**
 * Unit tests for the offline "Ask" assistant. Run: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { answerQuestion, normalize, STARTER_QUESTIONS, type ChatContext, type SubjectSummary } from '../lib/chat.ts';
import type { IssueRecord } from '../lib/db.ts';

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 4, 12).getTime();
const diseases = JSON.parse(readFileSync(new URL('../assets/diseases.json', import.meta.url), 'utf8')).diseases;

function scan(over: Partial<IssueRecord>): IssueRecord {
  return {
    id: 1,
    diseaseId: 'coffee_leaf_rust',
    diseaseName: 'Coffee Leaf Rust',
    severity: 'high',
    confidence: 0.9,
    lat: 0,
    lng: 0,
    photoUri: null,
    timestamp: NOW - DAY,
    notes: null,
    block: 'C',
    plantId: 7,
    ...over,
  };
}

const rustScan = scan({});
const tree7: SubjectSummary = {
  label: 'Tree 7',
  plantId: 7,
  block: 'C',
  tag: 7,
  level: 'sick',
  next: { id: 'treat-rust', title: 'Spray copper under the leaves', why: 'Rust found yesterday.', zone: 'leaves_underside', urgency: 'now' },
  lastScan: rustScan,
};

function ctx(over: Partial<ChatContext> = {}): ChatContext {
  return {
    now: NOW,
    diseases,
    scans: [rustScan, scan({ id: 2, diseaseId: 'healthy', diseaseName: 'Healthy Plant', severity: 'none', block: 'A', plantId: null, timestamp: NOW - 2 * DAY })],
    blocks: ['A', 'B', 'C', 'D'].map((b) => ({ label: `Block ${b}`, plantId: null, block: b, tag: null, level: b === 'C' ? 'sick' : 'good', next: null, lastScan: null })),
    trees: [tree7],
    tasks: [
      { title: 'Spray copper under the leaves', where: 'Tree 7', when: 'Today', overdue: false, dueToday: true },
      { title: 'Water', where: 'Block B', when: 'Tomorrow', overdue: false, dueToday: false },
    ],
    watering: [
      { label: 'Block A', due: 'Due today', last: '7 days ago', dueToday: true, everyDays: 7 },
      { label: 'Block B', due: 'In 3 days', last: '4 days ago', dueToday: false, everyDays: 7 },
    ],
    soil: { ph: 5.4, nitrogen: 1.2, phAdvice: 'Soil pH is 5.4 — too acidic for coffee.', generalAdvice: 'Nitrogen looks low.', source: 'Offline · farm soil map' },
    outcomes: { coffee_leaf_rust: { sprayed: { success: 3, total: 4 }, pruned: { success: 0, total: 1 } } },
    ...over,
  };
}

test('normalize strips accents and punctuation', () => {
  assert.equal(normalize('Gĩkũyũ, RUST?!'), ' gikuyu rust ');
});

test('every starter question gets a real answer', () => {
  for (const q of STARTER_QUESTIONS) {
    const a = answerQuestion(q.text, ctx());
    assert.notEqual(a.intent, 'unknown', q.text);
  }
});

test('named disease + treat → treatment from diseases.json, ends with a recommendation', () => {
  const a = answerQuestion('How do I treat leaf rust?', ctx());
  assert.equal(a.intent, 'disease');
  assert.equal(a.diseaseId, 'coffee_leaf_rust');
  assert.match(a.text, /copper/i);
  assert.match(a.text, /3 of 4 times/);
  assert.match(a.text, /recommend/);
});

test('Swahili disease word works (kutu = rust)', () => {
  assert.equal(answerQuestion('dawa ya kutu', ctx()).diseaseId, 'coffee_leaf_rust');
});

test('symptoms in words are only ever a "might be", never a diagnosis', () => {
  const a = answerQuestion('my leaves have orange powder underneath', ctx());
  assert.equal(a.intent, 'symptoms');
  assert.equal(a.tone, 'unsure');
  assert.equal(a.diseaseId, undefined);
  assert.match(a.text, /might be coffee leaf rust/);
});

test('one vague symptom word is not enough to name a disease', () => {
  const a = answerQuestion('there are yellow spots', ctx());
  assert.equal(a.intent, 'symptoms');
  assert.doesNotMatch(a.text, /might be/);
});

test('tree by number', () => {
  const a = answerQuestion('how is tree 7?', ctx());
  assert.equal(a.intent, 'tree');
  assert.match(a.text, /Tree 7 is sick/);
  assert.equal(a.link?.href, '/plant/7');
  assert.equal(answerQuestion('mti 99', ctx()).tone, 'unsure');
});

test('block, and block + water', () => {
  assert.equal(answerQuestion('block c', ctx()).intent, 'block');
  const w = answerQuestion('should I water block A', ctx());
  assert.equal(w.intent, 'watering');
  assert.match(w.text, /due today/);
});

test('tasks, watering, soil, recent, worked', () => {
  assert.match(answerQuestion('What should I do today?', ctx()).text, /1 job for today/);
  assert.match(answerQuestion('maji', ctx()).text, /1 place needs water now/);
  assert.match(answerQuestion('udongo wangu', ctx()).text, /250 metres/);
  assert.match(answerQuestion('what did I find this week', ctx()).text, /2 scans in the last 7 days/);
  assert.match(answerQuestion('what worked', ctx()).text, /spraying helped coffee leaf rust 3 of 4 times/);
});

test('farm overview names the sick tree and links to it', () => {
  const a = answerQuestion('Which trees are sick?', ctx());
  assert.equal(a.intent, 'farm');
  assert.match(a.text, /Tree 7 \(sick, coffee leaf rust\)/);
  assert.equal(a.link?.href, '/plant/7');
});

test('empty data answers honestly', () => {
  const empty = ctx({ scans: [], trees: [], tasks: [], watering: [], soil: null, outcomes: {} });
  assert.match(answerQuestion('how is my farm', empty).text, /no scans yet/);
  assert.match(answerQuestion('what worked', empty).text, /enough history/);
  assert.equal(answerQuestion('soil', empty).tone, 'unsure');
});

test('unrelated question → unsure, points to extension officer', () => {
  const a = answerQuestion('what is the price of maize in Nairobi', ctx());
  assert.equal(a.intent, 'unknown');
  assert.match(a.text, /extension officer/);
});
