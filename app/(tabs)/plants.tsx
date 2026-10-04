import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Href, router, useFocusEffect } from 'expo-router';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { getAllActions, getAllIssues, getAllPlants, PlantRecord } from '../../lib/db';
import { computeInsight, HealthLevel, Insight, Suggestion, Trend } from '../../lib/insights';
import { loadRegionalStats, localOutcomeStats } from '../../lib/outcomes';
import { plantLabel } from '../../lib/plants';
import { FIELD_BLOCKS, useShambaStore } from '../../lib/store';
import { colors, makeStyles, status, useTheme } from '../../lib/theme';
import { useChromeInsets } from '../../lib/layout';
import ScreenTransition from '../../components/glass/ScreenTransition';
import PressableScale from '../../components/glass/PressableScale';
import BrandMark from '../../components/glass/BrandMark';
import { ChevronRight, Leaf, Minus, Sparkle, TrendDown, TrendUp } from '../../components/glass/Icons';
import { CONFIDENCE_WORD, HealthRing, LEVEL_COLOR, LEVEL_WORD, TREND_WORD } from '../../components/insights/Visuals';
import TasksSummary from '../../components/tasks/TasksSummary';
import ReadAloudButton from '../../components/ReadAloudButton';

const layoutTransition = LinearTransition.springify().damping(24).stiffness(220);
const enter = (i: number) => FadeInDown.duration(360).delay(60 + i * 60);

const URGENCY_COLOR: Record<Suggestion['urgency'], string> = { now: status.danger, soon: status.warning, routine: status.goodText };
const LEVEL_RANK: Record<HealthLevel, number> = { sick: 0, watch: 1, good: 2, unknown: 3 };
const TREND_COLOR: Record<Trend, string> = {
  improving: status.goodText,
  worsening: status.danger,
  stable: status.neutral,
  new: status.neutral,
};

function TrendGlyph({ trend, size, color }: { trend: Trend; size: number; color: string }) {
  if (trend === 'improving') return <TrendUp size={size} color={color} />;
  if (trend === 'worsening') return <TrendDown size={size} color={color} />;
  if (trend === 'stable') return <Minus size={size} color={color} />;
  return <Sparkle size={size} color={color} />;
}

interface BlockRow {
  block: string;
  insight: Insight;
}
interface TreeRow {
  plant: PlantRecord;
  label: string;
  insight: Insight;
}

/** Loads everything once and runs the insight engine per block and per tree (no soil lookups — list view only). */
async function loadOverview(): Promise<{ blocks: BlockRow[]; trees: TreeRow[] }> {
  const [allScans, allActions, plants, regional] = await Promise.all([getAllIssues(), getAllActions(), getAllPlants(), loadRegionalStats()]);
  const chrono = [...allScans].sort((a, b) => a.timestamp - b.timestamp);
  const localStats = localOutcomeStats(chrono, allActions);
  const regionalStats = regional?.stats;
  const now = Date.now();
  const scansIn = (block: string | null) => (block ? chrono.filter((s) => s.block === block) : []);

  const blocks = FIELD_BLOCKS.map((block) => {
    const scans = scansIn(block);
    return {
      block,
      insight: computeInsight({
        kind: 'block',
        scans,
        actions: allActions.filter((a) => a.block === block),
        blockScans: scans,
        localStats,
        regionalStats,
        now,
      }),
    };
  });

  const trees = plants
    .map((plant) => ({
      plant,
      label: plantLabel(plant),
      insight: computeInsight({
        scans: chrono.filter((s) => s.plantId === plant.id),
        actions: allActions.filter((a) => a.plantId === plant.id),
        blockScans: scansIn(plant.block),
        plantId: plant.id,
        localStats,
        regionalStats,
        now,
      }),
    }))
    .sort((a, b) => {
      const byLevel = LEVEL_RANK[a.insight.health.level] - LEVEL_RANK[b.insight.health.level];
      if (byLevel) return byLevel;
      const byScore = (a.insight.health.score ?? 101) - (b.insight.health.score ?? 101);
      if (byScore) return byScore;
      return (a.plant.tag ?? Infinity) - (b.plant.tag ?? Infinity) || a.plant.id - b.plant.id;
    });

  return { blocks, trees };
}

