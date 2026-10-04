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
import { colors, makeStyles } from '../../lib/theme';
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
          <PressableScale key={l} onPress={() => { setLang(l); setAnswer(null); }} style={[styles.langPill, lang === l && styles.langPillOn]} accessibilityRole="radio" accessibilityState={{ checked: lang === l }}>
            <Text style={[styles.langText, lang === l && styles.langTextOn]}>{l === 'sw' ? 'Kiswahili' : 'English'}</Text>
          </PressableScale>
        ))}
      </View>

      <View style={styles.chips}>
        {ANSWER_INTENTS.map((intent) => {
          const on = answer?.intent === intent;
          return (
            <PressableScale
              key={intent}
              onPress={() => show(answerChip(diseaseId, intent, lang))}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityLabel={INTENT_LABELS[lang][intent]}
              accessibilityState={{ selected: on }}
            >
              <Ionicons name={ICONS[intent]} size={22} color={on ? colors.onPrimary : colors.emeraldBright} />
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{INTENT_LABELS[lang][intent]}</Text>
            </PressableScale>
          );
        })}
      </View>

      {answer ? (
        <PressableScale onPress={() => speak(answer)} style={styles.answer} accessibilityLabel="Play answer again">
          <View style={styles.answerRow}>
            <View style={styles.answerIcon}>
              <Ionicons name="volume-high" size={20} color={colors.onPrimary} />
            </View>
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
  langPill: { minHeight: 44, paddingHorizontal: 18, borderRadius: 22, justifyContent: 'center', backgroundColor: c.fill },
  langPillOn: { backgroundColor: colors.primary },
  langText: { fontSize: 16, fontWeight: '700', color: c.label },
  langTextOn: { color: colors.onPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.cardRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.emeraldTintStrong,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 16, fontWeight: '600', color: c.label },
  chipTextOn: { color: colors.onPrimary },
  answer: { padding: 14, borderRadius: 22, backgroundColor: c.cardRaised, gap: 6 },
  answerRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  answerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  answerText: { flex: 1, fontSize: 17, lineHeight: 25, color: c.labelStrong },
  via: { fontSize: 12, color: c.labelSecondary },
}));
