/**
 * Offline "Ask" assistant — answers farmer questions from data on the phone
 * only: the disease knowledge base (assets/diseases.json), her scans, trees,
 * blocks, to-dos, watering log, bundled soil map and "what worked" stats.
 *
 * No network, no LLM: a question is matched to a topic by keywords (English
 * plus common Swahili words, since Gĩkũyũ voice notes are transcribed as
 * Swahili — docs/VOICE.md), and the answer is filled in from local records.
 *
 * CLAUDE.md rules that apply here:
 *   - Inform, never act: answers end with a recommendation, nothing is done for her.
 *   - No confident wrong answers: symptoms described in words are only ever a
 *     "might be"; anything not understood says so and points to the extension officer.
 *
 * Pure (no React Native imports) so it runs under `npm test`. Callers build the
 * ChatContext — see lib/chatContext.ts.
 */

import type { ActionType, IssueRecord } from './db';
import type { HealthLevel, OutcomeStats, Suggestion } from './insights';

const DAY = 86_400_000;

// ── Context ───────────────────────────────────────────────────────────────────

export interface DiseaseInfo {
  id: string;
  name: string;
  severity: string;
  description: string;
  immediateAction: string;
  treatment: string;
  urgencyDays: number | null;
  yieldImpact: string | null;
}

/** One block or tagged tree, with the insight engine's verdict. */
export interface SubjectSummary {
  label: string;
  plantId: number | null;
  block: string | null;
  /** Painted tag number (trees only). */
  tag: number | null;
  level: HealthLevel;
  next: Suggestion | null;
  lastScan: IssueRecord | null;
}

export interface ChatTask {
  title: string;
  /** "Tree 7", "Block C", "Farm". */
  where: string;
  /** "Today", "Overdue 2 days", "Tomorrow" … */
  when: string;
  overdue: boolean;
  dueToday: boolean;
}

export interface ChatWatering {
  label: string;
  /** "Overdue 2 days", "Due today", "In 3 days", "Not logged yet". */
  due: string;
  /** "today", "yesterday", "5 days ago", "never". */
  last: string;
  dueToday: boolean;
  everyDays: number;
}

export interface ChatSoil {
  ph: number;
  nitrogen: number;
  phAdvice: string;
  generalAdvice: string;
  /** Where the numbers came from, e.g. "Offline · farm soil map". */
  source: string;
}

export interface ChatContext {
  now: number;
  diseases: Record<string, DiseaseInfo>;
  /** All logged scans (any order). */
  scans: IssueRecord[];
  blocks: SubjectSummary[];
  trees: SubjectSummary[];
  /** Open to-dos, most urgent first. */
  tasks: ChatTask[];
  watering: ChatWatering[];
  soil: ChatSoil | null;
  /** "Did the next scan get better after this action?" — from this farm. */
  outcomes: OutcomeStats;
}

// ── Answers ───────────────────────────────────────────────────────────────────

export type Intent =
  | 'greeting'
  | 'help'
  | 'disease'
  | 'symptoms'
  | 'farm'
  | 'tree'
  | 'block'
  | 'tasks'
  | 'watering'
  | 'soil'
  | 'recent'
  | 'worked'
  | 'unknown';

/** Shown with a colour + icon in the chat (never colour alone). */
export type AnswerTone = 'good' | 'info' | 'warn' | 'unsure';

export interface ChatAnswer {
  intent: Intent;
  text: string;
  tone: AnswerTone;
  /** Set when the answer is about one disease — the voice pack clip can be played for it. */
  diseaseId?: string;
  /** Optional page to open for more ("Open Tree 7"). */
  link?: { label: string; href: string };
}

/** Starter questions shown as big tappable chips (icon + short text). */
export const STARTER_QUESTIONS: { key: string; icon: 'leaf' | 'today' | 'water' | 'soil' | 'rust' | 'worked'; text: string }[] = [
  { key: 'farm', icon: 'leaf', text: 'Which trees are sick?' },
  { key: 'tasks', icon: 'today', text: 'What should I do today?' },
  { key: 'water', icon: 'water', text: 'Do I need to water?' },
  { key: 'rust', icon: 'rust', text: 'How do I treat leaf rust?' },
  { key: 'soil', icon: 'soil', text: 'How is my soil?' },
  { key: 'worked', icon: 'worked', text: 'What worked on my farm?' },
];

