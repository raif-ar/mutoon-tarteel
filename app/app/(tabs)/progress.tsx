import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckIcon, FlameIcon } from "../../src/components/MutoonIcons";
import { CountUp } from "../../src/components/ui/CountUp";
import { Ring } from "../../src/components/ui/Ring";
import {
  loadProgressStats,
  type ProgressStats,
} from "../../src/lib/stats/progressStats";
import { colors, tint } from "../../src/theme/colors";
import { fonts } from "../../src/theme/fonts";
import { shadowCard } from "../../src/theme/shadows";

const WEEK_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

/** Rotate so index 0 = Monday, given an activity array ending today. */
function mondayAlignedWeek(week: number[]): { label: string; count: number; isToday: boolean }[] {
  // week[6] is today; walk back to label each day by weekday.
  const out: { label: string; count: number; isToday: boolean }[] = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(today.getDate() - (6 - i));
    const weekday = (d.getDay() + 6) % 7; // 0 = Monday
    out.push({
      label: WEEK_LABELS[weekday],
      count: week[i] ?? 0,
      isToday: i === 6,
    });
  }
  return out;
}

function heatColor(count: number): string {
  if (count <= 0) return "rgba(22,33,30,0.05)";
  if (count === 1) return tint(22);
  if (count === 2) return tint(52);
  return colors.accent;
}

