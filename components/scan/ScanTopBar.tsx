/**
 * Top control row on the scanner.
 *   AR      — "● Scanning  Block C ⌄" (opens the block picker) + flash
 *   Camera  — "‹ AR view" + flash
 *   Details — "‹ Scanner" only
 * The left pill morphs between these with a quick cross-fade + scale.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import Glass from '../glass/Glass';
import PressableScale from '../glass/PressableScale';
import BrandMark from '../glass/BrandMark';
import { Bolt, Check, ChevronDown, ChevronLeft } from '../glass/Icons';
import { colors, makeStyles, spring, status, timing, useTheme } from '../../lib/theme';
import { FIELD_BLOCKS, FieldBlock, ScanMode, useShambaStore } from '../../lib/store';
import { SIDE, useChromeInsets } from '../../lib/layout';
import ReadAloudButton from '../ReadAloudButton';
import diseaseData from '../../assets/diseases.json';

const DISEASES = diseaseData.diseases as Record<string, { name: string; immediateAction: string }>;

/** What the scanner's speaker says: how to scan, plus what it sees right now. */
function scanPageText(block: string): string {
  const how = `You are scanning Block ${block}. Hold one coffee leaf close to the camera, in daylight, and keep still.`;
  const det = useShambaStore.getState().currentDetection;
  if (!det || Date.now() - det.timestamp > 10_000) return `${how} The phone will show what it finds at the bottom of the screen.`;
  const d = DISEASES[det.result.diseaseId];
  if (!d || det.result.diseaseId === 'unknown') return `${how} Right now the picture is not clear enough to be sure. Move closer to one leaf.`;
  if (det.result.diseaseId === 'healthy') return `${how} This leaf looks healthy.`;
  return `${how} This looks like ${d.name}. Tap the card at the bottom to hear what to do.`;
}

export function PingDot({ active, size = 9 }: { active: boolean; size?: number }) {
  const ping = useSharedValue(0);
  const on = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    on.value = withTiming(active ? 1 : 0, timing.base);
    ping.value = 0;
    if (active) ping.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false);
  }, [active]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: 0.4 + 0.6 * on.value }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.9 * (1 - ping.value) * on.value,
    transform: [{ scale: 1 + 0.8 * ping.value }],
  }));

  const styles = useStyles();
  const dot = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={dot}>
      <Animated.View style={[styles.dot, dot, { backgroundColor: active ? colors.scanning : status.neutral }, dotStyle]} />
      <Animated.View style={[styles.dot, dot, { backgroundColor: colors.scanning }, ringStyle]} />
    </View>
  );
}

const menuEntering = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.86 }, { translateY: -10 }] },
    animations: {
      opacity: withTiming(1, timing.fast),
      transform: [{ scale: withSpring(1, spring.snappy) }, { translateY: withSpring(0, spring.snappy) }],
    },
  };
};

const menuExiting = () => {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }, { translateY: 0 }] },
    animations: {
      opacity: withTiming(0, timing.fast),
      transform: [{ scale: withTiming(0.92, timing.fast) }, { translateY: withTiming(-6, timing.fast) }],
    },
  };
};

const pillIn = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.92 }] },
    animations: { opacity: withTiming(1, timing.base), transform: [{ scale: withSpring(1, spring.snappy) }] },
  };
};
const pillOut = FadeOut.duration(140);

interface Props {
  mode: ScanMode;
  scanning: boolean;
  onBack: () => void;
  /** False while the demo scene replaces the camera (no torch to switch). */
  showTorch?: boolean;
}