const OFFICER = 'If you are unsure, we recommend asking your extension officer.';

// ── Matching ──────────────────────────────────────────────────────────────────

/** Lower-case, accents removed (Gĩkũyũ ĩ/ũ → i/u), punctuation → spaces. */
export function normalize(text: string): string {
  return ` ${text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/** True when any keyword occurs as a whole word/phrase. A trailing `*` matches word starts ("spray*" → "spraying"). */
function has(norm: string, keywords: string[]): boolean {
  return keywords.some((k) => count(norm, k) > 0);
}

function count(norm: string, keyword: string): number {
  if (keyword.endsWith('*')) {
    const stem = keyword.slice(0, -1);
    return norm.split(' ').filter((w) => w.length >= stem.length && w.startsWith(stem)).length;
  }
  return norm.includes(` ${keyword} `) ? 1 : 0;
}

const DISEASE_NAMES: Record<string, string[]> = {
  coffee_leaf_rust: ['rust*', 'kutu', 'hemileia'],
  coffee_leaf_miner: ['miner*', 'leucoptera'],
  coffee_phoma: ['phoma'],
  coffee_brown_eye: ['brown eye', 'eye spot', 'cercospora'],
};

/** Words that describe what a farmer sees. Used only to say "this might be …". */
const SYMPTOMS: Record<string, string[]> = {
  coffee_leaf_rust: ['orange', 'chungwa', 'powder*', 'unga', 'underside', 'under the leaf', 'yellow', 'njano', 'rusty'],
  coffee_leaf_miner: ['tunnel*', 'blister*', 'mines', 'caterpillar*', 'worm*', 'larva*', 'wadudu', 'funza', 'insect*', 'inside the leaf', 'trail*'],
  coffee_phoma: ['halo', 'dark brown', 'black*', 'cold', 'frost', 'baridi', 'dieback', 'tips dry*', 'dry tip*'],
  coffee_brown_eye: ['eye', 'circle*', 'round', 'ring*', 'grey cent*', 'gray cent*', 'light cent*', 'kahawia'],
};

const KW = {
  greeting: ['hi', 'hello', 'hey', 'habari', 'jambo', 'hujambo', 'mambo', 'salama', 'good morning', 'wimwega', 'uhoro'],
  thanks: ['thanks', 'thank you', 'asante', 'ni wega', 'nimuwega'],
  help: ['help', 'what can you', 'what do you know', 'msaada', 'saidia', 'how does this work', 'unaweza'],
  treat: ['treat*', 'spray*', 'cure', 'medicine', 'dawa', 'nyunyiz*', 'fungicide*', 'pesticide*', 'kill', 'control', 'tibu', 'what do i do', 'what should i do', 'how do i', 'fix', 'stop it', 'get rid'],
  look: ['look like', 'looks like', 'sign*', 'symptom*', 'identify', 'recognise', 'recognize', 'dalili', 'see it', 'what is'],
  harm: ['bad', 'danger*', 'serious', 'yield', 'harvest', 'lose', 'loss', 'mavuno', 'hatari', 'spread*', 'kill my', 'die'],
  farm: ['farm', 'shamba', 'sick', 'healthy', 'health', 'status', 'how are my', 'how is my', 'which trees', 'worst', 'trees', 'miti', 'mgonjwa', 'wagonjwa', 'overview', 'everything'],
  tasks: ['to do', 'todo', 'task*', 'do today', 'should i do', 'next step', 'kazi', 'leo nifanye', 'nifanye nini', 'plan', 'remind*'],
  watering: ['water*', 'irrigat*', 'maji', 'mwagilia', 'rain*', 'mvua', 'dry', 'kavu', 'drought'],
  soil: ['soil', 'udongo', 'ph', 'acid*', 'lime', 'chokaa', 'nitrogen', 'fertili*', 'mbolea', 'manure', 'compost', 'nutrient*'],
  recent: ['today', 'leo', 'this week', 'wiki hii', 'last scan', 'recent*', 'found', 'yesterday', 'jana', 'history', 'how many scans', 'scans'],
  worked: ['worked', 'works', 'helped', 'effective', 'success*', 'did it help', 'imesaidia', 'ilifanya kazi', 'best treatment', 'what helps'],
  disease: ['disease*', 'ugonjwa', 'magonjwa', 'spot*', 'madoa', 'leaf', 'leaves', 'majani', 'jani'],
};

// ── Entry point ───────────────────────────────────────────────────────────────

/** Answers one question from local data. Always returns an answer (never throws on odd input). */
export function answerQuestion(question: string, ctx: ChatContext): ChatAnswer {
  const norm = normalize(question);
  if (norm.trim() === '') return helpAnswer();

  // 1. A specific tree ("tree 7", "mti 7", "#7") or block ("block C").
  const treeNo = norm.match(/ (?:tree|mti|tag|no|number|namba) (\d{1,4}) /)?.[1] ?? norm.match(/^ (\d{1,4}) $/)?.[1];
  if (treeNo) return treeAnswer(Number(treeNo), ctx);
  const blockId = norm.match(/ (?:block|blok|kitalu|plot) ([a-z]) /)?.[1];
  if (blockId) return blockAnswer(blockId.toUpperCase(), ctx, norm);

  // 2. A disease named outright.
  const named = Object.entries(DISEASE_NAMES).find(([, kws]) => has(norm, kws))?.[0];
  if (named) {
    if (has(norm, KW.worked) && !has(norm, KW.treat)) return workedAnswer(ctx, named);
    return diseaseAnswer(named, ctx, norm);
  }

  // 3. Topics about her own farm.
  if (has(norm, KW.worked) && !has(norm, KW.tasks)) return workedAnswer(ctx);
  if (has(norm, KW.watering)) return wateringAnswer(ctx);
  if (has(norm, KW.soil)) return soilAnswer(ctx);
  if (has(norm, KW.tasks)) return tasksAnswer(ctx);

  // 4. Symptoms described in words → "might be", never a diagnosis.
  const symptom = symptomGuess(norm);
  if (symptom) return symptom;

  if (has(norm, KW.recent)) return recentAnswer(ctx, norm);
  if (has(norm, KW.farm)) return farmAnswer(ctx);
  if (has(norm, KW.disease) || has(norm, KW.treat)) return symptomsUnclear();

  if (has(norm, KW.thanks)) return { intent: 'greeting', tone: 'good', text: 'You are welcome. Ask me any time.' };
  if (has(norm, KW.greeting)) return greetingAnswer(ctx);
  if (has(norm, KW.help)) return helpAnswer();

  return {
    intent: 'unknown',
    tone: 'unsure',
    text:
      "Sorry, I don't know that. I can only answer from what is on this phone: coffee leaf diseases, your trees and blocks, " +
      `what to do today, watering, soil, and what worked. ${OFFICER}`,
  };
}

// ── Topic answers ─────────────────────────────────────────────────────────────

function greetingAnswer(ctx: ChatContext): ChatAnswer {
  const sick = ctx.trees.filter((t) => t.level === 'sick').length + ctx.blocks.filter((b) => b.level === 'sick').length;
  const due = ctx.tasks.filter((t) => t.overdue || t.dueToday).length;
  const bits = [
    sick > 0 ? `${sick} ${sick === 1 ? 'place needs' : 'places need'} care` : 'nothing looks sick right now',
    due > 0 ? `${due} ${due === 1 ? 'job is' : 'jobs are'} due today` : 'no jobs are due today',
  ];
  return { intent: 'greeting', tone: 'good', text: `Hello! On your farm, ${bits.join(', and ')}. Ask me about your trees, diseases, watering or soil.` };
}

function helpAnswer(): ChatAnswer {
  return {
    intent: 'help',
    tone: 'info',
    text:
      'Ask me about: coffee leaf rust, leaf miner, Phoma or brown eye spot; a tree like "tree 7"; a block like "block C"; ' +
      'what to do today; watering; your soil; or what worked. Tap a question below, or hold the microphone and speak. ' +
      'I use only what is saved on this phone, so I work without internet.',
  };
}

function diseaseAnswer(id: string, ctx: ChatContext, norm: string): ChatAnswer {
  const d = ctx.diseases[id];
  if (!d) return symptomsUnclear();
  const tone: AnswerTone = d.severity === 'high' || d.severity === 'medium' ? 'warn' : 'info';
  const urgency = d.urgencyDays ? ` Act within ${d.urgencyDays} days.` : '';
  const farm = farmHistory(id, ctx);
  const worked = evidenceLine(id, ctx.outcomes);
  const end = 'We recommend scanning the leaf first to confirm. ' + OFFICER;

  let body: string;
  if (has(norm, KW.treat)) {
    body = `${d.name}. Do this now: ${d.immediateAction} Treatment: ${d.treatment}${urgency}`;
  } else if (has(norm, KW.harm)) {
    body = `${d.name}. ${d.yieldImpact ?? ''} ${d.description}${urgency}`;
  } else if (has(norm, KW.look)) {
    body = `${d.name}. What it looks like: ${d.description}`;
  } else {
    body = `${d.name}. ${d.description} Do this now: ${d.immediateAction} Treatment: ${d.treatment}${urgency}`;
  }
  return { intent: 'disease', tone, diseaseId: id, text: join(body, farm, worked, end) };
}

function symptomGuess(norm: string): ChatAnswer | null {
  const scores = Object.entries(SYMPTOMS)
    .map(([id, kws]) => ({ id, score: kws.reduce((n, k) => n + Math.min(1, count(norm, k)), 0) }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (best.score === 0) return null;
  // One weak word, or a tie, is not enough to name a disease.
  if (best.score < 2 || best.score - (second?.score ?? 0) < 1) return symptomsUnclear();
  // No diseaseId: the voice clip states the disease as found, which this is not.
  return {
    intent: 'symptoms',
    tone: 'unsure',
    text: join(
      `From your words, this might be ${DISEASE_LABEL[best.id]} — but I can't be sure without a photo.`,
      'We recommend scanning the leaf with the Scan tab: hold one leaf close, in daylight.',
      OFFICER,
    ),
    link: { label: 'Open Scan', href: '/scan' },
  };
}

