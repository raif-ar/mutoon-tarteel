import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, tint } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { shadowFloat } from "../theme/shadows";
import { EyeIcon, EyeOffIcon, HintIcon, MicIcon, StopIcon } from "./MutoonIcons";
import { Press } from "./ui/Press";

interface ReciteToolbarProps {
  listening: boolean;
  hideUpcoming: boolean;
  mistakeCount: number;
  elapsedSec: number;
  accuracyPct: number;
  /** Smoothed mic RMS 0..1 while listening (speech peaks land ~0.02–0.2). */
  inputLevel?: number;
  lowInput?: boolean;
  canFinish?: boolean;
  onToggleListen: () => void;
  onToggleHideText: () => void;
  onPeek: () => void;
  onFinish?: () => void;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const METER_BARS = 5;

/**
 * Map RMS to lit bars on a log-ish scale: normal recitation should light 2–4
 * bars; 0–1 bars sustained means the mic is too far / too quiet.
 */
function litBars(rms: number): number {
  if (rms <= 0.004) return 0;
  if (rms <= 0.01) return 1;
  if (rms <= 0.025) return 2;
  if (rms <= 0.06) return 3;
  if (rms <= 0.12) return 4;
  return 5;
}

function InputMeter({ rms, low }: { rms: number; low: boolean }) {
  const lit = litBars(rms);
  return (
    <View style={styles.meterWrap} accessibilityLabel="Microphone input level">
      {Array.from({ length: METER_BARS }, (_, i) => (
        <View
          key={i}
          style={[
            styles.meterBar,
            { height: 5 + i * 3 },
            i < lit && (low ? styles.meterBarLow : styles.meterBarLit),
          ]}
        />
      ))}
    </View>
  );
}

/** Floating control capsule pinned above the bottom safe area. */
export function ReciteToolbar({
  listening,
  hideUpcoming,
  elapsedSec,
  accuracyPct,
  inputLevel = 0,
  lowInput = false,
  canFinish = false,
  onToggleListen,
  onToggleHideText,
  onPeek,
  onFinish,
}: ReciteToolbarProps) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 14) + 10;

  return (
    <View style={[styles.capsule, { bottom }]}>
      {Platform.OS === "ios" ? (
        <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />
      ) : null}
      <View style={styles.row}>
        {/* timer + live level */}
        <View style={styles.timerWrap}>
          <View style={[styles.recDot, listening && styles.recDotLive]} />
          <Text style={styles.timer}>{formatTime(elapsedSec)}</Text>
          {listening ? <InputMeter rms={inputLevel} low={lowInput} /> : null}
        </View>

        <View style={styles.spacer} />

        <Pressable
          style={[styles.sideBtn, !hideUpcoming && styles.sideBtnActive]}
          onPress={onToggleHideText}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={hideUpcoming ? "Show text" : "Hide text"}
        >
          {hideUpcoming ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
        </Pressable>

        <Pressable
          style={styles.sideBtn}
          onPress={onPeek}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Hint next word"
        >
          <HintIcon size={17} />
        </Pressable>

        {/* mic */}
        <Press onPress={onToggleListen} scale={0.9} accessibilityLabel={listening ? "Stop listening" : "Start listening"}>
          <View style={[styles.micBtn, listening && styles.micBtnActive]}>
            {listening ? (
              <StopIcon size={20} color="#fff" />
            ) : (
              <MicIcon size={22} color="#fff" />
            )}
          </View>
        </Press>

        {/* accuracy */}
        <View
          style={[styles.accuracyPill, elapsedSec === 0 && { opacity: 0.4 }]}
        >
          <Text style={styles.accuracyText}>{accuracyPct.toFixed(1)}%</Text>
        </View>

        <View style={styles.spacer} />

        {/* finish */}
        <Pressable
          onPress={canFinish ? onFinish : undefined}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Finish session"
        >
          <Text
            style={[styles.finishText, !canFinish && styles.finishTextDisabled]}
          >
            Finish
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  capsule: {
    position: "absolute",
    left: 16,
    right: 16,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.capsule,
    borderWidth: 1,
    borderColor: colors.capsuleBorder,
    overflow: Platform.OS === "ios" ? "hidden" : "visible",
    ...shadowFloat,
  },
  row: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 9,
  },
  spacer: { flex: 1 },
  timerWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  recDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.faint,
  },
  recDotLive: {
    backgroundColor: colors.error,
  },
  timer: {
    fontFamily: fonts.uiBold,
    fontSize: 14,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  meterWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
    marginLeft: 3,
    height: 17,
  },
  meterBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: colors.divider,
  },
  meterBarLit: {
    backgroundColor: colors.accent,
  },
  meterBarLow: {
    backgroundColor: colors.warning,
  },
  sideBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: colors.divider,
    alignItems: "center",
    justifyContent: "center",
  },
  sideBtnActive: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
  micBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 9,
    elevation: 5,
  },
  micBtnActive: {
    backgroundColor: colors.error,
    shadowColor: colors.error,
  },
  accuracyPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: tint(8),
  },
  accuracyText: {
    fontFamily: fonts.uiBold,
    fontSize: 13.5,
    color: colors.accent,
    fontVariant: ["tabular-nums"],
  },
  finishText: {
    fontFamily: fonts.uiBold,
    fontSize: 14,
    color: colors.ink,
  },
  finishTextDisabled: {
    color: colors.faint,
  },
});
