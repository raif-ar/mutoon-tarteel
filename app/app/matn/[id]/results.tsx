import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, ZoomIn } from "react-native-reanimated";
import { CheckIcon, FlameIcon } from "../../../src/components/MutoonIcons";
import { CountUp } from "../../../src/components/ui/CountUp";
import { Press } from "../../../src/components/ui/Press";
import { Ring } from "../../../src/components/ui/Ring";
import {
  getDailyActivity,
  getPracticeStreak,
} from "../../../src/lib/db/database";
import { colors, tint } from "../../../src/theme/colors";
import { fonts } from "../../../src/theme/fonts";
import { shadowCard } from "../../../src/theme/shadows";

const WEEK_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function fmtDuration(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export default function ResultsScreen() {
  const params = useLocalSearchParams<{
    id: string;
    lines?: string;
    seconds?: string;
    mistakes?: string;
    accuracy?: string;
    reviewWord?: string;
    reviewLine?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const lines = Number(params.lines ?? 0);
  const seconds = Number(params.seconds ?? 0);
  const mistakeCount = Number(params.mistakes ?? 0);
  const accuracy = Number(params.accuracy ?? 100);

  const [streak, setStreak] = useState(0);
  const [week, setWeek] = useState<number[]>([]);

  useEffect(() => {
    void getPracticeStreak().then(setStreak);
    void getDailyActivity(7).then(setWeek);
  }, []);

  const weekDays = week.map((count, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return {
      label: WEEK_LABELS[(d.getDay() + 6) % 7],
      done: count > 0,
      isToday: i === 6,
    };
  });

  const headline =
    accuracy >= 95
      ? "Beautiful recitation"
      : accuracy >= 85
        ? "Strong session"
        : "Keep at it";

  const stats = [
    { label: "Lines", value: String(lines) },
    { label: "Duration", value: fmtDuration(seconds) },
    { label: "Slips", value: String(mistakeCount) },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <Animated.Text
          entering={FadeInDown.duration(550)}
          style={styles.kicker}
        >
          SESSION COMPLETE
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.delay(60).duration(550)}
          style={styles.headline}
        >
          {headline}
        </Animated.Text>

        {/* Accuracy ring */}
        <Animated.View
          entering={ZoomIn.delay(150).duration(500)}
          style={styles.ringWrap}
        >
          <Ring size={158} stroke={11} pct={accuracy} delay={350} track={tint(10)}>
            <View style={{ alignItems: "center" }}>
              <CountUp
                to={accuracy}
                decimals={1}
                duration={1400}
                delay={450}
                style={styles.ringValue}
              />
              <Text style={styles.ringLabel}>accuracy</Text>
            </View>
          </Ring>
        </Animated.View>

        {/* Stats */}
        <View style={styles.statRow}>
          {stats.map((s, i) => (
            <Animated.View
              key={s.label}
              entering={FadeInDown.delay(450 + i * 80).duration(550)}
              style={styles.statCard}
            >
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </Animated.View>
          ))}
        </View>

        {/* Mistake review */}
        {mistakeCount > 0 ? (
          <Animated.View
            entering={FadeInDown.delay(700).duration(550)}
            style={styles.reviewCard}
          >
            <View style={styles.reviewWordTile}>
              <Text style={styles.reviewWordText} allowFontScaling={false}>
                {params.reviewWord || "—"}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.reviewTitle}>
                {mistakeCount === 1
                  ? "1 word to review"
                  : `${mistakeCount} words to review`}
              </Text>
              {params.reviewLine ? (
                <Text style={styles.reviewSub}>Line {params.reviewLine}</Text>
              ) : null}
            </View>
          </Animated.View>
        ) : null}

        {/* Streak */}
        <Animated.View
          entering={FadeInDown.delay(850).duration(550)}
          style={styles.streakCard}
        >
          <View style={styles.streakHead}>
            <FlameIcon size={22} />
            <Text style={styles.streakTitle}>
              <CountUp
                to={streak}
                duration={800}
                delay={1100}
                style={styles.streakTitle}
              />
              -day streak
            </Text>
            <Text style={styles.streakHint}>Keep it warm</Text>
          </View>
          <View style={styles.weekRow}>
            {weekDays.map((d, i) => (
              <View key={i} style={styles.weekDay}>
                <View
                  style={[
                    styles.weekDot,
                    d.done && (d.isToday ? styles.weekDotToday : styles.weekDotDone),
                  ]}
                >
                  {d.done ? (
                    <CheckIcon
                      size={12}
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
        </Animated.View>
      </ScrollView>

      {/* CTA */}
      <View
        style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) + 14 }]}
      >
        <Press onPress={() => router.back()} scale={0.97}>
          <View style={styles.cta}>
            <Text style={styles.ctaText}>Continue</Text>
          </View>
        </Press>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    direction: "ltr",
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 20,
    alignItems: "center",
  },
  kicker: {
    fontFamily: fonts.uiBold,
    fontSize: 13,
    color: colors.accent,
    letterSpacing: 1.4,
  },
  headline: {
    fontFamily: fonts.uiBold,
    fontSize: 26,
    color: colors.ink,
    letterSpacing: -0.6,
    marginTop: 4,
    textAlign: "center",
  },
  ringWrap: {
    marginTop: 26,
    marginBottom: 8,
  },
  ringValue: {
    fontFamily: fonts.uiBold,
    fontSize: 36,
    color: colors.ink,
    letterSpacing: -1,
  },
  ringLabel: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: -2,
  },
  statRow: {
    flexDirection: "row",
    gap: 9,
    width: "100%",
    marginTop: 18,
  },
  statCard: {
    flex: 1,
    paddingVertical: 13,
    paddingHorizontal: 8,
    borderRadius: 18,
    backgroundColor: colors.card,
    alignItems: "center",
    gap: 3,
    ...shadowCard,
  },
  statValue: {
    fontFamily: fonts.uiBold,
    fontSize: 20,
    color: colors.ink,
    letterSpacing: -0.3,
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 11.5,
    color: colors.textMuted,
  },
  reviewCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: colors.card,
    ...shadowCard,
  },
  reviewWordTile: {
    width: 40,
    height: 40,
    borderRadius: 13,
    flexShrink: 0,
    backgroundColor: "rgba(217,83,74,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  reviewWordText: {
    fontFamily: fonts.arabic,
    fontSize: 15,
    color: colors.error,
    includeFontPadding: false,
  },
  reviewTitle: {
    fontFamily: fonts.uiBold,
    fontSize: 14,
    color: colors.ink,
  },
  reviewSub: {
    fontFamily: fonts.ui,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  streakCard: {
    width: "100%",
    marginTop: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 20,
    backgroundColor: colors.card,
    ...shadowCard,
  },
  streakHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 13,
  },
  streakTitle: {
    fontFamily: fonts.uiBold,
    fontSize: 15.5,
    color: colors.ink,
  },
  streakHint: {
    marginLeft: "auto",
    fontFamily: fonts.uiSemiBold,
    fontSize: 12,
    color: colors.textMuted,
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
    width: 28,
    height: 28,
    borderRadius: 14,
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
  footer: {
    paddingHorizontal: 24,
    paddingTop: 14,
  },
  cta: {
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  ctaText: {
    fontFamily: fonts.uiBold,
    fontSize: 16,
    color: "#fff",
  },
});