function symptomsUnclear(): ChatAnswer {
  return {
    intent: 'symptoms',
    tone: 'unsure',
    text: join(
      "I can't tell which disease it is from words alone.",
      'We recommend scanning the leaf with the Scan tab: hold one leaf close, in daylight.',
      OFFICER,
    ),
    link: { label: 'Open Scan', href: '/scan' },
  };
}

function farmAnswer(ctx: ChatContext): ChatAnswer {
  const blocks = ctx.blocks.map((b) => `${b.label}: ${LEVEL_WORD[b.level]}`).join('. ');
  const sick = ctx.trees.filter((t) => t.level === 'sick' || t.level === 'watch');
  const worst = [...ctx.trees, ...ctx.blocks].find((s) => s.level === 'sick' && s.next) ?? [...ctx.trees, ...ctx.blocks].find((s) => s.next?.urgency === 'now');

  if (ctx.scans.length === 0) {
    return { intent: 'farm', tone: 'info', text: 'You have no scans yet, so I don’t know how your trees are. We recommend scanning a few leaves in each block.', link: { label: 'Open Scan', href: '/scan' } };
  }
  const treeLine =
    sick.length === 0
      ? 'None of your tagged trees look sick.'
      : `Trees that need care: ${sick
          .slice(0, 4)
          .map((t) => `${t.label} (${LEVEL_WORD[t.level].toLowerCase()}${t.lastScan && t.lastScan.diseaseId !== 'healthy' ? `, ${t.lastScan.diseaseName.toLowerCase()}` : ''})`)
          .join(', ')}${sick.length > 4 ? `, and ${sick.length - 4} more` : ''}.`;
  const next = worst?.next ? `Most urgent: ${worst.next.title.toLowerCase()} on ${worst.label}.` : '';
  return {
    intent: 'farm',
    tone: sick.length > 0 || ctx.blocks.some((b) => b.level === 'sick') ? 'warn' : 'good',
    text: join(`${blocks}.`, treeLine, next),
    link: worst ? subjectLink(worst) : { label: 'Open Plants', href: '/plants' },
  };
}

