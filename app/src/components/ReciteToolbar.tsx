import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { CloseXIcon, EyeIcon, EyeOffIcon, HintIcon, MicIcon, StopIcon } from "./MutoonIcons";

interface ReciteToolbarProps {
  listening: boolean;
  hideUpcoming: boolean;
  mistakeCount: number;
  elapsedSec: number;
  accuracyPct: number;
  /** Smoothed mic RMS 0..1 while listening (speech peaks land ~0.02–0.2). */
  inputLevel?: number;
  lowInput?: boolean;
  onToggleListen: () => void;
  onToggleHideText: () => void;
  onPeek: () => void;
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

export function ReciteToolbar({
  listening,
  hideUpcoming,
  mistakeCount,
  elapsedSec,
  accuracyPct,
  inputLevel = 0,
  lowInput = false,
  onToggleListen,
  onToggleHideText,
  onPeek,
}: ReciteToolbarProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 12);

  const content = (
    <View style={[styles.row, { paddingBottom: bottomPad }]}>
      <View style={styles.timerWrap}>
        {listening ? <View style={styles.recDot} /> : null}
        <Text style={styles.timer}>{formatTime(elapsedSec)}</Text>
        {listening ? <InputMeter rms={inputLevel} low={lowInput} /> : null}
      </View>

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

      <Pressable
        style={[styles.micBtn, listening && styles.micBtnActive]}
        onPress={onToggleListen}
      >
        {listening ? <StopIcon size={16} /> : <MicIcon size={18} />}
      </Pressable>

      <View style={styles.accuracyPill}>
        <Text style={styles.accuracyText}>{accuracyPct.toFixed(1)}%</Text>
      </View>

      <View style={styles.errorsWrap}>
        <Text style={styles.errorCount}>{mistakeCount}</Text>
        <CloseXIcon />
      </View>
    </View>
  );

  return <View style={styles.wrap}>{content}</View>;
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    backgroundColor: colors.bottomBar,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 10,
    paddingHorizontal: 20,
  },
  timerWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minWidth: 56,
  },
  recDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.error,
  },
  timer: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 13,
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  meterWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
    marginLeft: 4,
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
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 4,
  },
  micBtnActive: {
    backgroundColor: colors.error,
    shadowColor: colors.error,
  },
  accuracyPill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.accentSoft,
  },
  accuracyText: {
    fontFamily: fonts.uiBold,
    fontSize: 13,
    color: colors.accent,
  },
  errorsWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    minWidth: 28,
    justifyContent: "flex-end",
  },
  errorCount: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 13,
    color: colors.error,
  },
});
