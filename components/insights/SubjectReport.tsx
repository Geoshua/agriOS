/**
 * Full report for a tagged tree or a block — Noor first, officer details last:
 *   status (face + colour + one word) → "Do this next" with the bush diagram →
 *   8-week strip → pentagon → "What did you do?" → scan history with photos →
 *   "For your extension officer" (evidence, outcomes, optional hub summary).
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Href, router } from 'expo-router';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import ScreenTransition from '../glass/ScreenTransition';
import Glass from '../glass/Glass';
import PressableScale from '../glass/PressableScale';
import { ChevronLeft } from '../glass/Icons';
import CoffeeBushDiagram from './CoffeeBushDiagram';
import Pentagon from './Pentagon';
import { CONFIDENCE_WORD, HealthRing, HealthStrip, LEVEL_COLOR, LEVEL_WORD, TREND_WORD } from './Visuals';
import ActionLogger from './ActionLogger';
import WateringCard from '../tasks/WateringCard';
import { ScanList } from './ScanHistory';
import { Subject, SubjectData, useSubjectInsight } from '../../lib/useSubjectInsight';
import type { Suggestion } from '../../lib/insights';
import { fetchHistorySummary } from '../../lib/outcomes';
import { plantLabel } from '../../lib/plants';
import { LOCAL_SERVER_URL } from '../../lib/config';
import { colors, makeStyles, sentenceCase, severityPin, useTheme } from '../../lib/theme';
import { useChromeInsets } from '../../lib/layout';

// Chip colours chosen for ≥4.5:1 with white text.
const URGENCY: Record<Suggestion['urgency'], { word: string; color: string }> = {
  now: { word: 'Now', color: '#C4170C' },
  soon: { word: 'This week', color: '#A84A00' },
  routine: { word: 'When you can', color: '#1E7B3C' },
};

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)/plants' as Href);
}

const enter = (i: number) => FadeInDown.duration(380).delay(80 + i * 70);

export default function SubjectReport({ subject }: { subject: Subject }) {
  const styles = useStyles();
  const { c } = useTheme();
  const { top } = useChromeInsets();
  const { data, loading, error } = useSubjectInsight(subject);
  const [picked, setPicked] = useState(0);

  useEffect(() => setPicked(0), [data?.insight.suggestions.map((s) => s.id).join()]);

  return (
    <ScreenTransition background={c.groundGrouped}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: top + 56, paddingBottom: 60 }]} showsVerticalScrollIndicator={false}>
        {loading && !data ? (
          <ActivityIndicator color={c.labelSecondary} style={{ marginTop: 80 }} />
        ) : error ? (
          <Text style={styles.missing}>Couldn’t load this report. Go back and try again.</Text>
        ) : !data ? (
          <Text style={styles.missing}>{subject.kind === 'plant' ? 'This tree no longer exists.' : 'Nothing recorded for this block yet.'}</Text>
        ) : (
          <Report data={data} picked={picked} onPick={setPicked} />
        )}
      </ScrollView>

      <View style={[styles.backRow, { top }]} pointerEvents="box-none">
        <PressableScale onPress={goBack} accessibilityRole="button" accessibilityLabel="Back">
          <Glass radius={22} style={styles.back}>
            <ChevronLeft color={c.label} />
            <Text style={styles.backText}>Plants</Text>
          </Glass>
        </PressableScale>
      </View>
    </ScreenTransition>
  );
}

function Report({ data, picked, onPick }: { data: SubjectData; picked: number; onPick: (i: number) => void }) {
  const styles = useStyles();
  const { insight, subject } = data;
  const { health } = insight;
  const suggestion = insight.suggestions[picked] ?? insight.suggestions[0];
  const isBlock = subject.kind === 'block';

  return (
    <>
      {/* 1. Status */}
      <Animated.View entering={enter(0)} style={styles.statusCard}>
        <HealthRing health={health} size={96} stroke={8} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.title} accessibilityRole="header">{data.title}</Text>
          <Text style={[styles.level, { color: LEVEL_COLOR[health.level] }]}>
            {LEVEL_WORD[health.level]}
            {health.score != null ? ` · ${health.score}/100` : ''}
          </Text>
          <Text style={styles.meta}>
            {insight.trend !== 'new' ? `${TREND_WORD[insight.trend]} · ` : ''}
            {health.scansUsed ? `${CONFIDENCE_WORD[health.confidence]} from ${health.scansUsed} scan${health.scansUsed === 1 ? '' : 's'}` : CONFIDENCE_WORD.none}
          </Text>
          {!isBlock && data.plant?.block && <Text style={styles.meta}>Block {data.plant.block}</Text>}
        </View>
      </Animated.View>

      {/* 2. Do this next */}
      {suggestion ? (
        <Animated.View entering={enter(1)} layout={LinearTransition.springify().damping(24)} style={styles.section}>
          <Text style={styles.sectionTitle}>Do This Next</Text>
          <View style={styles.card}>
            <View style={styles.diagramWrap}>
              <CoffeeBushDiagram zone={suggestion.zone} caption={suggestion.title.length < 22 ? suggestion.title : undefined} />
            </View>
            <Animated.View key={suggestion.id} entering={FadeIn.duration(220)} style={{ gap: 6 }}>
              <View style={[styles.urgency, { backgroundColor: URGENCY[suggestion.urgency].color }]}>
                <Text style={styles.urgencyText}>{URGENCY[suggestion.urgency].word}</Text>
              </View>
              <Text style={styles.sugTitle}>{suggestion.title}</Text>
              <Text style={styles.sugWhy}>{suggestion.why}</Text>
              {suggestion.evidence && <Text style={styles.evidence}>{suggestion.evidence}</Text>}
            </Animated.View>
          </View>
          {insight.suggestions.length > 1 && (
            <View style={styles.list}>
              {insight.suggestions.map((s, i) => (
                <PressableScale
                  key={s.id}
                  pressedScale={0.98}
                  onPress={() => onPick(i)}
                  style={[styles.sugRow, i === picked && styles.sugRowOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: i === picked }}
                >
                  <View style={[styles.sugDot, { backgroundColor: URGENCY[s.urgency].color }]} />
                  <Text style={styles.sugRowText} numberOfLines={1}>{s.title}</Text>
                </PressableScale>
              ))}
            </View>
          )}
        </Animated.View>
      ) : null}

      {/* 3. History strip */}
      <Animated.View entering={enter(2)} style={styles.section}>
        <Text style={styles.sectionTitle}>Last 8 Weeks</Text>
        <View style={[styles.card, { gap: 12 }]}>
          <HealthStrip weeks={insight.weeks} />
          <View style={styles.legend}>
            {[['none', 'Healthy'], ['low', 'Mild'], ['medium', 'Watch'], ['high', 'Sick']].map(([sev, label]) => (
              <View key={sev} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: severityPin[sev] }]} />
                <Text style={styles.legendText}>{label}</Text>
              </View>
            ))}
          </View>
        </View>
      </Animated.View>

      {/* 4. Pentagon */}
      <Animated.View entering={enter(3)} style={styles.section}>
        <Text style={styles.sectionTitle}>Health Check</Text>
        <View style={[styles.card, { alignItems: 'stretch', gap: 6 }]}>
          <Pentagon axes={insight.axes} />
          {insight.axes.map((a) => (
            <View key={a.key} style={styles.axisRow}>
              <Text style={styles.axisName}>{a.label}</Text>
              <Text style={styles.axisDetail}>{a.detail}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Watering */}
      <Animated.View entering={enter(4)} style={styles.section}>
        <WateringCard
          subject={subject.kind === 'block' ? { kind: 'block', block: subject.block } : { kind: 'plant', id: data.plant!.id, block: data.plant!.block }}
        />
      </Animated.View>

      {/* 5. Actions */}
      <Animated.View entering={enter(4)} style={styles.section}>
        <ActionLogger
          plantId={data.plant?.id ?? null}
          block={data.plant?.block ?? (subject.kind === 'block' ? subject.block : null)}
          diseaseId={insight.lastScan && insight.lastScan.diseaseId !== 'healthy' ? insight.lastScan.diseaseId : null}
          title={`What did you do for this ${isBlock ? 'block' : 'tree'}?`}
        />
      </Animated.View>

      {/* Trees in a block */}
      {isBlock && data.treeSummaries.length > 0 && (
        <Animated.View entering={enter(5)} style={styles.section}>
          <Text style={styles.sectionTitle}>Tagged Trees</Text>
          <TreeRows trees={data.treeSummaries} />
        </Animated.View>
      )}

      {/* 6. History */}
      <Animated.View entering={enter(5)} style={styles.section}>
        <Text style={styles.sectionTitle}>Scan History</Text>
        <ScanList scans={data.scans} trees={data.trees} />
      </Animated.View>

      {/* 7. Officer */}
      <Animated.View entering={enter(6)} style={styles.section}>
        <Text style={styles.sectionTitle}>For Your Extension Officer</Text>
        <OfficerCard data={data} />
      </Animated.View>
    </>
  );
}