function treeAnswer(tag: number, ctx: ChatContext): ChatAnswer {
  const tree = ctx.trees.find((t) => t.tag === tag) ?? ctx.trees.find((t) => t.label.toLowerCase() === `tree ${tag}`);
  if (!tree) {
    return { intent: 'tree', tone: 'unsure', text: `I can't find tree ${tag} on this phone. Trees get a number when you tag a scan to them.`, link: { label: 'Open Plants', href: '/plants' } };
  }
  return subjectAnswer('tree', tree, ctx);
}

function blockAnswer(block: string, ctx: ChatContext, norm: string): ChatAnswer {
  const b = ctx.blocks.find((x) => x.block === block);
  if (!b) return { intent: 'block', tone: 'unsure', text: `I don't know a Block ${block} on your farm. Your blocks are ${ctx.blocks.map((x) => x.block).join(', ')}.` };
  if (has(norm, KW.watering)) {
    const w = ctx.watering.find((x) => x.label === b.label);
    if (w) return { intent: 'watering', tone: w.dueToday ? 'warn' : 'good', text: wateringLine(w) + ' We recommend checking the soil with your finger first — if it is still wet, wait.' };
  }
  return subjectAnswer('block', b, ctx);
}

function subjectAnswer(intent: 'tree' | 'block', s: SubjectSummary, ctx: ChatContext): ChatAnswer {
  const last = s.lastScan
    ? `Last scan ${agoDays(s.lastScan.timestamp, ctx.now)}: ${s.lastScan.diseaseName.toLowerCase()}.`
    : 'It has no scans yet.';
  const next = s.next ? `Suggested next step: ${s.next.title.toLowerCase()}. ${s.next.why}` : 'Nothing to do right now — keep checking after rain.';
  return {
    intent,
    tone: s.level === 'sick' ? 'warn' : s.level === 'good' ? 'good' : s.level === 'watch' ? 'warn' : 'info',
    diseaseId: (s.level === 'sick' || s.level === 'watch') && s.lastScan && s.lastScan.diseaseId !== 'healthy' ? s.lastScan.diseaseId : undefined,
    text: join(`${s.label} is ${LEVEL_WORD[s.level].toLowerCase()}.`, last, next),
    link: subjectLink(s),
  };
}