export default function ScanTopBar({ mode, scanning, onBack, showTorch = true }: Props) {
  const { top } = useChromeInsets();
  const { g } = useTheme();
  const styles = useStyles();
  const { activeBlock, setActiveBlock, torch, setTorch } = useShambaStore();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (mode !== 'ar') setMenuOpen(false);
  }, [mode]);

  const chevron = useSharedValue(0);
  useEffect(() => {
    chevron.value = withSpring(menuOpen ? 1 : 0, spring.snappy);
  }, [menuOpen]);
  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${chevron.value * 180}deg` }] }));

  function pick(block: FieldBlock) {
    setActiveBlock(block);
    setMenuOpen(false);
  }

  return (
    <>
      {menuOpen && (
        <Animated.View exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} accessibilityLabel="Close block menu" />
        </Animated.View>
      )}

      <View style={[styles.row, { top }]} pointerEvents="box-none">
        <View style={styles.left} pointerEvents="box-none">
          <BrandMark size={48} tone="glass" />
          {mode === 'ar' ? (
            <Animated.View key="block" entering={pillIn} exiting={pillOut}>
              <PressableScale
                onPress={() => setMenuOpen((o) => !o)}
                accessibilityRole="button"
                accessibilityLabel={`Choose block. ${scanning ? 'Scanning' : 'Paused on'} Block ${activeBlock}`}
                accessibilityState={{ expanded: menuOpen }}
              >
                <Glass radius={24} style={styles.pill}>
                  <PingDot active={scanning} />
                  <Text style={styles.pillTitle}>{scanning ? 'Scanning' : 'Paused'}</Text>
                  <Animated.Text key={activeBlock} entering={ZoomIn.springify().damping(18).stiffness(300)} style={styles.pillValue}>
                    Block {activeBlock}
                  </Animated.Text>
                  <Animated.View style={chevronStyle}>
                    <ChevronDown color={g.text} />
                  </Animated.View>
                </Glass>
              </PressableScale>
            </Animated.View>
          ) : (
            <Animated.View key={mode} entering={pillIn} exiting={pillOut}>
              <PressableScale onPress={onBack} accessibilityRole="button" accessibilityLabel={mode === 'camera' ? 'Back to AR view' : 'Back to scanner'}>
                <Glass radius={24} style={styles.backPill}>
                  <ChevronLeft color={g.text} />
                  <Text style={styles.pillTitle}>{mode === 'camera' ? 'AR view' : 'Scanner'}</Text>
                </Glass>
              </PressableScale>
            </Animated.View>
          )}
        </View>

        {mode !== 'details' && (
          <Animated.View entering={pillIn} exiting={pillOut} style={styles.right}>
            <ReadAloudButton text={() => scanPageText(activeBlock)} />
            {showTorch && (
            <PressableScale
              onPress={() => setTorch(!torch)}
              accessibilityRole="switch"
              accessibilityLabel="Flash"
              accessibilityState={{ checked: torch }}
            >
              <Glass radius={24} style={styles.round}>
                <Animated.View key={torch ? 'on' : 'off'} entering={ZoomIn.springify().damping(14).stiffness(320)} exiting={ZoomOut.duration(120)}>
                  <Bolt color={torch ? g.accent : g.text} off={!torch} />
                </Animated.View>
              </Glass>
            </PressableScale>
            )}
          </Animated.View>
        )}
      </View>

      {menuOpen && (
        <Animated.View entering={menuEntering} exiting={menuExiting} style={[styles.menuWrap, { top: top + 56, left: SIDE + 56 }]}>
          <Glass radius={22} highlightHeight="40%" style={styles.menu}>
            {FIELD_BLOCKS.map((block, i) => (
              <React.Fragment key={block}>
                {i > 0 && <View style={styles.menuDivider} />}
                <PressableScale pressedScale={0.97} onPress={() => pick(block)} style={styles.menuItem} accessibilityRole="menuitem">
                  <Text style={styles.menuText}>Block {block}</Text>
                  {block === activeBlock && <Check size={18} color={g.accent} />}
                </PressableScale>
              </React.Fragment>
            ))}
          </Glass>
        </Animated.View>
      )}
    </>
  );
}

const useStyles = makeStyles((c, g) => ({
  row: {
    position: 'absolute',
    left: SIDE,
    right: SIDE,
    height: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 14 },
  backPill: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 12, paddingRight: 18 },
  pillTitle: { color: g.text, fontSize: 17, fontWeight: '700' },
  pillValue: { color: g.textSecondary, fontSize: 17 },
  round: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  right: { flexDirection: 'row', gap: 10 },
  dot: { position: 'absolute', left: 0, top: 0 },
  menuWrap: { position: 'absolute', left: SIDE, width: 200, transformOrigin: 'top left' },
  menu: { paddingVertical: 4 },
  menuItem: { height: 46, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  menuText: { color: g.text, fontSize: 17 },
  menuDivider: { height: StyleSheet.hairlineWidth, marginLeft: 18, backgroundColor: g.divider },
}));
