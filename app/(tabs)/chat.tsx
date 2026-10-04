/**
 * Ask — a chat that answers questions from data on this phone only
 * (lib/chat.ts + lib/chatContext.ts). Works with no signal.
 *
 * Built for a farmer who may not read well:
 *   - big picture buttons for common questions (tap = ask, answer is spoken)
 *   - hold the microphone to ask by voice (needs internet for transcription;
 *     offline it says so out loud and points to the picture buttons)
 *   - every answer has a speaker; answers about a disease play the voice-pack
 *     clip in her language when one is installed
 * It only informs — nothing is ordered, sent or logged from here.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { Href, router, useFocusEffect } from 'expo-router';
import Animated, { FadeInDown, FadeInUp, ZoomIn, ZoomOut } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { RecordingPresets, useAudioRecorder } from 'expo-audio';
import ScreenTransition from '../../components/glass/ScreenTransition';
import PressableScale from '../../components/glass/PressableScale';
import { Pause, Speaker } from '../../components/glass/Icons';
import ReadAloudButton from '../../components/ReadAloudButton';
import { answerQuestion, AnswerTone, ChatAnswer, ChatContext, STARTER_QUESTIONS } from '../../lib/chat';
import { loadChatContext } from '../../lib/chatContext';
import { DEFAULT_LANGUAGE, requestMicPermission, startRecording, stopAndTranscribe } from '../../lib/stt';
import { getPackInfo } from '../../lib/voicePacks';
import { playAdvisory, speakText, stopAll } from '../../lib/voice';
import { useShambaStore } from '../../lib/store';
import { colors, makeStyles, useTheme } from '../../lib/theme';
import { TAB_BAR_HEIGHT, useChromeInsets } from '../../lib/layout';

interface Message {
  id: number;
  from: 'me' | 'bot';
  text: string;
  answer?: ChatAnswer;
}

const TONE: Record<AnswerTone, { icon: keyof typeof Ionicons.glyphMap; color: string; word: string }> = {
  good: { icon: 'checkmark-circle', color: '#248A3D', word: 'Good news' },
  info: { icon: 'information-circle', color: '#1E7B3C', word: 'Information' },
  warn: { icon: 'warning', color: '#D86A00', word: 'Needs care' },
  unsure: { icon: 'help-circle', color: '#8E8E93', word: 'Not sure' },
};

const CHIP_ICON: Record<(typeof STARTER_QUESTIONS)[number]['icon'], { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  leaf: { name: 'leaf', color: '#248A3D' },
  today: { name: 'checkbox', color: '#D86A00' },
  water: { name: 'water', color: '#0A84FF' },
  rust: { name: 'alert-circle', color: '#D70015' },
  soil: { name: 'layers', color: '#8B5E3C' },
  worked: { name: 'trending-up', color: '#248A3D' },
};

let msgSeq = 0;

export default function ChatScreen() {
  const styles = useStyles();
  const { c } = useTheme();
  const { top, tabBottom } = useChromeInsets();
  const dataVersion = useShambaStore((s) => s.dataVersion);
  const voiceLanguage = useShambaStore((s) => s.voiceLanguage);

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const ctxRef = useRef<ChatContext | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recordingRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      ctxRef.current = await loadChatContext();
    } catch {}
    return ctxRef.current;
  }, []);

  // Fresh local data whenever scans/tasks change, and a greeting on first load.
  useEffect(() => {
    refresh().then((ctx) => {
      if (!ctx) return;
      setMessages((m) => (m.length ? m : [{ id: ++msgSeq, from: 'bot', text: '', answer: answerQuestion('hello', ctx) }]));
    });
  }, [dataVersion, refresh]);
  useFocusEffect(
    useCallback(() => {
      refresh();
      return () => {
        stopAll();
        setSpeakingId(null);
      };
    }, [refresh]),
  );

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  /** Speaks one answer — the voice-pack clip for a disease when her language isn't English, else the text. */
  const speak = useCallback(
    async (msg: Message) => {
      if (speakingId === msg.id) {
        stopAll();
        setSpeakingId(null);
        return;
      }
      const a = msg.answer;
      if (!a) return;
      setSpeakingId(msg.id);
      const onDone = () => setSpeakingId((id) => (id === msg.id ? null : id));
      if (a.diseaseId && voiceLanguage !== 'en') await playAdvisory(a.diseaseId, { onDone });
      else await speakText(a.text, { onDone });
    },
    [speakingId, voiceLanguage],
  );

  const ask = useCallback(
    async (question: string, opts: { speak?: boolean } = {}) => {
      const q = question.trim();
      if (!q) return;
      const ctx = ctxRef.current ?? (await refresh());
      const answer: ChatAnswer = ctx
        ? answerQuestion(q, ctx)
        : { intent: 'unknown', tone: 'unsure', text: 'Sorry, I could not read the farm data on this phone. Please try again.' };
      const bot: Message = { id: ++msgSeq, from: 'bot', text: '', answer };
      setMessages((m) => [...m, { id: ++msgSeq, from: 'me', text: q }, bot]);
      setDraft('');
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      // Asked by tapping a picture or by voice → answer out loud.
      if (opts.speak) speak(bot);
    },
    [refresh, speak],
  );

  async function micIn() {
    if (!(await requestMicPermission())) return;
    try {
      stopAll();
      await startRecording(recorder);
      recordingRef.current = true;
      setRecording(true);
    } catch {}
  }

  async function micOut() {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    setTranscribing(true);
    try {
      const lang = getPackInfo(voiceLanguage)?.sttLanguage ?? DEFAULT_LANGUAGE;
      const result = await stopAndTranscribe(recorder, lang);
      if (result.text) return ask(result.text, { speak: true });
      const sorry: Message = {
        id: ++msgSeq,
        from: 'bot',
        text: '',
        answer: {
          intent: 'help',
          tone: 'unsure',
          text: 'I could not hear the question. Voice questions need internet. You can tap one of the picture buttons instead, or type.',
        },
      };
      setMessages((m) => [...m, sorry]);
      speak(sorry);
    } finally {
      setTranscribing(false);
    }
  }

  const lastAnswer = [...messages].reverse().find((m) => m.answer)?.answer;
  const barBottom = keyboard ? 8 : tabBottom + TAB_BAR_HEIGHT + 10;

  return (
    <ScreenTransition background={c.groundGrouped}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.headerRow, { paddingTop: top + 8 }]}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Ask</Text>
            <Text style={styles.subtitle}>Answers from your phone · no internet needed</Text>
          </View>
          <ReadAloudButton
            text={() =>
              'Ask a question about your coffee. Tap a picture button at the bottom, or hold the microphone and speak. ' +
              (lastAnswer ? `Last answer: ${lastAnswer.text}` : '')
            }
          />
        </View>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 && <ActivityIndicator color={c.labelSecondary} style={{ marginTop: 40 }} />}
          {messages.map((m) =>
            m.from === 'me' ? (
              <Animated.View key={m.id} entering={FadeInUp.duration(220)} style={styles.meBubble}>
                <Text style={styles.meText}>{m.text}</Text>
              </Animated.View>
            ) : (
              <BotBubble key={m.id} msg={m} speaking={speakingId === m.id} onSpeak={() => speak(m)} />
            ),
          )}
        </ScrollView>

        <View style={[styles.bottom, { paddingBottom: barBottom }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {STARTER_QUESTIONS.map((q) => (
              <PressableScale key={q.key} onPress={() => ask(q.text, { speak: true })} style={styles.chip} accessibilityRole="button" accessibilityLabel={q.text}>
                <Ionicons name={CHIP_ICON[q.icon].name} size={22} color={CHIP_ICON[q.icon].color} />
                <Text style={styles.chipText}>{q.text}</Text>
              </PressableScale>
            ))}
          </ScrollView>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Type a question…"
              placeholderTextColor={c.labelTertiary}
              returnKeyType="send"
              onSubmitEditing={() => ask(draft)}
              accessibilityLabel="Question"
            />
            {draft.trim() ? (
              <PressableScale onPress={() => ask(draft)} style={styles.roundBtn} accessibilityRole="button" accessibilityLabel="Send question">
                <Ionicons name="arrow-up" size={24} color="#FFFFFF" />
              </PressableScale>
            ) : (
              <PressableScale
                onPressIn={micIn}
                onPressOut={micOut}
                style={[styles.roundBtn, recording && styles.recording]}
                accessibilityRole="button"
                accessibilityLabel="Hold to ask by voice"
              >
                {transcribing ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name={recording ? 'radio-button-on' : 'mic'} size={24} color="#FFFFFF" />}
              </PressableScale>
            )}
          </View>
          {recording && <Text style={styles.hint}>Listening… let go when you finish</Text>}
        </View>
      </KeyboardAvoidingView>
    </ScreenTransition>
  );
}

