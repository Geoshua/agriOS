/** Icons drawn exactly as in the design canvas (24×24 viewBox). */

import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

interface IconProps {
  size?: number;
  color?: string;
}

const stroke = (color: string, width: number) => ({
  fill: 'none',
  stroke: color,
  strokeWidth: width,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export function ChevronDown({ size = 14, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 3)}>
      <Path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function ChevronUp({ size = 16, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.8)}>
      <Path d="m6 15 6-6 6 6" />
    </Svg>
  );
}

export function ChevronLeft({ size = 22, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.6)}>
      <Path d="m15 5-7 7 7 7" />
    </Svg>
  );
}

export function Bolt({ size = 22, color = '#fff', off }: IconProps & { off?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M13.5 2 4.5 13.5h6.5L10 22l9-11.5h-6.5L13.5 2Z"
        fill={off ? 'none' : color}
        stroke={color}
        strokeWidth={off ? 1.8 : 0}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function Cube({ size = 22, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.1)}>
      <Path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" />
      <Path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </Svg>
  );
}

export function Camera({ size = 22, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2)}>
      <Path d="M4 8h3l2-3h6l2 3h3v11H4V8Z" />
      <Circle cx={12} cy={13} r={3.5} />
    </Svg>
  );
}

export function Document({ size = 22, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2)}>
      <Rect x={5} y={3} width={14} height={18} rx={3} />
      <Path d="M9 8h6M9 12h6M9 16h4" />
    </Svg>
  );
}

export function ScanFrame({ size = 24, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.1)}>
      <Path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <Path d="M7 12h10" />
    </Svg>
  );
}

export function MapFold({ size = 24, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2)}>
      <Path d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Z" />
      <Path d="M9 4v13.5M15 6.5V20" />
    </Svg>
  );
}

export function BarChart({ size = 24, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2)}>
      <Path d="M4 20h16" />
      <Rect x={5.5} y={11} width={3} height={6} rx={1} />
      <Rect x={10.5} y={6} width={3} height={11} rx={1} />
      <Rect x={15.5} y={9} width={3} height={8} rx={1} />
    </Svg>
  );
}

export function MapPin({ size = 22, color = '#fff', hole = '#3A3A3C' }: IconProps & { hole?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Z" fill={color} />
      <Circle cx={12} cy={9} r={2.6} fill={hole} />
    </Svg>
  );
}

export function Heat({ size = 16, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Circle cx={9} cy={10} r={6} opacity={0.55} />
      <Circle cx={15} cy={14} r={6} opacity={0.85} />
    </Svg>
  );
}

export function Globe({ size = 16, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.2)}>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </Svg>
  );
}

/** "Look around" — a leaf inside a 360° turn arrow (demo scene). */
export function LookAround({ size = 22, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.2)}>
      <Path d="M8.5 18.6C5 17.8 2.5 16 2.5 14c0-2.9 4.3-5.2 9.5-5.2s9.5 2.3 9.5 5.2c0 1.9-1.9 3.5-4.8 4.4" />
      <Path d="m14.5 16.2 2.4 2.4-2.6 2.2" />
      <Path d="M12 13.5c-2.2-1.6-2.4-5.6 2.6-8.2.6 3.9-.6 7-2.6 8.2Z" fill={color} />
    </Svg>
  );
}

export function Speaker({ size = 20, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2)}>
      <Path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5Z" fill={color} />
      <Path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </Svg>
  );
}

export function Download({ size = 20, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.4)}>
      <Path d="M12 4v11M7 10.5l5 5 5-5" />
      <Path d="M5 19.5h14" />
    </Svg>
  );
}

export function Trash({ size = 18, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.1)}>
      <Path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7" />
      <Path d="M10.2 11v6M13.8 11v6" />
    </Svg>
  );
}

export function Gear({ size = 24, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2)}>
      <Circle cx={12} cy={12} r={3.2} />
      <Path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14.2 2.6h-4l-.4 2.4a7.6 7.6 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-.9a7.6 7.6 0 0 0 2.6 1.5l.4 2.4h4l.4-2.4a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4-2-1.5Z" />
    </Svg>
  );
}

export function Locate({ size = 22, color = '#0A84FF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M20.5 3.5 3 10.6l7.2 2.2 2.2 7.2L20.5 3.5Z" fill={color} />
    </Svg>
  );
}

export function Close({ size = 16, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 3)}>
      <Path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function Share({ size = 20, color = '#1C1C1E' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.2)}>
      <Path d="M12 15V3M7 8l5-5 5 5" />
      <Path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </Svg>
  );
}