function tasksAnswer(ctx: ChatContext): ChatAnswer {
  if (ctx.tasks.length === 0) return { intent: 'tasks', tone: 'good', text: 'Your to-do list is empty. A good habit: walk the field after rain and scan any leaf with spots.', link: { label: 'Open To Do', href: '/tasks' } };
  const now = ctx.tasks.filter((t) => t.overdue || t.dueToday);
  const pool = now.length ? now : ctx.tasks;
  const list = pool.slice(0, 3);
  const lead = now.length
    ? `You have ${now.length} ${now.length === 1 ? 'job' : 'jobs'} for today.`
    : `Nothing is due today. Coming up:`;
  const items = list.map((t, i) => `${i + 1}. ${t.title} — ${t.where}, ${t.when.toLowerCase()}.`).join(' ');
  const more = pool.length > list.length ? ` And ${pool.length - list.length} more on the To Do page.` : '';
  return { intent: 'tasks', tone: now.some((t) => t.overdue) ? 'warn' : 'info', text: `${lead} ${items}${more}`, link: { label: 'Open To Do', href: '/tasks' } };
}

function wateringLine(w: ChatWatering): string {
  return `${w.label}: ${w.due.toLowerCase()} (last watered or rained ${w.last}, every ${w.everyDays} days).`;
}

function wateringAnswer(ctx: ChatContext): ChatAnswer {
  if (ctx.watering.length === 0) return { intent: 'watering', tone: 'info', text: 'No watering is logged yet. When you water or it rains, mark it on the To Do page so I can remind you.', link: { label: 'Open To Do', href: '/tasks' } };
  const due = ctx.watering.filter((w) => w.dueToday);
  const lead = due.length ? `${due.length} ${due.length === 1 ? 'place needs' : 'places need'} water now.` : 'Nothing needs water today.';
  const lines = (due.length ? due : ctx.watering).slice(0, 4).map(wateringLine).join(' ');
  return {
    intent: 'watering',
    tone: due.length ? 'warn' : 'good',
    text: join(lead, lines, 'We recommend checking the soil with your finger first — if it is still wet, wait.'),
    link: { label: 'Open To Do', href: '/tasks' },
  };
}

function soilAnswer(ctx: ChatContext): ChatAnswer {
  if (!ctx.soil) return { intent: 'soil', tone: 'unsure', text: `I don't have soil data for your farm on this phone. Open the Field Map once to load it. ${OFFICER}`, link: { label: 'Open Field Map', href: '/map' } };
  const s = ctx.soil;
  return {
    intent: 'soil',
    tone: s.ph >= 6 && s.ph <= 6.5 && s.nitrogen >= 1.5 ? 'good' : 'info',
    text: join(s.phAdvice, s.generalAdvice, `This is from a soil map (${s.source.toLowerCase()}) that covers about 250 metres, so a soil test of your own field is more exact.`),
    link: { label: 'Open Field Map', href: '/map' },
  };
}

