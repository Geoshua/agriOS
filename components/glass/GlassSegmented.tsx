/**
 * GlassSegmented — a grouped glass control whose selection is a solid emerald
 * "lens" that glides between items (tab bar, scan-mode rail, map layer switch).
 * Content on the lens turns near-black; everything else stays cream.
 *
 * The lens springs to the measured frame of the selected item (or a fixed
 * `lensSize` disc centred in it) and briefly stretches along the travel axis
 * for a liquid feel. Item tint cross-fades from idle to active as the lens
 * arrives; with an animated `tone` it also blends between the two materials.
 */

import React, { useEffect } from 'react';
import { LayoutChangeEvent, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, {
  AnimatedStyle,
  Extrapolation,
  interpolate,
  interpolateColor,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Glass from './Glass';
import PressableScale from './PressableScale';
import { glass, GlassTone, spring, useTheme } from '../../lib/theme';

export interface SegmentItem {
  key: string;
  label: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  icon: (color: string) => React.ReactNode;
}

export interface SegmentPalette {
  active: string;
  idle: string;
  lens: string;
  lensEdge: string;
}

interface Props {
  items: SegmentItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  direction: 'row' | 'column';
  /** 'stack' = icon over label (tab bar, rail); 'inline' = icon beside label (map layer switch). */
  layout?: 'stack' | 'inline';
  /** Hide the text labels (icon-only tab bar). Accessibility labels are kept. */
  showLabels?: boolean;
  /** Fixed lens diameter, centred in the item, instead of the item's full frame. */
  lensSize?: number;
  tone?: GlassTone | SharedValue<number>;
  /** Overrides the tone's palette (static tone only). */
  palette?: Partial<SegmentPalette>;
  radius: number;
  padding?: number;
  itemStyle?: ViewStyle;
  highlightHeight?: string;
  style?: StyleProp<AnimatedStyle<ViewStyle>>;
  /** Animated style for the item track (e.g. fade it out while the bar minimizes). */
  trackStyle?: StyleProp<AnimatedStyle<ViewStyle>>;
  /** Extra content rendered inside the glass, above the track. */
  overlay?: React.ReactNode;
  pointerEvents?: 'box-none' | 'none' | 'auto';
  accessibilityLabel?: string;
}

const GAP = 2;

type Frame = { x: number; y: number; w: number; h: number };

export default function GlassSegmented({
  items,
  selectedIndex,
  onSelect,
  direction,
  layout = 'stack',
  showLabels = true,
  lensSize,
  tone: toneProp,
  palette,
  radius,
  padding = 4,
  itemStyle,
  highlightHeight,
  style,
  trackStyle,
  overlay,
  pointerEvents,
  accessibilityLabel,
}: Props) {
  const horizontal = direction === 'row';
  const theme = useTheme();
  const tone = toneProp ?? theme.tone;
  const position = useSharedValue(selectedIndex);
  const stretch = useSharedValue(0);
  const frames = useSharedValue<Frame[]>(items.map(() => ({ x: 0, y: 0, w: 0, h: 0 })));
  const measured = useSharedValue(0);

  const animatedTone = typeof tone !== 'string' ? (tone as SharedValue<number>) : null;
  const staticPalette: SegmentPalette | null = animatedTone ? null : { ...glass[tone as GlassTone], ...palette };

  useEffect(() => {
    position.value = withSpring(selectedIndex, spring.snappy);
    stretch.value = withSequence(withTiming(1, { duration: 110 }), withSpring(0, spring.snappy));
  }, [selectedIndex]);

  function onItemLayout(i: number, e: LayoutChangeEvent) {
    const { x, y, width, height } = e.nativeEvent.layout;
    const next = frames.value.slice();
    next[i] = { x, y, w: width, h: height };
    frames.value = next;
    measured.value = next.every((f) => f.w > 0) ? 1 : 0;
  }

  const lensStyle = useAnimatedStyle(() => {
    const fs = frames.value;
    const idx = fs.map((_, i) => i);
    const pick = (k: keyof Frame) => (fs.length > 1 ? interpolate(position.value, idx, fs.map((f) => f[k]), Extrapolation.CLAMP) : fs[0][k]);
    const fx = pick('x');
    const fy = pick('y');
    const fw = pick('w');
    const fh = pick('h');
    const w = lensSize ?? fw;
    const h = lensSize ?? fh;
    const x = lensSize ? fx + (fw - lensSize) / 2 : fx;
    const y = lensSize ? fy + (fh - lensSize) / 2 : fy;
    const s = stretch.value;
    const bg = animatedTone
      ? interpolateColor(animatedTone.value, [0, 1], [glass.dark.lens, glass.light.lens])
      : staticPalette!.lens;
    const edge = animatedTone
      ? interpolateColor(animatedTone.value, [0, 1], [glass.dark.lensEdge, glass.light.lensEdge])
      : staticPalette!.lensEdge;
    return {
      opacity: measured.value,
      width: w,
      height: h,
      borderRadius: Math.min(w, h) / 2,
      backgroundColor: bg,
      borderTopColor: edge,
      transform: [
        { translateX: x },
        { translateY: y },
        horizontal ? { scaleX: 1 + 0.08 * s } : { scaleY: 1 + 0.08 * s },
        horizontal ? { scaleY: 1 + 0.03 * s } : { scaleX: 1 + 0.04 * s },
      ],
    };
  }, [horizontal, lensSize, staticPalette?.lens, staticPalette?.lensEdge]);

  return (
    <Glass radius={radius} tone={tone} highlightHeight={highlightHeight} style={style} pointerEvents={pointerEvents}>
      <Animated.View
        style={[styles.track, { flexDirection: direction, padding, gap: GAP }, horizontal && styles.trackRow, trackStyle]}
        accessibilityRole="tablist"
        accessibilityLabel={accessibilityLabel}
      >
        <Animated.View pointerEvents="none" style={[styles.lens, lensStyle]} />
        {items.map((item, i) => (
          <SegmentButton
            key={item.key}
            item={item}
            index={i}
            position={position}
            selected={i === selectedIndex}
            onPress={() => onSelect(i)}
            onLayout={(e) => onItemLayout(i, e)}
            layout={layout}
            showLabel={showLabels}
            staticPalette={staticPalette}
            tone={animatedTone}
            style={[horizontal && layout === 'stack' ? { flex: 1 } : null, itemStyle]}
          />
        ))}
      </Animated.View>
      {overlay}
    </Glass>
  );
}

function SegmentButton({
  item,
  index,
  position,
  selected,
  onPress,
  onLayout,
  layout,
  showLabel,
  staticPalette,
  tone,
  style,
}: {
  item: SegmentItem;
  index: number;
  position: SharedValue<number>;
  selected: boolean;
  onPress: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
  layout: 'stack' | 'inline';
  showLabel: boolean;
  staticPalette: SegmentPalette | null;
  tone: SharedValue<number> | null;
  style: StyleProp<ViewStyle>;
}) {
  // Each colour variant is its own layer; opacity = how "active" × how "light".
  const variants: { color: string; active: boolean; light: boolean | null }[] = staticPalette
    ? [
        { color: staticPalette.idle, active: false, light: null },
        { color: staticPalette.active, active: true, light: null },
      ]
    : [
        { color: glass.dark.idle, active: false, light: false },
        { color: glass.light.idle, active: false, light: true },
        { color: glass.dark.active, active: true, light: false },
        { color: glass.light.active, active: true, light: true },
      ];

  return (
    <PressableScale
      onPress={onPress}
      onLayout={onLayout}
      disabled={item.disabled}
      pressedScale={0.9}
      style={[layout === 'stack' ? styles.itemStack : styles.itemInline, style]}
      accessibilityRole="tab"
      accessibilityState={{ selected, disabled: item.disabled }}
      accessibilityLabel={item.accessibilityLabel ?? item.label}
    >
      {variants.map((v, vi) => (
        <VariantLayer key={vi} {...v} index={index} position={position} tone={tone} first={vi === 0} layout={layout}>
          {item.icon(v.color)}
          {showLabel && (
            <Text
              style={[layout === 'stack' ? styles.labelStack : styles.labelInline, { color: v.color }]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
          )}
        </VariantLayer>
      ))}
    </PressableScale>
  );
}

function VariantLayer({
  active,
  light,
  index,
  position,
  tone,
  first,
  layout,
  children,
}: {
  active: boolean;
  light: boolean | null;
  index: number;
  position: SharedValue<number>;
  tone: SharedValue<number> | null;
  first: boolean;
  layout: 'stack' | 'inline';
  children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const a = interpolate(Math.abs(position.value - index), [0, 0.6], [1, 0], Extrapolation.CLAMP);
    const stateAmt = active ? a : 1 - a;
    const toneAmt = light === null || !tone ? 1 : light ? tone.value : 1 - tone.value;
    return { opacity: stateAmt * toneAmt };
  });
  return (
    <Animated.View
      style={[layout === 'stack' ? styles.innerStack : styles.innerInline, !first && StyleSheet.absoluteFill, style]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  track: { position: 'relative' },
  trackRow: { flex: 1 },
  lens: { position: 'absolute', left: 0, top: 0, borderTopWidth: 1 },
  itemStack: { alignItems: 'center', justifyContent: 'center' },
  itemInline: { justifyContent: 'center' },
  innerStack: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  innerInline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  labelStack: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  labelInline: { fontSize: 15, fontWeight: '700' },
});
