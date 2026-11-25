import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, ZoomIn } from "react-native-reanimated";
import { FlameIcon } from "../../../src/components/MutoonIcons";
import { CountUp } from "../../../src/components/ui/CountUp";
import { Cta } from "../../../src/components/ui/Cta";
import { Ring } from "../../../src/components/ui/Ring";
import { SlipTile } from "../../../src/components/ui/SlipTile";
import { WeekRow } from "../../../src/components/ui/WeekRow";
import {
  getDailyActivity,
  getPracticeStreak,
} from "../../../src/lib/db/database";
import {
  getLastSessionResult,
  practiceParams,
  setLastSessionResult,
  type SessionSlip,
} from "../../../src/lib/recite/session";
import { colors, tint } from "../../../src/theme/colors";
import { fonts } from "../../../src/theme/fonts";
import { shadowCard } from "../../../src/theme/shadows";

function fmtDuration(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** What was heard in place of the word, in plain words for VoiceOver and the row. */
function slipNote(slip: SessionSlip): string {
  if (slip.kind === "skipped") return "Skipped";
  // The engine hears sounds, not spelled words; with nothing usable it only knows the word was wrong.
  return slip.heard ? `Sounded like ${slip.heard}` : "Wrong word";
}

function SlipRow({ slip }: { slip: SessionSlip }) {
  const showHeard = slip.kind === "wrong" && slip.heard !== "";
  return (
    <View
      style={styles.slipRow}
      accessible
      accessibilityLabel={`Line ${slip.lineNumber}, ${slip.expectedWord}. ${slipNote(slip)}`}
    >
      <SlipTile word={slip.expectedWord} />
      <View style={styles.slipBody}>
        <Text style={styles.slipLine}>Line {slip.lineNumber}</Text>
        {showHeard ? (
          <Text style={styles.slipSub}>
            Sounded like <Text style={styles.slipHeard}>{slip.heard}</Text>
          </Text>
        ) : (
          <Text style={styles.slipSub}>{slipNote(slip)}</Text>
        )}
      </View>
    </View>
  );
}

export default function ResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Read once: Continue and Practice clear the stored result while this screen
  // is still on its way out, and it must keep showing what it has.
  const [result] = useState(() => {
    const last = getLastSessionResult();
    return last && last.matnId === id ? last : null;
  });

  const [streak, setStreak] = useState(0);
  const [week, setWeek] = useState<number[]>([]);

  useEffect(() => {
    void getPracticeStreak().then(setStreak);
    void getDailyActivity(7).then(setWeek);
  }, []);

  // Opened without a session behind it (e.g. a cold deep link): nothing to show.
  if (!result) return <Redirect href="/(tabs)/library" />;

  const { accuracy, slips } = result;
  const slipCount = slips.length;

  const headline = result.cleared
    ? "Slips cleared"
    : accuracy >= 95
      ? "Beautiful recitation"
      : accuracy >= 85
        ? "Strong session"
        : "Keep at it";

  const stats = [
    { label: "Lines", value: String(result.linesPassed) },
    { label: "Duration", value: fmtDuration(result.seconds) },
    { label: "Slips", value: String(slipCount) },
  ];

  const finish = () => {
    setLastSessionResult(null);
    // Opened without a screen behind it (a link straight into Recite): go home.
    if (router.canGoBack()) router.back();
    else router.replace("/library");
  };

  const practice = () => {
    setLastSessionResult(null);
    router.replace({
      pathname: "/matn/[id]/recite",
      // Spread into a plain object: route params need an index signature,
      // which the helper's interface type does not have.
      params: {
        ...practiceParams(
          result.matnId,
          slips.map((s) => s.lineIndex)
        ),
      },
    });
  };

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

        {/* Every slip of the session */}
        {slipCount > 0 ? (
          <Animated.View
            entering={FadeInDown.delay(700).duration(550)}
            style={styles.slipCard}
          >
            <Text style={styles.slipTitle}>
              {slipCount === 1
                ? "1 word to review"
                : `${slipCount} words to review`}
            </Text>
            {slips.map((slip, i) => (
              <SlipRow
                key={`${slip.lineId}:${slip.wordIndex}:${i}`}
                slip={slip}
              />
            ))}
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
          <WeekRow week={week} />
        </Animated.View>
      </ScrollView>

      {/* CTA */}
      <View
        style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) + 14 }]}
      >
        {slipCount > 0 ? (
          <>
            <Cta
              label={slipCount === 1 ? "Practice this line" : "Practice these lines"}
              onPress={practice}
            />
            <Cta variant="ghost" label="Continue" onPress={finish} />
          </>
        ) : (
          <Cta label="Continue" onPress={finish} />
        )}
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
    // Room for the last card's shadow above the footer once the slip list makes the page scroll.
    paddingBottom: 20,
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
  slipCard: {
    width: "100%",
    marginTop: 12,
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 6,
    borderRadius: 20,
    backgroundColor: colors.card,
    ...shadowCard,
  },
  slipTitle: {
    fontFamily: fonts.uiBold,
    fontSize: 14,
    color: colors.ink,
    marginBottom: 6,
  },
  slipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  slipBody: {
    flex: 1,
    minWidth: 0,
  },
  slipLine: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 13,
    color: colors.ink,
  },
  slipSub: {
    fontFamily: fonts.ui,
    fontSize: 12,
    color: colors.textMuted,
    writingDirection: "ltr",
  },
  slipHeard: {
    fontFamily: fonts.arabic,
    fontSize: 15,
    color: colors.error,
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
  footer: {
    paddingHorizontal: 24,
    paddingTop: 14,
    gap: 9,
  },
});