export function Pause({ size = 18, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Rect x={6} y={5} width={4} height={14} rx={1.2} />
      <Rect x={14} y={5} width={4} height={14} rx={1.2} />
    </Svg>
  );
}

export function Play({ size = 18, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M7.5 4.8v14.4c0 .8.9 1.3 1.6.8l10.6-7.2c.6-.4.6-1.2 0-1.6L9.1 4c-.7-.5-1.6 0-1.6.8Z" />
    </Svg>
  );
}

export function TrendDown({ size = 18, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.6)}>
      <Path d="m3 7 6 6 4-4 8 8" />
      <Path d="M15 17h6v-6" />
    </Svg>
  );
}

export function Sun({ size = 14, color = '#6C6C70' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.4)}>
      <Path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </Svg>
  );
}

export function Check({ size = 20, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 2.8)}>
      <Path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function Leaf({ size = 48, color = '#fff' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" {...stroke(color, 1.6)}>
      <Path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15Z" />
      <Path d="M5 19 13 11" />
    </Svg>
  );
}

/**
 * Filled severity disc. `inverted` draws a white disc with a coloured glyph
 * (used inside solid chips).
 */
export function StatusDisc({
  size = 34,
  color,
  kind,
  inverted,
}: {
  size?: number;
  color: string;
  kind: 'alert' | 'warning' | 'info' | 'check' | 'question';
  inverted?: boolean;
}) {
  const disc = inverted ? '#FFFFFF' : color;
  const glyph = inverted ? color : kind === 'info' ? '#111827' : '#FFFFFF';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {kind === 'warning' ? (
        <Path d="M12 2.5 22.5 20.5h-21L12 2.5Z" fill={disc} stroke={disc} strokeWidth={1.5} strokeLinejoin="round" />
      ) : (
        <Circle cx={12} cy={12} r={11} fill={disc} />
      )}
      {kind === 'alert' && (
        <>
          <Path d="M12 6.5v7" stroke={glyph} strokeWidth={2.6} strokeLinecap="round" />
          <Circle cx={12} cy={17.3} r={1.5} fill={glyph} />
        </>
      )}
      {kind === 'warning' && (
        <>
          <Path d="M12 9v5" stroke={glyph} strokeWidth={2.2} strokeLinecap="round" />
          <Circle cx={12} cy={17.2} r={1.2} fill={glyph} />
        </>
      )}
      {kind === 'info' && (
        <>
          <Path d="M12 11v6" stroke={glyph} strokeWidth={2.4} strokeLinecap="round" />
          <Circle cx={12} cy={7.5} r={1.4} fill={glyph} />
        </>
      )}
      {kind === 'check' && (
        <Path d="m7.5 12.2 3 3 6-6.4" stroke={glyph} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {kind === 'question' && (
        <>
          <Path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9v.4" stroke={glyph} strokeWidth={2.2} fill="none" strokeLinecap="round" />
          <Circle cx={12} cy={17.2} r={1.3} fill={glyph} />
        </>
      )}
    </Svg>
  );
}

/** Glyph drawn inside a map pin. */
export function PinGlyph({ kind, size = 18 }: { kind: 'alert' | 'warning' | 'info' | 'check' | 'question'; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {kind === 'alert' && (
        <>
          <Path d="M12 5.5v8.5" stroke="#fff" strokeWidth={3.2} strokeLinecap="round" />
          <Circle cx={12} cy={18.6} r={1.9} fill="#fff" />
        </>
      )}
      {kind === 'warning' && <Path d="M12 5l7.5 13h-15Z" stroke="#fff" strokeWidth={2.8} fill="none" strokeLinejoin="round" />}
      {kind === 'info' && (
        <>
          <Path d="M12 10.5v8" stroke="#000" strokeWidth={3.2} strokeLinecap="round" />
          <Circle cx={12} cy={5.8} r={2} fill="#000" />
        </>
      )}
      {kind === 'check' && (
        <Path d="m5.5 12.5 4.2 4.2 8.8-9" stroke="#fff" strokeWidth={3.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {kind === 'question' && (
        <>
          <Path d="M9.4 9a2.7 2.7 0 1 1 3.9 2.4c-.8.4-1.3 1-1.3 1.9v.4" stroke="#fff" strokeWidth={2.8} fill="none" strokeLinecap="round" />
          <Circle cx={12} cy={18.2} r={1.8} fill="#fff" />
        </>
      )}
    </Svg>
  );
}
