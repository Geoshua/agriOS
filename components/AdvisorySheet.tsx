import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Modal, Animated, Dimensions, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { logIssue } from '../lib/db';
import { useShambaStore } from '../lib/store';
// Use AudioPlayerFallback (expo-speech, offline) until MP3s are generated.
// Switch to './AudioPlayer' once ELEVENLABS_API_KEY clips are in assets/audio/.
import { playAdvisory, stopAll } from './AudioPlayerFallback';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.65;

interface Props {
  disease: any;
  confidence: number;
  open: boolean;
  onClose: () => void;
}

const SEVERITY_LABEL: Record<string, string> = {
  high: 'Act within 3 days',
  medium: 'Act within a week',
  low: 'Monitor closely',
  none: 'All good',
  unknown: 'Needs expert check',
};

export default function AdvisorySheet({ disease, confidence, open, onClose }: Props) {
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const { addIssue, currentDetection } = useShambaStore();
  const [logged, setLogged] = React.useState(false);
  const [logging, setLogging] = React.useState(false);

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: open ? 0 : SHEET_HEIGHT,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
    if (open && disease) {
      playAdvisory(disease.id);
    } else if (!open) {
      stopAll();
      setLogged(false);
    }
  }, [open, disease?.id ?? '']);

  async function handleLog() {
    if (!disease || logging || logged) return;
    setLogging(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      const loc = status === 'granted'
        ? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        : null;

      const id = await logIssue({
        diseaseId: disease.id,
        diseaseName: disease.name,
        severity: disease.severity,
        confidence,
        lat: loc?.coords.latitude ?? 0,
        lng: loc?.coords.longitude ?? 0,
        photoUri: null,
        timestamp: Date.now(),
        notes: null,
      });

      addIssue({
        id,
        diseaseId: disease.id,
        diseaseName: disease.name,
        severity: disease.severity,
        confidence,
        lat: loc?.coords.latitude ?? 0,
        lng: loc?.coords.longitude ?? 0,
        photoUri: null,
        timestamp: Date.now(),
        notes: null,
      });

      setLogged(true);
    } finally {
      setLogging(false);
    }
  }

  if (!disease) return null;

  const urgencyColor = {
    high: '#E53E3E',
    medium: '#DD6B20',
    low: '#D69E2E',
    none: '#38A169',
    unknown: '#718096',
  }[disease.severity] ?? '#718096';

  return (
    <Modal transparent visible={open} animationType="none" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        {/* Handle bar */}
        <View style={styles.handle} />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.severityBadge, { backgroundColor: urgencyColor + '20' }]}>
              <Text style={[styles.severityText, { color: urgencyColor }]}>
                {SEVERITY_LABEL[disease.severity]}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Disease name */}
          <Text style={styles.diseaseName}>{disease.name}</Text>
          {disease.scientificName && (
            <Text style={styles.scientificName}>{disease.scientificName}</Text>
          )}
          <Text style={styles.confidence}>{Math.round(confidence * 100)}% confidence</Text>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>What it is</Text>
            <Text style={styles.sectionBody}>{disease.description}</Text>
          </View>

          {/* Immediate action */}
          <View style={[styles.section, styles.actionSection]}>
            <Text style={styles.sectionLabel}>Do this now</Text>
            <Text style={styles.sectionBody}>{disease.immediateAction}</Text>
          </View>

          {/* Treatment */}
          {disease.treatment && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Treatment</Text>
              <Text style={styles.sectionBody}>{disease.treatment}</Text>
            </View>
          )}

          {/* Yield impact */}
          {disease.yieldImpact && (
            <View style={styles.yieldWarning}>
              <Ionicons name="trending-down" size={16} color="#E53E3E" />
              <Text style={styles.yieldText}>{disease.yieldImpact}</Text>
            </View>
          )}

          {/* Unknown / low confidence disclaimer */}
          {disease.id === 'unknown' && (
            <View style={styles.expertNote}>
              <Ionicons name="person" size={16} color="#4B5563" />
              <Text style={styles.expertText}>Contact your extension officer for a confirmed diagnosis before applying any treatment.</Text>
            </View>
          )}

          {/* Replay audio */}
          <TouchableOpacity
            style={styles.audioButton}
            onPress={() => disease && playAdvisory(disease.id)}
          >
            <Ionicons name="volume-high-outline" size={18} color="#2D6A4F" />
            <Text style={styles.audioButtonText}>Play advice again</Text>
          </TouchableOpacity>

          {/* Log button */}
          <TouchableOpacity
            style={[styles.logButton, logged && styles.logButtonDone, logging && styles.logButtonLoading]}
            onPress={handleLog}
            disabled={logged || logging}
          >
            <Ionicons name={logged ? 'checkmark-circle' : 'location'} size={20} color="#fff" />
            <Text style={styles.logButtonText}>
              {logged ? 'Logged to field map' : logging ? 'Saving...' : 'Log this issue to map'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    ...Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20 }, android: { elevation: 10 } }),
  },
  handle: { width: 40, height: 4, backgroundColor: '#E5E7EB', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  content: { paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  severityBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20 },
  severityText: { fontSize: 13, fontWeight: '600' },
  closeBtn: { padding: 4 },
  diseaseName: { fontSize: 26, fontWeight: '700', color: '#111827', lineHeight: 32 },
  scientificName: { fontSize: 14, color: '#6B7280', fontStyle: 'italic', marginTop: 2 },
  confidence: { fontSize: 13, color: '#9CA3AF', marginTop: 4, marginBottom: 20 },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  sectionBody: { fontSize: 16, color: '#374151', lineHeight: 24 },
  actionSection: { backgroundColor: '#F0FDF4', borderRadius: 12, padding: 14 },
  yieldWarning: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginBottom: 16 },
  yieldText: { fontSize: 14, color: '#991B1B', flex: 1 },
  expertNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#F3F4F6', borderRadius: 10, padding: 12, marginBottom: 16 },
  expertText: { fontSize: 14, color: '#374151', flex: 1, lineHeight: 20 },
  audioButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, marginTop: 4, marginBottom: 4 },
  audioButtonText: { fontSize: 14, color: '#2D6A4F', fontWeight: '500' },
  logButton: { backgroundColor: '#2D6A4F', borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16, marginTop: 8 },
  logButtonDone: { backgroundColor: '#38A169' },
  logButtonLoading: { opacity: 0.7 },
  logButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
