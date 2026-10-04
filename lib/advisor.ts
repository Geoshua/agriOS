/**
 * Offline advisor: answers a farmer's question about a scan result with
 * pre-written, reviewed text from assets/advisory_responses.json.
 *
 * Nothing here generates advice. A question is ROUTED to one intent
 * (summary, doNow, treatment, …) and the matching pre-written response is
 * returned verbatim. Routing order:
 *   1. Keyword matcher (Swahili + English) — deterministic, instant.
 *   2. On-device LLM router (optional, injected) — only for questions the
 *      keywords miss.
 *   3. 'outOfScope' — "ask your extension officer". Never a guess.
 *
 * Why the LLM may not write: in testing, phone-sized models (Qwen2.5-0.5B,
 * Qwen3-0.6B) invented unsafe advice ("Yes, you can use DDT") and garbled
 * Swahili. See TRAINING.md → "On-device LLM".
 *
 * Pure TypeScript, no React Native imports, so it can be unit-tested on desktop.
 */

import data from '../assets/advisory_responses.json';

export type Lang = 'sw' | 'en';
export type Intent =
  | 'summary'
  | 'doNow'
  | 'treatment'
  | 'prevention'
  | 'spread'
  | 'safety'
  | 'getHelp'
  | 'outOfScope';

export const ANSWER_INTENTS: Exclude<Intent, 'outOfScope'>[] = [
  'summary', 'doNow', 'treatment', 'prevention', 'spread', 'safety', 'getHelp',
];

export interface Answer {
  intent: Intent;
  text: string;
  lang: Lang;
  /** How the question was routed — shown in dev builds, useful for judges. */
  via: 'chip' | 'keywords' | 'llm' | 'fallback';
}

/** Optional LLM router. Returns an intent, or null if unsure / unavailable. */
export type LlmRouter = (question: string) => Promise<Intent | null>;

const responses = data.responses as Record<string, Record<Lang, Record<string, string>>>;
const general = data.general as Record<Lang, Record<string, string>>;

/** Map app language codes ('sw', 'sw-KE', 'Swahili', 'en-US' …) to a supported one. */
export function toLang(language?: string | null): Lang {
  return language && /^(sw|swahili|kiswahili)/i.test(language) ? 'sw' : language && /^en/i.test(language) ? 'en' : 'sw';
}

export function getResponse(diseaseId: string, intent: Intent, lang: Lang): string {
  if (intent === 'outOfScope') return general[lang].outOfScope;
  const byDisease = responses[diseaseId] ?? responses.unknown;
  return byDisease[lang][intent] ?? byDisease.en[intent];
}

/** Short spoken/printed labels for the question chips. */
export const INTENT_LABELS: Record<Lang, Record<Exclude<Intent, 'outOfScope'>, string>> = {
  sw: {
    summary: 'Ni nini?',
    doNow: 'Nifanye nini sasa?',
    treatment: 'Dawa gani?',
    prevention: 'Kuzuia',
    spread: 'Inaenea?',
    safety: 'Usalama',
    getHelp: 'Nimuulize nani?',
  },
  en: {
    summary: 'What is it?',
    doNow: 'What now?',
    treatment: 'Which spray?',
    prevention: 'Prevent it',
    spread: 'Does it spread?',
    safety: 'Is it safe?',
    getHelp: 'Who can help?',
  },
};

// ── Keyword router ────────────────────────────────────────────────────────────
// Patterns are matched against a lower-cased, accent-stripped question.
// Order matters: earlier intents win ties (safety before treatment, so
// "is the spray dangerous" is about safety, not which spray).
// outOfScope comes first so banned chemicals / prices never get an answer.