export default function PlantsScreen() {
  const { top, tabClearance } = useChromeInsets();
  const { c } = useTheme();
  const styles = useStyles();
  const dataVersion = useShambaStore((s) => s.dataVersion);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [trees, setTrees] = useState<TreeRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await loadOverview();
      setBlocks(data.blocks);
      setTrees(data.trees);
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [dataVersion, load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const subtitle = `${FIELD_BLOCKS.length} blocks · ${trees.length} tagged ${trees.length === 1 ? 'tree' : 'trees'}`;

  return (
    <ScreenTransition background={c.groundGrouped}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: top + 8, paddingBottom: tabClearance + 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.labelTertiary} />}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enter(0)} style={styles.header}>
          <BrandMark size={48} />
          <View style={styles.headerText}>
            <Text style={styles.title} accessibilityRole="header">Plants</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
          <ReadAloudButton text={() => plantsPageText(blocks, trees)} />
        </Animated.View>

        <Animated.View entering={enter(1)} layout={layoutTransition}>
          <TasksSummary />
        </Animated.View>

        <Animated.View entering={enter(2)} layout={layoutTransition} style={styles.section}>
          <Text style={styles.sectionTitle}>Blocks</Text>
          <View style={styles.grid}>
            {blocks.map((b, i) => (
              <Animated.View key={b.block} entering={enter(3 + i)} layout={layoutTransition} style={styles.gridCell}>
                <BlockCard row={b} />
              </Animated.View>
            ))}
          </View>
        </Animated.View>

        <Animated.View entering={enter(4)} layout={layoutTransition} style={styles.section}>
          <Text style={styles.sectionTitle}>Tagged trees</Text>
          {loaded && trees.length === 0 ? (
            <Animated.View entering={FadeIn.duration(300)} style={styles.empty}>
              <View style={styles.emptyArt}>
                <Leaf size={44} color={colors.emeraldBright} />
              </View>
              <Text style={styles.emptyTitle}>No tagged trees yet.</Text>
              <Text style={styles.emptyBody}>After you log a scan, tap ‘Tag to a tree’ to start tracking a tree.</Text>
            </Animated.View>
          ) : (
            <View style={styles.group}>
              {trees.map((t, i) => (
                <Animated.View key={t.plant.id} entering={enter(5 + Math.min(i, 8))} layout={layoutTransition}>
                  {i > 0 && <View style={[styles.separator, { marginLeft: 76 }]} />}
                  <TreeRowView row={t} />
                </Animated.View>
              ))}
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </ScreenTransition>
  );
}

/** Spoken summary: each block's health, then the trees that need care. */
function plantsPageText(blocks: BlockRow[], trees: TreeRow[]): string {
  const blockLines = blocks.map(({ block, insight }) => {
    const next = insight.suggestions[0];
    return `Block ${block}: ${LEVEL_WORD[insight.health.level]}${next ? `. Next: ${next.title}` : ''}.`;
  });
  const needCare = trees.filter((t) => t.insight.health.level === 'sick' || t.insight.health.level === 'watch');
  const treeLine = trees.length === 0
    ? 'You have no tagged trees yet.'
    : needCare.length === 0
      ? `All ${trees.length} tagged trees look fine.`
      : `Trees that need care: ${needCare.slice(0, 5).map((t) => `${t.label}, ${LEVEL_WORD[t.insight.health.level]}`).join('; ')}.`;
  return `Your plants. ${blockLines.join(' ')} ${treeLine} Tap a block or a tree to see more.`;
}

function BlockCard({ row }: { row: BlockRow }) {
  const styles = useStyles();
  const { insight, block } = row;
  const { health } = insight;
  const top = insight.suggestions[0];
  return (
    <PressableScale
      onPress={() => router.push(`/block/${block}` as Href)}
      pressedScale={0.96}
      style={styles.blockCard}
      accessibilityRole="button"
      accessibilityLabel={`Block ${block}, ${LEVEL_WORD[health.level]}, ${TREND_WORD[insight.trend]}`}
    >
      <View style={styles.blockTop}>
        <HealthRing health={health} size={56} />
        <View style={styles.blockHead}>
          <Text style={styles.blockName}>Block {block}</Text>
          <Text style={[styles.levelWord, { color: LEVEL_COLOR[health.level] }]} numberOfLines={1}>
            {LEVEL_WORD[health.level]}
          </Text>
        </View>
      </View>
      {health.scansUsed > 0 && <TrendLine trend={insight.trend} />}
      <Text style={[styles.blockNext, { color: top ? URGENCY_COLOR[top.urgency] : status.goodText }]} numberOfLines={2}>
        {top ? top.title : 'All good'}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {health.scansUsed > 0 ? `based on ${health.scansUsed} ${health.scansUsed === 1 ? 'scan' : 'scans'}` : 'no scans yet'}
      </Text>
    </PressableScale>
  );
}