/** Tagged trees in a block with their health (computed with the block) — tap to open. */
function TreeRows({ trees }: { trees: SubjectData['treeSummaries'] }) {
  const styles = useStyles();
  const sorted = [...trees].sort((a, b) => (a.insight.health.score ?? 101) - (b.insight.health.score ?? 101));
  return (
    <View style={styles.list}>
      {sorted.map(({ plant, insight }) => (
        <PressableScale
          key={plant.id}
          pressedScale={0.98}
          onPress={() => router.push(`/plant/${plant.id}` as Href)}
          style={styles.treeRow}
          accessibilityRole="button"
          accessibilityLabel={`${plantLabel(plant)}, ${LEVEL_WORD[insight.health.level]}`}
        >
          <HealthRing health={insight.health} size={40} stroke={4} />
          <Text style={styles.treeName}>{plantLabel(plant)}</Text>
          <Text style={styles.treeLevel}>{LEVEL_WORD[insight.health.level]}</Text>
        </PressableScale>
      ))}
    </View>
  );
}

function OfficerCard({ data }: { data: SubjectData }) {
  const styles = useStyles();
  const { insight } = data;
  const [summary, setSummary] = useState<string | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const fmt = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const diseases = new Set(data.scans.map((s) => s.diseaseId).filter((d) => d !== 'healthy' && d !== 'unknown'));
  const outcomes = [...diseases].flatMap((d) =>
    Object.entries(data.localStats[d] ?? {}).map(([action, t]) => `${sentenceCase(d.replace('coffee_', '').replace(/_/g, ' '))} · ${action}: ${t!.success}/${t!.total} improved`),
  );

  async function getSummary() {
    setLoadingSummary(true);
    const text = await fetchHistorySummary({
      subject: data.title,
      health: `${LEVEL_WORD[insight.health.level]} (${insight.health.score ?? 'n/a'}/100, ${insight.health.confidence} confidence)`,
      trend: insight.trend,
      recurring: insight.recurring.map((r) => `${r.name} ×${r.count}`),
      recentScans: data.scans.slice(-8).map((s) => ({ date: fmt(s.timestamp), result: s.diseaseName })),
      actions: data.actions.slice(-8).map((a) => ({ date: fmt(a.timestamp), action: a.type })),
      soilPh: data.soil?.ph,
    });
    setSummary(text ?? 'The co-op hub could not be reached. Try again near the hub.');
    setLoadingSummary(false);
  }

  return (
    <View style={[styles.card, { gap: 8 }]}>
      <Text style={styles.officerLine}>
        {data.scans.length} scans{data.scans.length ? ` from ${fmt(data.scans[0].timestamp)}` : ''} · {data.actions.length} actions logged
      </Text>
      <Text style={styles.officerLine}>
        Health {insight.health.score ?? '–'}/100 ({insight.health.confidence} confidence, recency-weighted over 28 days) · trend {insight.trend}
      </Text>
      {insight.recurring.length > 0 && (
        <Text style={styles.officerLine}>Recurring (6 weeks): {insight.recurring.map((r) => `${r.name} ×${r.count}`).join(', ')}</Text>
      )}
      {outcomes.length > 0 && <Text style={styles.officerLine}>Outcomes on this farm: {outcomes.join(' · ')}</Text>}
      {data.regional && <Text style={styles.officerLine}>Regional stats from {data.regional.farms} farms (updated {fmt(data.regional.updatedAt)})</Text>}
      {data.soil && (
        <Text style={styles.officerLine}>
          Soil (SoilGrids ~250 m, 0–5 cm): pH {data.soil.ph.toFixed(1)}, N {data.soil.nitrogen.toFixed(2)} g/kg, C {data.soil.carbon.toFixed(1)} g/kg, clay {data.soil.clay.toFixed(0)}%
        </Text>
      )}
      <Text style={styles.officerNote}>Estimates come from scan history and agronomy rules; no harvest data is recorded, so nothing here predicts yield.</Text>
      {LOCAL_SERVER_URL ? (
        summary ? (
          <Animated.Text entering={FadeIn.duration(240)} style={styles.summary}>{summary}</Animated.Text>
        ) : (
          <PressableScale onPress={getSummary} disabled={loadingSummary} style={styles.summaryBtn} accessibilityRole="button">
            {loadingSummary ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.summaryBtnText}>Summarise with the co-op AI</Text>}
          </PressableScale>
        )
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  content: { paddingHorizontal: 16, gap: 22 },
  missing: { fontSize: 16, color: c.labelSecondary, textAlign: 'center', marginTop: 80 },
  backRow: { position: 'absolute', left: 16 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 44, paddingLeft: 8, paddingRight: 14 },
  backText: { fontSize: 17, fontWeight: '600', color: c.label },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderRadius: 28, backgroundColor: c.card },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, color: c.label },
  level: { fontSize: 20, fontWeight: '700' },
  meta: { fontSize: 14, color: c.labelSecondary },
  section: { gap: 8 },
  sectionTitle: { fontSize: 20, fontWeight: '700', paddingHorizontal: 4, color: c.label },
  card: { padding: 16, borderRadius: 26, backgroundColor: c.card, gap: 10 },
  diagramWrap: { alignItems: 'center' },
  urgency: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  urgencyText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  sugTitle: { fontSize: 20, fontWeight: '700', color: c.label },
  sugWhy: { fontSize: 16, lineHeight: 23, color: c.labelSecondary },
  evidence: { fontSize: 14, fontWeight: '600', color: c.accentText },
  list: { borderRadius: 22, backgroundColor: c.card, overflow: 'hidden' },
  sugRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingHorizontal: 16 },
  sugRowOn: { backgroundColor: c.fill },
  sugDot: { width: 10, height: 10, borderRadius: 5 },
  sugRowText: { flex: 1, fontSize: 16, color: c.label },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 12, color: c.labelSecondary },
  axisRow: { flexDirection: 'row', gap: 10 },
  axisName: { width: 92, fontSize: 14, fontWeight: '700', color: c.label },
  axisDetail: { flex: 1, fontSize: 14, color: c.labelSecondary },
  treeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14 },
  treeName: { flex: 1, fontSize: 17, fontWeight: '600', color: c.label },
  treeLevel: { fontSize: 15, fontWeight: '700', color: c.labelSecondary },
  officerLine: { fontSize: 14, lineHeight: 20, color: c.labelSecondary },
  officerNote: { fontSize: 13, lineHeight: 18, color: c.labelTertiary, fontStyle: 'italic' },
  summary: { fontSize: 15, lineHeight: 22, color: c.label },
  summaryBtn: { minHeight: 48, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  summaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
}));

