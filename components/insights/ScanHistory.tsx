/**
 * Scan history with the photo behind every result. Tap a scan to see the
 * image, which tree it's tagged to (or that it's untagged in its block),
 * roughly where it was taken, and to tag it, untag it, or delete it as a
 * false positive. Deleted scans drop out of every insight.
 */

import React, { useState } from 'react';
import { Alert, Modal, ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown, LinearTransition, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { SvgXml } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PressableScale from '../glass/PressableScale';
import { Close, Leaf, Trash } from '../glass/Icons';
import TagPicker from './TagPicker';
import TileMap, { MapMarker } from '../map/TileMap';
import { Pin } from '../map/MapParts';
import { deleteIssue, IssueRecord, PlantRecord } from '../../lib/db';
import { DEMO_PHOTO, deletePhotoFile } from '../../lib/photos';
import { plantLabel, untagScan } from '../../lib/plants';
import { colors, makeStyles, sentenceCase, severityPin, useTheme } from '../../lib/theme';
import { useShambaStore } from '../../lib/store';
import { DEMO_LEAF_SVG } from '../../assets/demo/leafPhoto';

export function ScanPhoto({ uri, size, radius = 12 }: { uri: string | null; size: number | { width: number | `${number}%`; height: number }; radius?: number }) {
  const { c } = useTheme();
  const box = typeof size === 'number' ? { width: size, height: size } : size;
  if (!uri) {
    return (
      <View style={[box, { borderRadius: radius, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ fontSize: 11, color: c.labelTertiary, textAlign: 'center' }}>no photo</Text>
      </View>
    );
  }
  if (uri === DEMO_PHOTO && typeof size === 'number' && size < 120) {
    // Cheap stand-in for list rows (the full illustration has blur filters).
    return (
      <View style={[box, { borderRadius: radius, backgroundColor: '#2f4f2c', alignItems: 'center', justifyContent: 'center' }]}>
        <Leaf size={size * 0.55} color="#E8A33D" />
      </View>
    );
  }
  if (uri === DEMO_PHOTO) {
    return (
      <View style={[box, { borderRadius: radius, overflow: 'hidden' }]}>
        <SvgXml xml={DEMO_LEAF_SVG} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" />
      </View>
    );
  }
  return <Image source={{ uri }} style={[box, { borderRadius: radius }]} contentFit="cover" transition={200} />;
}

const fmt = (t: number) =>
  new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
  ' · ' +
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export function ScanList({ scans, trees, limit = 30 }: { scans: IssueRecord[]; trees: PlantRecord[]; limit?: number }) {
  const styles = useStyles();
  const [open, setOpen] = useState<IssueRecord | null>(null);
  const treeById = new Map(trees.map((t) => [t.id, t]));
  const newest = [...scans].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);

  if (!newest.length) return <Text style={styles.empty}>No scans yet. Log a scan from the camera to start this history.</Text>;

  return (
    <View style={styles.group}>
      {newest.map((s, i) => {
        const tree = s.plantId != null ? treeById.get(s.plantId) : undefined;
        return (
          <Animated.View key={s.id} layout={LinearTransition.springify().damping(24)} entering={FadeIn.duration(220)}>
            {i > 0 && <View style={[styles.separator, { marginLeft: 84 }]} />}
            <PressableScale pressedScale={0.98} onPress={() => setOpen(s)} style={styles.row} accessibilityRole="button" accessibilityLabel={`${s.diseaseName}, ${fmt(s.timestamp)}`}>
              <ScanPhoto uri={s.photoUri} size={56} />
              <View style={styles.rowText}>
                <View style={styles.rowTitle}>
                  <View style={[styles.dot, { backgroundColor: severityPin[s.severity] ?? severityPin.unknown }]} />
                  <Text style={styles.name} numberOfLines={1}>{sentenceCase(s.diseaseName)}</Text>
                </View>
                <Text style={styles.meta}>{fmt(s.timestamp)}</Text>
                <Text style={[styles.tag, !s.plantId && styles.untagged]}>
                  {s.plantId != null ? (tree ? plantLabel(tree) : 'Tagged') : `Untagged · Block ${s.block ?? '–'}`}
                </Text>
              </View>
            </PressableScale>
          </Animated.View>
        );
      })}
      <ScanViewer key={open?.id ?? 'none'} scan={open} trees={trees} onClose={() => setOpen(null)} />
    </View>
  );
}

function ScanViewer({ scan, trees, onClose }: { scan: IssueRecord | null; trees: PlantRecord[]; onClose: () => void }) {
  const styles = useStyles();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const bumpData = useShambaStore((s) => s.bumpData);
  const [taggedAs, setTaggedAs] = useState<string | null>(null);
  const [currentPlantId, setCurrentPlantId] = useState<number | null>(scan?.plantId ?? null);
  if (!scan) return null;

  const tree = scan.plantId != null ? trees.find((t) => t.id === scan.plantId) : undefined;
  const hasFix = scan.lat !== 0 || scan.lng !== 0;

  function confirmDelete() {
    Alert.alert('Delete this scan?', 'Use this for wrong results (false positives). It will no longer count in health or insights.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const photo = await deleteIssue(scan!.id);
            deletePhotoFile(photo);
            bumpData();
            onClose();
          } catch {
            Alert.alert('Could not delete', 'Please try again.');
          }
        },
      },
    ]);
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View entering={FadeIn.duration(180)} style={styles.backdrop}>
          <PressableScale style={{ flex: 1 }} pressedScale={1} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View entering={SlideInDown.springify().damping(22).stiffness(200)} exiting={SlideOutDown.duration(200)} style={[styles.viewer, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.viewerHead}>
            <Text style={styles.viewerTitle}>{sentenceCase(scan.diseaseName)}</Text>
            <PressableScale onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <Close size={16} color={c.labelStrong} />
            </PressableScale>
          </View>
          <ScrollView contentContainerStyle={{ gap: 14 }} showsVerticalScrollIndicator={false}>
            <Animated.View entering={FadeInDown.duration(260)}>
              <ScanPhoto uri={scan.photoUri} size={{ width: '100%', height: 240 }} radius={20} />
            </Animated.View>
            <Text style={styles.detail}>
              {Math.round(scan.confidence * 100)}% match · {fmt(scan.timestamp)}
              {scan.notes ? `\n“${scan.notes}”` : ''}
            </Text>

            <View style={styles.whereRow}>
              <Text style={styles.whereText}>
                {taggedAs ?? (tree ? plantLabel(tree) : 'Untagged')} · Block {scan.block ?? '–'} · {hasFix ? 'GPS logged' : 'no GPS'}
              </Text>
              {currentPlantId != null && (
                <PressableScale
                  onPress={async () => {
                    try {
                      await untagScan(scan.id);
                      setTaggedAs('Untagged');
                      setCurrentPlantId(null);
                    } catch {}
                  }}
                  style={styles.smallBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.smallBtnText}>Untag</Text>
                </PressableScale>
              )}
            </View>

            {hasFix && (
              <View style={styles.miniMap} pointerEvents="none">
                <TileMap center={{ lat: scan.lat, lng: scan.lng }} zoom={18}>
                  {(ctx) => (
                    <MapMarker ctx={ctx} lat={scan.lat} lng={scan.lng}>
                      <Pin severity={scan.severity} selected index={0} />
                    </MapMarker>
                  )}
                </TileMap>
              </View>
            )}

            <Text style={styles.sectionLabel}>{currentPlantId != null ? 'Move to another tree' : 'Tag to a tree'}</Text>
            <TagPicker
              issueId={scan.id}
              block={scan.block}
              lat={scan.lat}
              lng={scan.lng}
              currentPlantId={currentPlantId}
              onTagged={(label, plantId) => {
                setTaggedAs(label);
                setCurrentPlantId(plantId);
              }}
            />

            <PressableScale onPress={confirmDelete} style={styles.deleteBtn} accessibilityRole="button" accessibilityLabel="Delete this scan as a false positive">
              <Trash color="#D70015" />
              <Text style={styles.deleteText}>Delete — wrong result</Text>
            </PressableScale>
          </ScrollView>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  group: { borderRadius: 26, backgroundColor: c.card, overflow: 'hidden' },
  separator: { height: 1, backgroundColor: c.separator },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, paddingRight: 16, minHeight: 80 },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  name: { flex: 1, fontSize: 16, fontWeight: '600', color: c.label },
  meta: { fontSize: 13, color: c.labelTertiary },
  tag: { fontSize: 13, fontWeight: '600', color: c.accentText },
  untagged: { color: c.labelSecondary },
  empty: { fontSize: 15, color: c.labelSecondary, paddingHorizontal: 4 },
  backdrop: { ...({ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } as const), backgroundColor: 'rgba(0,0,0,0.45)' },
  viewer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '92%',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: c.groundGrouped,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  viewerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  viewerTitle: { fontSize: 24, fontWeight: '700', color: c.label, flex: 1 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill },
  detail: { fontSize: 15, lineHeight: 21, color: c.labelSecondary },
  whereRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  whereText: { flex: 1, fontSize: 15, fontWeight: '600', color: c.label },
  smallBtn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.fill, justifyContent: 'center' },
  smallBtnText: { fontSize: 14, fontWeight: '600', color: c.label },
  miniMap: { height: 150, borderRadius: 20, overflow: 'hidden', backgroundColor: c.groundMap },
  sectionLabel: { fontSize: 15, fontWeight: '700', color: c.label, marginTop: 4 },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 50, borderRadius: 16, backgroundColor: 'rgba(215,0,21,0.1)', marginTop: 6 },
  deleteText: { fontSize: 16, fontWeight: '700', color: '#D70015' },
}));
