/**
 * SpeechInput — press-and-hold voice recording with language picker.
 *
 * Calls onTranscript(text) when a recording is successfully transcribed.
 * Shows a fallback text input when offline or HF key is not set.
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  startRecording,
  stopAndTranscribe,
  requestMicPermission,
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
} from '../lib/stt';
import { RecordingPresets, useAudioRecorder } from 'expo-audio';
import { colors, makeStyles, status, useTheme } from '../lib/theme';
import { useShambaStore } from '../lib/store';
import { getPackInfo } from '../lib/voicePacks';
import PressableScale from './glass/PressableScale';
import { Check } from './glass/Icons';

interface SpeechInputProps {
  onTranscript: (text: string) => void;
  placeholder?: string;
}

export default function SpeechInput({ onTranscript, placeholder = 'Describe what you see…' }: SpeechInputProps) {
  // Start in the recognition language that matches the chosen voice pack (Kikuyu → Swahili).
  const voiceLanguage = useShambaStore((s) => s.voiceLanguage);
  const [language, setLanguage] = useState(() => getPackInfo(voiceLanguage)?.sttLanguage ?? DEFAULT_LANGUAGE);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [text, setText] = useState('');
  const [showLangPicker, setShowLangPicker] = useState(false);
  const { c } = useTheme();
  const styles = useStyles();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recordingRef = useRef(false);

  const handlePressIn = useCallback(async () => {
    const granted = await requestMicPermission();
    if (!granted) return;
    try {
      await startRecording(recorder);
      recordingRef.current = true;
      setIsRecording(true);
    } catch {
      /* silently fall back to text */
    }
  }, [recorder]);

  const handlePressOut = useCallback(async () => {
    if (!recordingRef.current) return;
    setIsRecording(false);
    setIsTranscribing(true);
    try {
      recordingRef.current = false;
      const result = await stopAndTranscribe(recorder, language);
      if (result.text) {
        setText(result.text);
        onTranscript(result.text);
      }
    } finally {
      setIsTranscribing(false);
    }
  }, [recorder, language, onTranscript]);

  const handleTextSubmit = useCallback(() => {
    if (text.trim()) onTranscript(text.trim());
  }, [text, onTranscript]);

  return (
    <View style={styles.container}>
      {/* Language selector */}
      <PressableScale style={styles.langButton} onPress={() => setShowLangPicker(true)} accessibilityRole="button" accessibilityLabel="Voice note language">
        <Ionicons name="globe-outline" size={14} color={colors.emeraldBright} />
        <Text style={styles.langLabel}>{SUPPORTED_LANGUAGES[language] ?? language}</Text>
        <Ionicons name="chevron-down" size={12} color={colors.emeraldBright} />
      </PressableScale>

      {/* Text input row */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.textInput}
          value={text}
          onChangeText={(t) => {
            setText(t);
            onTranscript(t);
          }}
          placeholder={placeholder}
          placeholderTextColor={c.labelTertiary}
          multiline
          onSubmitEditing={handleTextSubmit}
        />
        {/* Mic button — press and hold */}
        <Pressable
          style={[styles.micButton, isRecording && styles.micButtonActive]}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          accessibilityRole="button"
          accessibilityLabel="Hold to record a voice note"
        >
          {isTranscribing ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Ionicons
              name={isRecording ? 'radio-button-on' : 'mic'}
              size={22}
              color={colors.onPrimary}
            />
          )}
        </Pressable>
      </View>

      {isRecording && (
        <Text style={styles.hint}>Recording… release to transcribe</Text>
      )}

      {/* Language picker modal */}
      <Modal visible={showLangPicker} transparent animationType="slide" onRequestClose={() => setShowLangPicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.grabber} />
            <Text style={styles.modalTitle}>Select language</Text>
            <ScrollView>
              {Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => (
                <Pressable
                  key={code}
                  style={[styles.langOption, code === language && styles.langOptionSelected]}
                  onPress={() => { setLanguage(code); setShowLangPicker(false); }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: code === language }}
                >
                  <Text style={[styles.langOptionText, code === language && styles.langOptionTextSelected]}>
                    {name}
                  </Text>
                  {code === language && <Check size={18} color={colors.emeraldBright} />}
                </Pressable>
              ))}
            </ScrollView>
            <PressableScale style={styles.modalClose} onPress={() => setShowLangPicker(false)} accessibilityRole="button">
              <Text style={styles.modalCloseText}>Cancel</Text>
            </PressableScale>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  container: { gap: 8 },
  langButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    minHeight: 32,
    paddingHorizontal: 10,
    backgroundColor: colors.emeraldTint,
    borderRadius: 16,
  },
  langLabel: { fontSize: 13, color: colors.emeraldBright, fontWeight: '700' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  textInput: {
    flex: 1,
    minHeight: 48,
    maxHeight: 110,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: c.label,
    backgroundColor: c.cardRaised,
    borderWidth: 1,
    borderColor: c.separator,
  },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  micButtonActive: { backgroundColor: status.danger },
  hint: { fontSize: 12, color: c.labelTertiary, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: c.card,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 20,
    paddingTop: 10,
    maxHeight: '75%',
    gap: 8,
  },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: c.fillStrong, marginBottom: 6 },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 6, color: c.label },
  langOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  langOptionSelected: { backgroundColor: colors.emeraldTint },
  langOptionText: { fontSize: 16, color: c.label },
  langOptionTextSelected: { color: colors.emeraldBright, fontWeight: '700' },
  modalClose: {
    marginTop: 8,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.fill,
    borderRadius: 25,
  },
  modalCloseText: { fontSize: 16, color: c.label, fontWeight: '700' },
}));
