/**
 * "Ask" section of the advisory sheet. Tap a question chip, or type / say a
 * question, and get the pre-written answer for this diagnosis — spoken aloud
 * in the farmer's language. Fully offline. See lib/advisor.ts.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import PressableScale from '../glass/PressableScale';
import SpeechInput from '../SpeechInput';
import { makeStyles } from '../../lib/theme';
import { ANSWER_INTENTS, Answer, INTENT_LABELS, Intent, Lang, answerChip, answerQuestion, toLang } from '../../lib/advisor';
import { DEFAULT_LANGUAGE } from '../../lib/stt';

const ICONS: Record<Exclude<Intent, 'outOfScope'>, keyof typeof Ionicons.glyphMap> = {
  summary: 'help-circle',
  doNow: 'hand-left',
  treatment: 'flask',
  prevention: 'shield-checkmark',
  spread: 'git-network',
  safety: 'warning',
  getHelp: 'call',
};

const SPEECH_LANG: Record<Lang, string> = { sw: 'sw-KE', en: 'en-US' };

export default function AskAdvisor({ diseaseId }: { diseaseId: string }) {
  const styles = useStyles();
  const [lang, setLang] = useState<Lang>(toLang(DEFAULT_LANGUAGE));
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    setAnswer(null);
    return () => { Speech.stop(); };
  }, [diseaseId]);

  const speak = useCallback((a: Answer) => {
    Speech.stop();
    Speech.speak(a.text, { language: SPEECH_LANG[a.lang], rate: 0.9 });
  }, []);

  const show = useCallback((a: Answer) => { setAnswer(a); speak(a); }, [speak]);

  const onAsk = useCallback((question: string) => {
    show(answerQuestion({ diseaseId, question, lang }));
  }, [diseaseId, lang, show]);

  return (
    <View style={styles.wrap}>
      <View style={styles.langRow}>
        {(['sw', 'en'] as Lang[]).map((l) => (
          <PressableScale key={l} onPress={() => { setLang(l); setAnswer(null); }} style={[styles.langPill, lang === l && styles.langPillOn]}>
            <Text style={[styles.langText, lang === l && styles.langTextOn]}>{l === 'sw' ? 'Kiswahili' : 'English'}</Text>
          </PressableScale>
        ))}
      </View>

      <View style={styles.chips}>
        {ANSWER_INTENTS.map((intent) => (
          <PressableScale
            key={intent}
            onPress={() => show(answerChip(diseaseId, intent, lang))}
            style={[styles.chip, answer?.intent === intent && styles.chipOn]}
            accessibilityLabel={INTENT_LABELS[lang][intent]}
          >
            <Ionicons name={ICONS[intent]} size={22} color={answer?.intent === intent ? '#fff' : '#2D6A4F'} />
            <Text style={[styles.chipText, answer?.intent === intent && styles.chipTextOn]}>{INTENT_LABELS[lang][intent]}</Text>
          </PressableScale>
        ))}
      </View>

      {answer ? (
        <PressableScale onPress={() => speak(answer)} style={styles.answer} accessibilityLabel="Play answer again">
          <View style={styles.answerRow}>
            <Ionicons name="volume-high" size={22} color="#2D6A4F" />
            <Text style={styles.answerText}>{answer.text}</Text>
          </View>
          {__DEV__ && (
            <Text style={styles.via}>
              via {answer.via} → {answer.intent}
              {answer.confidence != null ? ` (${Math.round(answer.confidence * 100)}%)` : ''}
            </Text>
          )}
        </PressableScale>
      ) : null}

      <SpeechInput onTranscript={onAsk} placeholder={lang === 'sw' ? 'Uliza swali…' : 'Ask a question…'} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { gap: 12, padding: 16, borderRadius: 26, backgroundColor: c.card },
  langRow: { flexDirection: 'row', gap: 8 },
  langPill: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, justifyContent: 'center', backgroundColor: c.fill },
  langPillOn: { backgroundColor: '#2D6A4F' },
  langText: { fontSize: 16, fontWeight: '600', color: c.label },
  langTextOn: { color: '#fff' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: '#2D6A4F',
  },
  chipOn: { backgroundColor: '#2D6A4F' },
  chipText: { fontSize: 16, fontWeight: '600', color: c.label },
  chipTextOn: { color: '#fff' },
  answer: { padding: 14, borderRadius: 20, backgroundColor: c.fill, gap: 6 },
  answerRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  answerText: { flex: 1, fontSize: 17, lineHeight: 25, color: c.labelStrong },
  via: { fontSize: 12, color: c.labelSecondary },
}));
