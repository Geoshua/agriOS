/**
 * Dev-only end-to-end test: classifier → threshold → pre-written answer → intent classifier,
 * all on the phone. Open with:  adb shell am start -d agrios://dev-test
 *
 * Inputs pushed by adb into the app's document directory:
 *   devtest/<bracol-class>/*.jpg     held-out validation images
 * Every result line is also console.log'd with a [devtest] prefix for logcat.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { Directory, Paths } from 'expo-file-system';
import { classifyWithTflite, TFLITE_AVAILABLE } from '../lib/tflite';
import { answerQuestion, getResponse, Intent } from '../lib/advisor';
import diseasesData from '../assets/diseases.json';
import AskAdvisor from '../components/advisory/AskAdvisor';

const FOLDER_TO_ID: Record<string, string> = {
  rust: 'coffee_leaf_rust', miner: 'coffee_leaf_miner', phoma: 'coffee_phoma',
  cercospora: 'coffee_brown_eye', healthy: 'healthy',
};

// Same unseen question set used for the desktop evaluation.
const QUESTIONS: [string, Intent][] = [
  ['Hii ni kutu?', 'summary'], ['Is this rust?', 'summary'], ['Majani yangu yana nini?', 'summary'],
  ['Nifanye nini kwanza na mti huu?', 'doNow'], ['What do I do with the sick leaves?', 'doNow'], ['Niyakate majani haya?', 'doNow'],
  ['Nitanyunyizia lini?', 'treatment'], ['Which fungicide works?', 'treatment'], ['Nitapata dawa wapi?', 'treatment'],
  ['Mwaka ujao nifanye nini isirudi?', 'prevention'], ['How do I make my trees stronger?', 'prevention'],
  ['Inaambukiza kahawa yote?', 'spread'], ['Does it spread by rain?', 'spread'], ['Itaenda kwa miti ya jirani?', 'spread'],
  ['Nivae nini nikinyunyizia?', 'safety'], ['Is it safe for bees?', 'safety'], ['Maji ya kunywa yataharibika?', 'safety'],
  ['Afisa ugani yuko wapi?', 'getHelp'], ['Can someone come and look?', 'getHelp'],
  ['Nitapata mkopo?', 'outOfScope'], ['What is the price of coffee today?', 'outOfScope'], ['Mke wangu ni mgonjwa', 'outOfScope'],
  ['Play music', 'outOfScope'], ['Avocado zangu zina shida', 'outOfScope'],
];

export default function DevTest() {
  const [lines, setLines] = useState<string[]>([]);
  const [run, setRun] = useState(0); // the test (incl. the slow LLM) starts only when tapped

  useEffect(() => {
    if (!__DEV__ || run === 0) return;
    setLines([]);
    const log = (s: string) => { console.log(`[devtest] ${s}`); setLines((l) => [...l, s]); };

    (async () => {
      const threshold = diseasesData.confidenceThreshold;

      // ── 1. Classifier → threshold → pre-written answer ──────────────────────
      log(`TFLite available: ${TFLITE_AVAILABLE}`);
      const root = new Directory(Paths.document, 'devtest');
      let n = 0, correct = 0, unknown = 0, wrongConfident = 0, ms = 0;
      if (root.exists) {
        for (const dir of root.list()) {
          if (!(dir instanceof Directory)) continue;
          const expected = FOLDER_TO_ID[dir.name];
          for (const f of dir.list()) {
            const t = Date.now();
            const r = await classifyWithTflite(f.uri);
            ms += Date.now() - t;
            if (!r) { log(`FAIL ${dir.name}/${f.name}: no result`); continue; }
            n++;
            const shown = r.confidence >= threshold ? r.diseaseId : 'unknown';
            if (shown === 'unknown') unknown++;
            else if (shown === expected) correct++;
            else wrongConfident++;
            log(`${dir.name}/${f.name} → ${r.diseaseId} ${(r.confidence * 100).toFixed(0)}% ⇒ shown: ${shown} ${shown === expected ? 'OK' : shown === 'unknown' ? 'UNSURE' : 'WRONG'}`);
          }
        }
        log(`CLASSIFIER: ${n} images | correct ${correct} | unsure ${unknown} | wrong-but-confident ${wrongConfident} | avg ${Math.round(ms / Math.max(n, 1))} ms/image`);
        log(`ANSWER (sw, rust, doNow): ${getResponse('coffee_leaf_rust', 'doNow', 'sw')}`);
      } else {
        log('No devtest images pushed — skipping classifier test');
      }

      // ── 2. Question routing: on-device intent classifier (+ keyword fallback) ─
      let ok = 0, wrong = 0, deferred = 0;
      const t0 = Date.now();
      const via: Record<string, number> = {};
      for (const [q, want] of QUESTIONS) {
        const a = answerQuestion({ diseaseId: 'coffee_leaf_rust', question: q, lang: 'sw' });
        via[a.via] = (via[a.via] ?? 0) + 1;
        if (a.intent === want) ok++;
        else if (a.intent === 'outOfScope') deferred++;
        else { wrong++; log(`  WRONG "${q}" → ${a.intent} via ${a.via} (want ${want})`); }
      }
      log(`ROUTER: correct ${ok}/${QUESTIONS.length} | wrong ${wrong} | deferred ${deferred} | ` +
        `${((Date.now() - t0) / QUESTIONS.length).toFixed(1)} ms/question | via ${JSON.stringify(via)}`);
      log('DONE');
    })().catch((e) => log(`ERROR ${String(e)}`));
  }, [run]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#fff' }} contentContainerStyle={{ padding: 16, paddingTop: 60, gap: 12 }}>
      {/* The real Ask UI, for a visual check (rust diagnosis) */}
      <AskAdvisor diseaseId="coffee_leaf_rust" />
      <Pressable onPress={() => setRun((r) => r + 1)} style={{ minHeight: 48, borderRadius: 24, backgroundColor: '#2D6A4F', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Run end-to-end test</Text>
      </Pressable>
      {lines.map((l, i) => <Text key={i} style={{ fontSize: 12, fontFamily: 'monospace', color: '#000' }}>{l}</Text>)}
    </ScrollView>
  );
}