export default function ProgressScreen() {
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<ProgressStats | null>(null);

  useFocusEffect(
    useCallback(() => {
      void loadProgressStats().then(setStats);
    }, [])
  );

  if (!stats) {
    return <View style={[styles.root, { paddingTop: insets.top }]} />;
  }

  const weekDays = mondayAlignedWeek(stats.week);
  const statCards = [
    { value: stats.linesMemorized, label: "Lines memorized" },
    { value: stats.minutesRecited, label: "Minutes recited" },
    {
      value:
        stats.avgAccuracyPct != null
          ? `${Math.round(stats.avgAccuracyPct)}%`
          : "—",
      label: "Avg accuracy",
    },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Progress</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 120,
        }}
      >
        {/* Streak hero */}
        <View style={styles.card}>
          <View style={styles.streakRow}>
            <View style={styles.flameTile}>
              <FlameIcon size={26} />
            </View>
            <View>
              <Text style={styles.streakBig}>
                <CountUp
                  to={stats.streak}
                  duration={900}
                  delay={300}
                  style={styles.streakBig}
                />{" "}
                days
              </Text>
              <Text style={styles.streakSub}>
                Current streak
                {stats.bestStreak > 0 ? ` · best ${stats.bestStreak}` : ""}
              </Text>
            </View>
          </View>
          <View style={styles.weekRow}>
            {weekDays.map((d, i) => (
              <View key={i} style={styles.weekDay}>
                <View
                  style={[
                    styles.weekDot,
                    d.count > 0 &&
                      (d.isToday ? styles.weekDotToday : styles.weekDotDone),
                  ]}
                >
                  {d.count > 0 ? (
                    <CheckIcon
                      size={13}
                      color={d.isToday ? "#fff" : colors.accent}
                    />
                  ) : null}
                </View>
                <Text
                  style={[styles.weekLabel, d.isToday && styles.weekLabelToday]}
                >
                  {d.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Stat cards */}
        <View style={styles.statRow}>
          {statCards.map((s) => (
            <View key={s.label} style={styles.statCard}>
              {typeof s.value === "number" ? (
                <CountUp
                  to={s.value}
                  duration={1000}
                  delay={350}
                  style={styles.statValue}
                />
              ) : (
                <Text style={styles.statValue}>{s.value}</Text>
              )}
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        {/* Activity heatmap */}
        <View style={[styles.card, { marginTop: 12 }]}>
          <Text style={styles.cardTitle}>
            Last {stats.heatmapWeeks} weeks
          </Text>
          <View style={styles.heatmap}>
            {Array.from({ length: stats.heatmapWeeks }, (_, w) => (
              <View key={w} style={styles.heatCol}>
                {Array.from({ length: 7 }, (_, d) => {
                  const idx = w * 7 + d;
                  return (
                    <View
                      key={d}
                      style={[
                        styles.heatCell,
                        { backgroundColor: heatColor(stats.heatmap[idx] ?? 0) },
                      ]}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        </View>

        {/* Per-matn progress */}
        {stats.inProgress.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>In progress</Text>
            <View style={{ gap: 9 }}>
              {stats.inProgress.map((p, i) => (
                <View key={p.matn.id} style={styles.matnRow}>
                  <Ring
                    size={44}
                    stroke={4}
                    pct={p.pct}
                    color={p.matn.accentColor}
                    delay={400 + i * 120}
                  >
                    <Text
                      style={[
                        styles.matnRingLetter,
                        { color: p.matn.accentColor },
                      ]}
                      allowFontScaling={false}
                    >
                      {p.matn.titleAr.charAt(0)}
                    </Text>
                  </Ring>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.matnTitle}>{p.matn.title}</Text>
                    <Text style={styles.matnSub}>
                      {p.linesDone} of {p.matn.totalLines} lines
                    </Text>
                  </View>
                  <Text
                    style={[styles.matnPct, { color: p.matn.accentColor }]}
                  >
                    {Math.round(p.pct)}%
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    direction: "ltr",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 16,
  },
  title: {
    fontFamily: fonts.uiBold,
    fontSize: 26,
    color: colors.ink,
    letterSpacing: -0.6,
  },
  card: {
    padding: 18,
    borderRadius: 24,
    backgroundColor: colors.card,
    ...shadowCard,
  },
  cardTitle: {
    fontFamily: fonts.uiBold,
    fontSize: 14.5,
    color: colors.ink,
    marginBottom: 12,
  },
  streakRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 16,
  },
  flameTile: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: "rgba(224,145,42,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  streakBig: {
    fontFamily: fonts.uiBold,
    fontSize: 24,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  streakSub: {
    fontFamily: fonts.ui,
    fontSize: 12.5,
    color: colors.textMuted,
    marginTop: 1,
  },
  weekRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  weekDay: {
    alignItems: "center",
    gap: 5,
  },
  weekDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(22,33,30,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  weekDotDone: {
    backgroundColor: tint(12),
  },
  weekDotToday: {
    backgroundColor: colors.amber,
    shadowColor: colors.amber,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  weekLabel: {
    fontFamily: fonts.uiBold,
    fontSize: 10.5,
    color: colors.faint,
  },
  weekLabelToday: {
    color: colors.ink,
  },
  statRow: {
    flexDirection: "row",
    gap: 9,
    marginTop: 12,
  },
  statCard: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 18,
    backgroundColor: colors.card,
    alignItems: "center",
    ...shadowCard,
  },
  statValue: {
    fontFamily: fonts.uiBold,
    fontSize: 21,
    color: colors.ink,
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 10.5,
    color: colors.textMuted,
    marginTop: 3,
    lineHeight: 14,
    textAlign: "center",
  },
  heatmap: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 3.5,
  },
  heatCol: {
    gap: 3.5,
    flex: 1,
  },
  heatCell: {
    aspectRatio: 1,
    borderRadius: 5,
  },
  sectionTitle: {
    fontFamily: fonts.uiBold,
    fontSize: 14.5,
    color: colors.ink,
    marginTop: 20,
    marginBottom: 10,
  },
  matnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingVertical: 13,
    paddingHorizontal: 15,
    borderRadius: 20,
    backgroundColor: colors.card,
    ...shadowCard,
  },
  matnRingLetter: {
    fontFamily: fonts.arabic,
    fontSize: 16,
    includeFontPadding: false,
  },
  matnTitle: {
    fontFamily: fonts.uiBold,
    fontSize: 15,
    color: colors.ink,
  },
  matnSub: {
    fontFamily: fonts.ui,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  matnPct: {
    fontFamily: fonts.uiBold,
    fontSize: 13.5,
    fontVariant: ["tabular-nums"],
  },
});