function BotBubble({ msg, speaking, onSpeak }: { msg: Message; speaking: boolean; onSpeak: () => void }) {
  const styles = useStyles();
  const a = msg.answer!;
  const tone = TONE[a.tone];
  return (
    <Animated.View entering={FadeInDown.duration(260)} style={styles.botBubble}>
      <View style={styles.botHead}>
        <Ionicons name={tone.icon} size={22} color={tone.color} accessibilityLabel={tone.word} />
        <Text style={styles.botText}>{a.text}</Text>
      </View>
      <View style={styles.botActions}>
        <PressableScale onPress={onSpeak} style={[styles.speakBtn, speaking && styles.speakBtnOn]} accessibilityRole="button" accessibilityLabel={speaking ? 'Stop' : 'Listen to this answer'}>
          <Animated.View key={speaking ? 'stop' : 'play'} entering={ZoomIn.springify().damping(14).stiffness(320)} exiting={ZoomOut.duration(100)}>
            {speaking ? <Pause size={18} color="#FFFFFF" /> : <Speaker size={22} color={colors.primary} />}
          </Animated.View>
          <Text style={[styles.speakText, speaking && { color: '#FFFFFF' }]}>{speaking ? 'Stop' : 'Listen'}</Text>
        </PressableScale>
        {a.link && (
          <PressableScale onPress={() => router.push(a.link!.href as Href)} style={styles.linkBtn} accessibilityRole="button">
            <Text style={styles.linkText}>{a.link.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </PressableScale>
        )}
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((c) => ({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, paddingBottom: 8 },
  header: { gap: 2, flexShrink: 1 },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: -0.7, lineHeight: 40, color: c.label },
  subtitle: { fontSize: 15, fontWeight: '500', color: c.labelSecondary },

  messages: { paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  meBubble: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: colors.primary, borderRadius: 22, borderBottomRightRadius: 6, paddingHorizontal: 16, paddingVertical: 11 },
  meText: { fontSize: 17, lineHeight: 23, color: '#FFFFFF' },
  botBubble: { alignSelf: 'flex-start', maxWidth: '94%', backgroundColor: c.card, borderRadius: 22, borderBottomLeftRadius: 6, padding: 14, gap: 10 },
  botHead: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  botText: { flex: 1, fontSize: 17, lineHeight: 24, color: c.label },
  botActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingLeft: 32 },
  speakBtn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 22, backgroundColor: c.fill },
  speakBtnOn: { backgroundColor: colors.primary },
  speakText: { fontSize: 15, fontWeight: '600', color: c.accentText },
  linkBtn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1.5, borderColor: c.separator },
  linkText: { fontSize: 15, fontWeight: '600', color: c.accentText },

  bottom: { gap: 8, paddingTop: 8, backgroundColor: c.groundGrouped },
  chips: { paddingHorizontal: 16, gap: 8 },
  chip: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 24, backgroundColor: c.card },
  chipText: { fontSize: 15, fontWeight: '600', color: c.label },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  input: { flex: 1, minHeight: 52, borderRadius: 26, paddingHorizontal: 18, fontSize: 17, color: c.label, backgroundColor: c.card },
  roundBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  recording: { backgroundColor: '#D70015' },
  hint: { fontSize: 14, textAlign: 'center', color: c.labelSecondary },
}));