function TreeRowView({ row }: { row: TreeRow }) {
  const styles = useStyles();
  const { c } = useTheme();
  const { insight, plant, label } = row;
  const { health } = insight;
  const top = insight.suggestions[0];
  return (
    <PressableScale
      onPress={() => router.push(`/plant/${plant.id}` as Href)}
      pressedScale={0.98}
      style={styles.treeRow}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${LEVEL_WORD[health.level]}${top ? `, next: ${top.title}` : ''}`}
    >
      <HealthRing health={health} size={44} stroke={5} />
      <View style={styles.treeText}>
        <View style={styles.treeTitleRow}>
          <Text style={styles.treeName} numberOfLines={1}>{label}</Text>
          {plant.block && (
            <View style={styles.blockChip}>
              <Text style={styles.blockChipText}>{plant.block}</Text>
            </View>
          )}
        </View>
        <Text style={[styles.treeNext, { color: top ? URGENCY_COLOR[top.urgency] : status.goodText }]} numberOfLines={1}>
          {top ? top.title : 'All good'}
        </Text>
        <View style={styles.treeMetaRow}>
          {health.scansUsed > 0 && <TrendLine trend={insight.trend} small />}
          <Text style={styles.meta} numberOfLines={1}>
            {health.scansUsed > 0 ? `${CONFIDENCE_WORD[health.confidence]} · ${health.scansUsed} ${health.scansUsed === 1 ? 'scan' : 'scans'}` : CONFIDENCE_WORD.none}
          </Text>
        </View>
      </View>
      <ChevronRight size={18} color={c.labelTertiary} />
    </PressableScale>
  );
}

function TrendLine({ trend, small }: { trend: Trend; small?: boolean }) {
  const styles = useStyles();
  const color = TREND_COLOR[trend];
  return (
    <View style={styles.trend}>
      <TrendGlyph trend={trend} size={small ? 14 : 16} color={color} />
      <Text style={[small ? styles.trendTextSmall : styles.trendText, { color }]}>{TREND_WORD[trend]}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  content: { paddingHorizontal: 16, gap: 22 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 34, fontWeight: '800', letterSpacing: -1, lineHeight: 40, color: c.label },
  subtitle: { fontSize: 16, fontWeight: '600', color: c.labelSecondary },

  section: { gap: 8 },
  sectionTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, paddingHorizontal: 4, color: c.label },
  group: { borderRadius: 26, backgroundColor: c.card, overflow: 'hidden' },
  separator: { height: 1, backgroundColor: c.separator },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridCell: { flexBasis: '47%', flexGrow: 1 },
  blockCard: { minHeight: 168, padding: 14, gap: 6, borderRadius: 28, backgroundColor: c.card },
  blockTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  blockHead: { flex: 1, gap: 1 },
  blockName: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2, color: c.label },
  levelWord: { fontSize: 15, fontWeight: '700' },
  blockNext: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  meta: { fontSize: 13, color: c.labelTertiary, flexShrink: 1 },

  trend: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trendText: { fontSize: 14, fontWeight: '600' },
  trendTextSmall: { fontSize: 13, fontWeight: '600' },

  treeRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  treeText: { flex: 1, gap: 2 },
  treeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  treeName: { fontSize: 17, fontWeight: '700', color: c.label, flexShrink: 1 },
  blockChip: { minWidth: 26, height: 24, paddingHorizontal: 8, borderRadius: 12, backgroundColor: c.numberBadge, alignItems: 'center', justifyContent: 'center' },
  blockChipText: { fontSize: 13, fontWeight: '800', color: c.accentText },
  treeNext: { fontSize: 15, fontWeight: '600' },
  treeMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  empty: { paddingVertical: 28, paddingHorizontal: 24, alignItems: 'center', gap: 6, borderRadius: 28, backgroundColor: c.card },
  emptyArt: { width: 88, height: 88, borderRadius: 30, backgroundColor: c.cardRaised, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3, color: c.label },
  emptyBody: { fontSize: 16, lineHeight: 23, color: c.labelSecondary, textAlign: 'center' },
}));
