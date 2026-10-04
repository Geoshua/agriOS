import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import Constants from 'expo-constants';
import ScreenTransition from '../../components/glass/ScreenTransition';
import PressableScale from '../../components/glass/PressableScale';
import { Check, Download, Pause, Speaker, Trash } from '../../components/glass/Icons';
import { colors, makeStyles, spring, timing, useTheme } from '../../lib/theme';
import { useChromeInsets } from '../../lib/layout';
import ReadAloudButton from '../../components/ReadAloudButton';
import { useShambaStore } from '../../lib/store';
import { saveSettings } from '../../lib/settings';
import { playAdvisory, stopAll } from '../../lib/voice';
import {
  downloadPack,
  formatSize,
  getInstalledManifest,
  PackManifest,
  removePack,
  VOICE_PACKS,
  VoicePackInfo,
} from '../../lib/voicePacks';

const VOICE_SOURCE: Record<string, string> = { elevenlabs: 'ElevenLabs voice', mms: 'Meta MMS voice' };

const layoutTransition = LinearTransition.springify().damping(24).stiffness(240);
const enter = (i: number) => FadeInDown.duration(360).delay(60 + i * 60);

type PackState =
  | { kind: 'missing' }
  | { kind: 'downloading'; done: number; total: number; source: 'hub' | 'internet' | null }
  | { kind: 'installed'; manifest: PackManifest };

export default function SettingsScreen() {
  const { top, tabClearance } = useChromeInsets();
  const { c } = useTheme();
  const styles = useStyles();
  const voiceLanguage = useShambaStore((s) => s.voiceLanguage);
  const setVoiceLanguage = useShambaStore((s) => s.setVoiceLanguage);
  const packsVersion = useShambaStore((s) => s.voicePacksVersion);
  const bumpPacks = useShambaStore((s) => s.bumpVoicePacks);

  const [states, setStates] = useState<Record<string, PackState>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [previewing, setPreviewing] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next: Record<string, PackState> = {};
    for (const pack of VOICE_PACKS) {
      const manifest = await getInstalledManifest(pack.code);
      next[pack.code] = manifest ? { kind: 'installed', manifest } : { kind: 'missing' };
    }
    setStates((prev) => {
      // Keep in-flight downloads as they are.
      for (const code of Object.keys(prev)) if (prev[code].kind === 'downloading') next[code] = prev[code];
      return next;
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, packsVersion]);

  useEffect(() => () => {
    stopAll();
  }, []);

  function select(code: string) {
    setVoiceLanguage(code);
    saveSettings({ voiceLanguage: code });
  }

  async function download(pack: VoicePackInfo) {
    setErrors((e) => ({ ...e, [pack.code]: null }));
    setStates((s) => ({ ...s, [pack.code]: { kind: 'downloading', done: 0, total: 0, source: null } }));
    try {
      const manifest = await downloadPack(pack.code, ({ done, total, source }) =>
        setStates((s) => ({ ...s, [pack.code]: { kind: 'downloading', done, total, source } })),
      );
      setStates((s) => ({ ...s, [pack.code]: { kind: 'installed', manifest } }));
      bumpPacks();
    } catch (e) {
      setStates((s) => ({ ...s, [pack.code]: { kind: 'missing' } }));
      setErrors((err) => ({ ...err, [pack.code]: friendlyError(e) }));
    }
  }

  function remove(pack: VoicePackInfo) {
    if (previewing === pack.code) stopPreview();
    removePack(pack.code);
    setStates((s) => ({ ...s, [pack.code]: { kind: 'missing' } }));
    bumpPacks();
  }

  async function preview(pack: VoicePackInfo) {
    if (previewing === pack.code) return stopPreview();
    setPreviewing(pack.code);
    await playAdvisory('coffee_leaf_rust', { onDone: () => setPreviewing((p) => (p === pack.code ? null : p)) }, pack.code);
  }

  function stopPreview() {
    stopAll();
    setPreviewing(null);
  }

  const selected = VOICE_PACKS.find((p) => p.code === voiceLanguage);
  const selectedMissing = selected && states[selected.code]?.kind !== 'installed';

  return (
    <ScreenTransition background={c.groundGrouped}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: top + 4, paddingBottom: tabClearance + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enter(0)} style={styles.headerRow}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Settings</Text>
            <Text style={styles.subtitle}>Everything here works without internet.</Text>
          </View>
          <ReadAloudButton
            text={() => {
              const installed = VOICE_PACKS.filter((p) => states[p.code]?.kind === 'installed').map((p) => p.name);
              return (
                `Settings. Here you choose the language for spoken advice. Now it is ${selected?.name ?? voiceLanguage}. ` +
                (installed.length ? `Downloaded: ${installed.join(' and ')}. ` : 'No language is downloaded yet. ') +
                'Tap a language to choose it. Tap the arrow to download it once, near the co-op hub. Then it works with no signal.'
              );
            }}
          />
        </Animated.View>

        <Animated.View entering={enter(1)} layout={layoutTransition} style={styles.section}>
          <Text style={styles.sectionTitle}>Voice & Language</Text>
          <Text style={styles.sectionHint}>
            Advice is spoken in your language. Download a pack once — it then plays with no signal.
          </Text>
          <View style={styles.group}>
            {VOICE_PACKS.map((pack, i) => (
              <Animated.View key={pack.code} layout={layoutTransition}>
                {i > 0 && <View style={[styles.separator, { marginLeft: 56 }]} />}
                <PackRow
                  pack={pack}
                  state={states[pack.code] ?? { kind: 'missing' }}
                  selected={voiceLanguage === pack.code}
                  previewing={previewing === pack.code}
                  error={errors[pack.code] ?? null}
                  onSelect={() => select(pack.code)}
                  onDownload={() => download(pack)}
                  onRemove={() => remove(pack)}
                  onPreview={() => preview(pack)}
                />
              </Animated.View>
            ))}
          </View>

          {selectedMissing && (
            <Animated.Text entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)} style={styles.note}>
              {selected!.deviceTts
                ? `Until the ${selected!.name} pack is downloaded, advice uses your phone's ${selected!.name} voice.`
                : `Until the ${selected!.name} pack is downloaded, advice is spoken in English — phones have no built-in ${selected!.name} voice.`}
            </Animated.Text>
          )}
          <Text style={styles.note}>
            Packs download from your co-op hub over Wi-Fi when it's in range, otherwise from the internet.
          </Text>
        </Animated.View>

        <Animated.View entering={enter(2)} layout={layoutTransition} style={styles.section}>
          <Text style={styles.sectionTitle}>About the Voices</Text>
          <View style={[styles.group, styles.aboutCard]}>
            <Text style={styles.aboutText}>
              All voices are computer-generated — each pack shows which voice made it. Meta MMS voices are under a
              research licence (non-commercial use only).
            </Text>
            <Text style={styles.aboutText}>
              The Gĩkũyũ advice is a draft translation that still needs checking by a native speaker. Voice notes in
              Gĩkũyũ are transcribed as Swahili, as speech recognition doesn't support Gĩkũyũ yet.
            </Text>
          </View>
        </Animated.View>

        <Animated.Text entering={enter(3)} style={styles.version}>
          agriOS {Constants.expoConfig?.version ?? ''}
        </Animated.Text>
      </ScrollView>
    </ScreenTransition>
  );
}

