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
  StyleSheet,
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
import type { Audio } from 'expo-av';

interface SpeechInputProps {
  onTranscript: (text: string) => void;
  placeholder?: string;
}

export default function SpeechInput({ onTranscript, placeholder = 'Describe what you see…' }: SpeechInputProps) {
  const [language, setLanguage] = useState(DEFAULT_LANGUAGE);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [text, setText] = useState('');
  const [showLangPicker, setShowLangPicker] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);

  const handlePressIn = useCallback(async () => {
    const granted = await requestMicPermission();
    if (!granted) return;
    try {
      recordingRef.current = await startRecording();
      setIsRecording(true);
    } catch {
      /* silently fall back to text */
    }
  }, []);

  const handlePressOut = useCallback(async () => {
    if (!recordingRef.current) return;
    setIsRecording(false);
    setIsTranscribing(true);
    try {
      const result = await stopAndTranscribe(recordingRef.current, language);
      recordingRef.current = null;
      if (result.text) {
        setText(result.text);
        onTranscript(result.text);
      }
    } finally {
      setIsTranscribing(false);
    }
  }, [language, onTranscript]);

  const handleTextSubmit = useCallback(() => {
    if (text.trim()) onTranscript(text.trim());
  }, [text, onTranscript]);

  return (
    <View style={styles.container}>
      {/* Language selector */}
      <Pressable style={styles.langButton} onPress={() => setShowLangPicker(true)}>
        <Ionicons name="globe-outline" size={14} color="#2D6A4F" />
        <Text style={styles.langLabel}>{SUPPORTED_LANGUAGES[language] ?? language}</Text>
        <Ionicons name="chevron-down" size={12} color="#2D6A4F" />
      </Pressable>

      {/* Text input row */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.textInput}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          multiline
          onSubmitEditing={handleTextSubmit}
        />
        {/* Mic button */}
        <Pressable
          style={[styles.micButton, isRecording && styles.micButtonActive]}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          {isTranscribing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons
              name={isRecording ? 'radio-button-on' : 'mic'}
              size={20}
              color="#fff"
            />
          )}
        </Pressable>
      </View>

      {isRecording && (
        <Text style={styles.hint}>Recording… release to transcribe</Text>
      )}

      {/* Language picker modal */}
      <Modal visible={showLangPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Select language</Text>
            <ScrollView>
              {Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => (
                <Pressable
                  key={code}
                  style={[styles.langOption, code === language && styles.langOptionSelected]}
                  onPress={() => { setLanguage(code); setShowLangPicker(false); }}
                >
                  <Text style={[styles.langOptionText, code === language && styles.langOptionTextSelected]}>
                    {name}
                  </Text>
                  {code === language && <Ionicons name="checkmark" size={16} color="#2D6A4F" />}
                </Pressable>
              ))}
            </ScrollView>
            <Pressable style={styles.modalClose} onPress={() => setShowLangPicker(false)}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  langButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  langLabel: { fontSize: 12, color: '#2D6A4F', fontWeight: '500' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  textInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#F9FAFB',
  },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#2D6A4F',
    justifyContent: 'center',
    alignItems: 'center',
  },
  micButtonActive: { backgroundColor: '#DC2626' },
  hint: { fontSize: 11, color: '#6B7280', textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '75%',
  },
  modalTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12, color: '#111827' },
  langOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  langOptionSelected: { backgroundColor: '#F0FDF4' },
  langOptionText: { fontSize: 14, color: '#374151' },
  langOptionTextSelected: { color: '#2D6A4F', fontWeight: '600' },
  modalClose: {
    marginTop: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
  },
  modalCloseText: { fontSize: 14, color: '#374151', fontWeight: '500' },
});
