import { useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
  FadeInDown,
} from "react-native-reanimated";
import {
  CheckIcon,
  EarIcon,
  FlameIcon,
  TargetIcon,
} from "../src/components/MutoonIcons";
import { Press } from "../src/components/ui/Press";
import { setSetting } from "../src/lib/db/database";
import { colors, tint } from "../src/theme/colors";
import { fonts } from "../src/theme/fonts";
import { shadowCard } from "../src/theme/shadows";

const EASE = Easing.bezier(0.32, 0.72, 0, 1);

const GOALS = [
  { minutes: 5, label: "Relaxed" },
  { minutes: 10, label: "Steady" },
  { minutes: 20, label: "Serious" },
];

const FEATURES = [
  {
    Icon: EarIcon,
    title: "Real-time listening",
    sub: "Every word tracked as you recite",
  },
  {
    Icon: TargetIcon,
    title: "Word-level accuracy",
    sub: "Slips caught the moment they happen",
  },
  {
    Icon: FlameIcon,
    title: "A gentle streak",
    sub: "A few lines a day, kept warm",
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState(10);
  const offset = useSharedValue(0);

  const trackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -offset.value }],
  }));

  const goTo = (next: number) => {
    setStep(next);
    offset.value = withTiming(next * width, { duration: 600, easing: EASE });
  };

  const finish = () => {
    void Promise.all([
      setSetting("onboarded", "1"),
      setSetting("dailyGoalMin", String(goal)),
    ]).then(() => router.replace("/library"));
  };

  const next = () => (step < 2 ? goTo(step + 1) : finish());

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 20) },
      ]}
    >
      {/* Skip */}
      <View style={styles.skipRow}>
        <Press onPress={finish} style={styles.skipBtn}>
          <Text style={styles.skipText}>Skip</Text>
        </Press>
      </View>

      {/* Slide track */}
      <View style={styles.trackClip}>
        <Animated.View
          style={[styles.track, { width: width * 3 }, trackStyle]}
        >
          {/* 1 — Welcome */}
          <View style={[styles.slide, styles.slideCenter, { width }]}>
            {step === 0 ? (
              <>
                <Animated.View
                  entering={FadeInDown.duration(600).easing(
                    Easing.bezier(0.16, 1, 0.3, 1).factory()
                  )}
                  style={styles.logoTile}
                >
                  <Text style={styles.logoLetter} allowFontScaling={false}>
                    م
                  </Text>
                </Animated.View>
                <Animated.Text
                  entering={FadeInDown.delay(100).duration(550)}
                  style={styles.welcomeTitle}
                >
                  Memorize the mutoon,{"\n"}line by line
                </Animated.Text>
                <Animated.Text
                  entering={FadeInDown.delay(200).duration(550)}
                  style={styles.welcomeSub}
                >
                  The classical texts of Tajweed, Aqeedah and Hadith — memorized
                  with your voice.
                </Animated.Text>
              </>
            ) : null}
          </View>

          {/* 2 — How it works */}
          <View style={[styles.slide, { width }]}>
            {step === 1 ? (
              <>
                <Animated.Text
                  entering={FadeInDown.duration(550)}
                  style={styles.stepTitle}
                >
                  Recite.{"\n"}We follow along.
                </Animated.Text>
                <Animated.Text
                  entering={FadeInDown.delay(80).duration(550)}
                  style={styles.stepSub}
                >
                  Recite from memory and watch each word light up as you go.
                </Animated.Text>
                <View style={styles.featureList}>
                  {FEATURES.map(({ Icon, title, sub }, i) => (
                    <Animated.View
                      key={title}
                      entering={FadeInDown.delay(150 + i * 90).duration(550)}
                      style={styles.featureRow}
                    >
                      <View style={styles.featureIcon}>
                        <Icon size={21} color={colors.accent} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.featureTitle}>{title}</Text>
                        <Text style={styles.featureSub}>{sub}</Text>
                      </View>
                    </Animated.View>
                  ))}
                </View>
              </>
            ) : null}
          </View>

          {/* 3 — Daily goal */}
          <View style={[styles.slide, { width }]}>
            {step === 2 ? (
              <>
                <Animated.Text
                  entering={FadeInDown.duration(550)}
                  style={styles.stepTitle}
                >
                  Set your daily pace
                </Animated.Text>
                <Animated.Text
                  entering={FadeInDown.delay(80).duration(550)}
                  style={styles.stepSub}
                >
                  You can change this anytime.
                </Animated.Text>
                <View style={styles.featureList}>
                  {GOALS.map(({ minutes, label }, i) => {
                    const selected = goal === minutes;
                    return (
                      <Animated.View
                        key={minutes}
                        entering={FadeInDown.delay(140 + i * 70).duration(550)}
                      >
                        <Press onPress={() => setGoal(minutes)} scale={0.98}>
                          <View
                            style={[
                              styles.goalRow,
                              selected && styles.goalRowSelected,
                            ]}
                          >
                            <View style={styles.goalLeft}>
                              <Text style={styles.goalMinutes}>
                                {minutes} min
                              </Text>
                              <Text style={styles.goalPerDay}> / day</Text>
                            </View>
                            <View style={styles.goalRight}>
                              <Text
                                style={[
                                  styles.goalLabel,
                                  selected && styles.goalLabelSelected,
                                ]}
                              >
                                {label}
                              </Text>
                              <View
                                style={[
                                  styles.radio,
                                  selected && styles.radioSelected,
                                ]}
                              >
                                {selected ? (
                                  <CheckIcon size={11} color="#fff" />
                                ) : null}
                              </View>
                            </View>
                          </View>
                        </Press>
                      </Animated.View>
                    );
                  })}
                </View>
              </>
            ) : null}
          </View>
        </Animated.View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <View style={styles.dots}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={[styles.dot, i === step && styles.dotActive]}
            />
          ))}
        </View>
        <Press onPress={next} scale={0.97} style={{ width: "100%" }}>
          <View style={styles.cta}>
            <Text style={styles.ctaText}>
              {step === 2 ? "Start memorizing" : "Continue"}
            </Text>
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
  skipRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  skipBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  skipText: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 14,
    color: colors.textMuted,
  },
  trackClip: {
    flex: 1,
    overflow: "hidden",
  },
  track: {
    flex: 1,
    flexDirection: "row",
  },
  slide: {
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  slideCenter: {
    alignItems: "center",
  },
  logoTile: {
    width: 96,
    height: 96,
    borderRadius: 30,
    backgroundColor: tint(10),
    borderWidth: 1.5,
    borderColor: tint(22),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 28,
  },
  logoLetter: {
    fontFamily: fonts.arabicBold,
    fontSize: 44,
    color: colors.accent,
    includeFontPadding: false,
  },
  welcomeTitle: {
    fontFamily: fonts.uiBold,
    fontSize: 30,
    color: colors.ink,
    letterSpacing: -0.7,
    lineHeight: 35,
    textAlign: "center",
  },
  welcomeSub: {
    fontFamily: fonts.ui,
    fontSize: 15.5,
    color: colors.textMuted,
    marginTop: 14,
    lineHeight: 24,
    maxWidth: 300,
    textAlign: "center",
  },
  stepTitle: {
    fontFamily: fonts.uiBold,
    fontSize: 28,
    color: colors.ink,
    letterSpacing: -0.6,
    lineHeight: 33,
    marginBottom: 8,
  },
  stepSub: {
    fontFamily: fonts.ui,
    fontSize: 15,
    color: colors.textMuted,
    lineHeight: 22,
    marginBottom: 26,
  },
  featureList: {
    gap: 10,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: colors.card,
    borderRadius: 18,
    ...shadowCard,
  },
  featureIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    flexShrink: 0,
    backgroundColor: tint(9),
    alignItems: "center",
    justifyContent: "center",
  },
  featureTitle: {
    fontFamily: fonts.uiBold,
    fontSize: 15,
    color: colors.ink,
  },
  featureSub: {
    fontFamily: fonts.ui,
    fontSize: 12.5,
    color: colors.textMuted,
    marginTop: 1,
  },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 15,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.divider,
    ...shadowCard,
  },
  goalRowSelected: {
    borderColor: colors.accent,
    backgroundColor: tint(6, colors.accent),
  },
  goalLeft: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  goalMinutes: {
    fontFamily: fonts.uiBold,
    fontSize: 16,
    color: colors.ink,
  },
  goalPerDay: {
    fontFamily: fonts.ui,
    fontSize: 13,
    color: colors.textMuted,
    marginLeft: 4,
  },
  goalRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  goalLabel: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 13,
    color: colors.faint,
  },
  goalLabelSelected: {
    color: colors.accent,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  footer: {
    paddingHorizontal: 28,
    paddingTop: 18,
    gap: 22,
    alignItems: "center",
  },
  dots: {
    flexDirection: "row",
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(22,33,30,0.14)",
  },
  dotActive: {
    width: 22,
    backgroundColor: colors.accent,
  },
  cta: {
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
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