const KEYWORDS: [Intent, RegExp][] = [
  // Off-topic first, so banned chemicals, prices, other crops and livestock never get an answer.
  ['outOfScope', /\b(ddt|endosulfan|paraquat|bei|price\w*|how much (is|does|are)|cost\w*|sell\w*|soko|market|buyer|mnunuzi|weather|hali ya hewa|mvua|rain\w*|loan|mkopo|maize|mahindi|banana|ndizi|beans|maharage|tea|chai|cows? (is|are) sick|ng'?ombe (ni )?mgonjwa|habari|hello|jambo)\b/],
  ['safety', /\b(hatari|salama|usalama|sumu|danger\w*|safe\w*|poison\w*|toxic|harm\w*|kids?|child\w*|watoto|mtoto|animals?|wanyama|mbuzi|kuku|chickens?|goats?|gloves?|glavu|mask|barakoa|wear|vaa|protect (my|myself)|jikinga)\b/],
  ['getHelp', /\b(nani|who|someone|mtu|expert|officer|afisa|ugani|agronomist|mtaalamu|wataalamu|co-?op\w*|chama|call|piga simu|talk to|ongea na|help me|nisaidie|msaada|report|ripoti)\b/],
  ['spread', /\b(enea|inaenea|kuenea|huenea|itafika|fika|ambukiz\w*|spread\w*|contagious|catch\w*|infect\w*|jump\w*|move\w*|wind|upepo|neighbou?rs?\w*|jirani|other (trees|plants|farms?)|miti mingine|mimea mingine)\b/],
  ['prevention', /\b(zuia|kuzuia|nitazuiaje|zuiaje|isitokee|tena|again|prevent\w*|avoid\w*|stop it|come back|coming back|rudi|usirudi|kurudi|next (year|season)|msimu ujao|mwaka ujao|in future|baadaye|keep (my )?(trees|plants|farm) healthy|afya)\b/],
  ['treatment', /\b(dawa|spray\w*|nyunyiz\w*|kemikali|chemicals?|fungicide|insecticide|pesticide|medicine|cure|treat\w*|tibu|tiba|mbolea|fertili[sz]er|copper|shaba|neem|mwarobaini|agrovet|duka|shop|buy|nunua|put on|apply|pake|weka nini|how often|mara ngapi)\b/],
  ['doNow', /\b(nifanye|nifanyeje|fanya|sasa|leo|today|now|first|kwanza|start|anza|nianze|begin|immediately|haraka|chome|nichome|burn|cut|kata|nikate|ondoa|remove|pick|chuma)\b/],
  ['summary', /\b(ni nini|hii ni|huu ni|ni ugonjwa|ugonjwa gani|ugonjwa huu|tatizo (hili|gani)|linaitwaje|unaitwaje|jina|what is|what's|which disease|what disease|about this|tell me|name|serious|bad|mbaya|kali)\b/],
];

// Swahili verbs take subject/tense prefixes (ni-ta-enea, a-na-ambukiza,
// ni-ondoe), so these stems match anywhere inside a word, not only at its start.
const SW_STEMS: [Intent, RegExp][] = [
  ['spread', /(enea|ambukiz|fika shamba)/],
  ['prevention', /(zuia|kinga|tokee tena|rudi)/],
  ['treatment', /(nyunyiz|tibu|pulizi)/],
  ['doNow', /(ondo[ae]|chom[ae]|kat[ae] (majani|matawi)|ng'?o[ae]|chum[ae])/],
];

function normalise(q: string): string {
  return q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[?!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function matchKeywords(question: string): Intent | null {
  const q = normalise(question);
  if (!q) return null;
  for (const [intent, re] of KEYWORDS) if (re.test(q)) return intent;
  for (const [intent, re] of SW_STEMS) if (re.test(q)) return intent;
  return null;
}

// ── Entry points ──────────────────────────────────────────────────────────────

/** Tapped question chip — deterministic. */
export function answerChip(diseaseId: string, intent: Intent, lang: Lang): Answer {
  return { intent, text: getResponse(diseaseId, intent, lang), lang, via: 'chip' };
}

/** Free-text / voice question. */
export async function answerQuestion(params: {
  diseaseId: string;
  question: string;
  lang: Lang;
  llm?: LlmRouter | null;
}): Promise<Answer> {
  const { diseaseId, question, lang, llm } = params;

  const kw = matchKeywords(question);
  if (kw) return { intent: kw, text: getResponse(diseaseId, kw, lang), lang, via: 'keywords' };

  if (llm) {
    try {
      const routed = await llm(question);
      if (routed && routed !== 'outOfScope') {
        return { intent: routed, text: getResponse(diseaseId, routed, lang), lang, via: 'llm' };
      }
    } catch { /* LLM unavailable — fall through */ }
  }

  return { intent: 'outOfScope', text: getResponse(diseaseId, 'outOfScope', lang), lang, via: 'fallback' };
}