function PackRow({
  pack,
  state,
  selected,
  previewing,
  error,
  onSelect,
  onDownload,
  onRemove,
  onPreview,
}: {
  pack: VoicePackInfo;
  state: PackState;
  selected: boolean;
  previewing: boolean;
  error: string | null;
  onSelect: () => void;
  onDownload: () => void;
  onRemove: () => void;
  onPreview: () => void;
}) {
  const styles = useStyles();
  const { c } = useTheme();

  const status =
    state.kind === 'installed'
      ? `Ready offline · ${formatSize(state.manifest.totalBytes)} · ${VOICE_SOURCE[state.manifest.provider] ?? 'synthetic voice'}`
      : state.kind === 'downloading'
        ? state.total
          ? `Downloading ${state.done} of ${state.total} from ${state.source === 'hub' ? 'co-op hub' : 'internet'}…`
          : 'Connecting…'
        : `Not downloaded · about ${formatSize(pack.approxSizeKb * 1024)}`;

  return (
    <View>
      <PressableScale
        pressedScale={0.98}
        onPress={onSelect}
        style={styles.row}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${pack.name}. ${status}`}
      >
        <Radio checked={selected} />
        <View style={styles.rowText}>
          <View style={styles.nameRow}>
            <Text style={styles.packName}>{pack.nativeName}</Text>
            {pack.nativeName !== pack.name && <Text style={styles.packAlt}>{pack.name}</Text>}
            {!pack.reviewed && (
              <View style={styles.draftTag}>
                <Text style={styles.draftText}>Draft</Text>
              </View>
            )}
          </View>
          <Text style={styles.packRegion} numberOfLines={1}>{pack.region}</Text>
          <Animated.Text key={state.kind} entering={FadeIn.duration(200)} style={[styles.packStatus, state.kind === 'installed' && { color: c.gps }]}>
            {status}
          </Animated.Text>
          {state.kind === 'downloading' && <ProgressBar value={state.total ? state.done / state.total : 0} />}
        </View>

        <View style={styles.actions}>
          {state.kind === 'missing' && (
            <Animated.View key="dl" entering={ZoomIn.springify().damping(16).stiffness(280)} exiting={ZoomOut.duration(120)}>
              <PressableScale onPress={onDownload} style={styles.iconButton} accessibilityRole="button" accessibilityLabel={`Download ${pack.name} voice pack`}>
                <Download color={colors.primary} />
              </PressableScale>
            </Animated.View>
          )}
          {state.kind === 'downloading' && (
            <Animated.View key="busy" entering={ZoomIn.duration(150)} exiting={ZoomOut.duration(120)} style={styles.iconButton}>
              <ActivityIndicator color={c.labelSecondary} />
            </Animated.View>
          )}
          {state.kind === 'installed' && (
            <Animated.View key="ready" entering={ZoomIn.springify().damping(16).stiffness(280)} exiting={ZoomOut.duration(120)} style={styles.actionsRow}>
              <PressableScale onPress={onPreview} style={styles.iconButton} accessibilityRole="button" accessibilityLabel={previewing ? 'Stop sample' : `Play ${pack.name} sample`}>
                {previewing ? <Pause size={16} color={c.label} /> : <Speaker size={20} color={c.label} />}
              </PressableScale>
              <PressableScale onPress={onRemove} style={styles.iconButton} accessibilityRole="button" accessibilityLabel={`Remove ${pack.name} voice pack`}>
                <Trash color={c.labelSecondary} />
              </PressableScale>
            </Animated.View>
          )}
        </View>
      </PressableScale>

      {error && (
        <Animated.Text entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.error}>
          {error}
        </Animated.Text>
      )}
    </View>
  );
}

function Radio({ checked }: { checked: boolean }) {
  const styles = useStyles();
  const p = useSharedValue(checked ? 1 : 0);
  useEffect(() => {
    p.value = withSpring(checked ? 1 : 0, spring.pop);
  }, [checked]);
  const fill = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scale: 0.4 + 0.6 * p.value }] }));
  return (
    <View style={styles.radio}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.radioFill, fill]}>
        <Check size={14} />
      </Animated.View>
    </View>
  );
}

function ProgressBar({ value }: { value: number }) {
  const styles = useStyles();
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withTiming(value, timing.base);
  }, [value]);
  const fill = useAnimatedStyle(() => ({ width: `${Math.max(4, w.value * 100)}%` }));
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.trackFill, fill]} />
    </View>
  );
}

function friendlyError(e: unknown): string {
  const msg = (e as Error)?.message ?? '';
  if (/No download source/.test(msg)) return 'No hub or internet address is set up for downloads.';
  return "Couldn't download. Move closer to the co-op hub or find a signal, then try again.";
}

const useStyles = makeStyles((c) => ({
  content: { paddingHorizontal: 16, gap: 24 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  header: { gap: 2, paddingHorizontal: 4, flexShrink: 1 },
  title: { fontSize: 34, fontWeight: '700', letterSpacing: -0.7, lineHeight: 40, color: c.label },
  subtitle: { fontSize: 16, color: c.labelSecondary },
  section: { gap: 8 },
  sectionTitle: { fontSize: 20, fontWeight: '700', paddingHorizontal: 4, color: c.label },
  sectionHint: { fontSize: 15, lineHeight: 21, paddingHorizontal: 4, color: c.labelSecondary },
  group: { borderRadius: 26, backgroundColor: c.card, overflow: 'hidden' },
  separator: { height: 1, backgroundColor: c.separator },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingLeft: 16, paddingRight: 8, minHeight: 72 },
  rowText: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  packName: { fontSize: 17, fontWeight: '600', color: c.label },
  packAlt: { fontSize: 15, color: c.labelSecondary },
  draftTag: { alignSelf: 'center', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, backgroundColor: 'rgba(255,159,10,0.18)' },
  draftText: { fontSize: 12, fontWeight: '700', color: '#B25E00' },
  packRegion: { fontSize: 13, color: c.labelTertiary },
  packStatus: { fontSize: 13, fontWeight: '600', color: c.labelSecondary, marginTop: 2 },
  actions: { minWidth: 44, alignItems: 'flex-end' },
  actionsRow: { flexDirection: 'row' },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: c.checkBorder },
  radioFill: { margin: -2, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: c.fill, marginTop: 6, overflow: 'hidden' },
  trackFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  error: { fontSize: 13, lineHeight: 18, color: '#D70015', paddingHorizontal: 16, paddingBottom: 12, marginTop: -6 },
  note: { fontSize: 13, lineHeight: 18, paddingHorizontal: 4, color: c.labelTertiary },
  aboutCard: { padding: 16, gap: 10 },
  aboutText: { fontSize: 15, lineHeight: 21, color: c.labelSecondary },
  version: { fontSize: 13, textAlign: 'center', color: c.labelTertiary },
}));