function recentAnswer(ctx: ChatContext, norm: string): ChatAnswer {
  const today = has(norm, ['today', 'leo']);
  const from = today ? startOfDay(ctx.now) : ctx.now - 7 * DAY;
  const period = today ? 'today' : 'in the last 7 days';
  const scans = ctx.scans.filter((s) => s.timestamp >= from && s.timestamp <= ctx.now);
  if (scans.length === 0) return { intent: 'recent', tone: 'info', text: `You made no scans ${period}. We recommend checking a few trees in each block this week.`, link: { label: 'Open Scan', href: '/scan' } };
  const byDisease = new Map<string, number>();
  for (const s of scans) byDisease.set(s.diseaseName, (byDisease.get(s.diseaseName) ?? 0) + 1);
  const parts = [...byDisease.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name.toLowerCase()} ${n} ${n === 1 ? 'time' : 'times'}`);
  const urgent = scans.filter((s) => s.severity === 'high').length;
  return {
    intent: 'recent',
    tone: urgent ? 'warn' : 'info',
    text: join(`You made ${scans.length} ${scans.length === 1 ? 'scan' : 'scans'} ${period}: ${parts.join(', ')}.`, urgent ? `${urgent} ${urgent === 1 ? 'was' : 'were'} urgent.` : ''),
    link: { label: 'Open Report', href: '/report' },
  };
}

function workedAnswer(ctx: ChatContext, onlyDisease?: string): ChatAnswer {
  const lines = Object.entries(ctx.outcomes)
    .filter(([id]) => !onlyDisease || id === onlyDisease)
    .map(([id]) => evidenceLine(id, ctx.outcomes))
    .filter(Boolean);
  if (lines.length === 0) {
    return {
      intent: 'worked',
      tone: 'info',
      text: 'I don’t have enough history yet. After you treat a tree, log what you did and scan it again a week later — then I can tell you what worked.',
    };
  }
  return { intent: 'worked', tone: 'good', diseaseId: onlyDisease, text: join(...lines, 'These are counts from your own farm, not a guarantee.') };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LEVEL_WORD: Record<HealthLevel, string> = { good: 'Healthy', watch: 'Watch', sick: 'Sick', unknown: 'Not checked' };

const DISEASE_LABEL: Record<string, string> = {
  coffee_leaf_rust: 'coffee leaf rust',
  coffee_leaf_miner: 'coffee leaf miner',
  coffee_phoma: 'Phoma leaf spot',
  coffee_brown_eye: 'brown eye spot',
};

const ACTION_WORD: Partial<Record<ActionType, string>> = {
  sprayed: 'spraying',
  pruned: 'pruning',
  fertilised: 'fertiliser',
  removed_leaves: 'removing leaves',
};

/** "On your farm, spraying helped rust 3 of 4 times." (best action with ≥ 2 tries) */
function evidenceLine(diseaseId: string, outcomes: OutcomeStats): string {
  const byAction = outcomes[diseaseId];
  if (!byAction) return '';
  const best = Object.entries(byAction)
    .filter(([type, s]) => ACTION_WORD[type as ActionType] && s && s.total >= 2)
    .sort((a, b) => b[1]!.success / b[1]!.total - a[1]!.success / a[1]!.total || b[1]!.total - a[1]!.total)[0];
  if (!best) return '';
  const [type, s] = best;
  return `On your farm, ${ACTION_WORD[type as ActionType]} helped ${DISEASE_LABEL[diseaseId] ?? diseaseId} ${s!.success} of ${s!.total} times.`;
}

function farmHistory(diseaseId: string, ctx: ChatContext): string {
  const recent = ctx.scans.filter((s) => s.diseaseId === diseaseId && ctx.now - s.timestamp <= 30 * DAY);
  if (recent.length === 0) return 'It has not been found on your farm in the last 30 days.';
  const latest = recent.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
  const where = latest.block ? ` in Block ${latest.block}` : '';
  return `On your farm it was found ${recent.length} ${recent.length === 1 ? 'time' : 'times'} in the last 30 days, last ${agoDays(latest.timestamp, ctx.now)}${where}.`;
}

function subjectLink(s: SubjectSummary): ChatAnswer['link'] {
  return s.plantId != null ? { label: `Open ${s.label}`, href: `/plant/${s.plantId}` } : s.block ? { label: `Open ${s.label}`, href: `/block/${s.block}` } : undefined;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function agoDays(t: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function join(...parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
}
