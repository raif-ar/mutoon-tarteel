import { useEffect, useMemo, useRef } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import type { WordMistake } from "../lib/asr/align";
import type { FlatLineRef } from "../types/content";
import { arabicWordStyle } from "./ArabicText";
import { CheckIcon } from "./MutoonIcons";
import { colors } from "../theme/colors";
import { fonts } from "../theme/fonts";

type WordState =
  | "hidden"
  | "hiddenCurrent"
  | "upcoming"
  | "current"
  | "recited"
  | "mistake";

function wordState(
  globalIndex: number,
  activeWordCursor: number,
  hideUpcoming: boolean,
  mistakeGlobalIndices: Set<number>
): WordState {
  if (mistakeGlobalIndices.has(globalIndex)) return "mistake";
  if (globalIndex < activeWordCursor) return "recited";
  if (globalIndex === activeWordCursor) {
    // Hide mode must hide the word being tested too — revealing it here would
    // hand the reciter the answer. It renders as an accented dot so the
    // position is still visible; Peek is the deliberate escape hatch.
    return hideUpcoming ? "hiddenCurrent" : "current";
  }
  return hideUpcoming ? "hidden" : "upcoming";
}

interface ReciteMushafViewProps {
  lines: FlatLineRef[];
  activeWordCursor: number;
  mistakes: WordMistake[];
  hideUpcoming?: boolean;
  listening?: boolean;
  style?: ViewStyle;
}

export function ReciteMushafView({
  lines,
  activeWordCursor,
  mistakes,
  hideUpcoming = false,
  listening = false,
  style,
}: ReciteMushafViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  const lineOffsets = useRef<number[]>([]);

  const mistakeGlobalIndices = useMemo(() => {
    const set = new Set<number>();
    for (const m of mistakes) {
      if (m.globalWordIndex != null) set.add(m.globalWordIndex);
    }
    return set;
  }, [mistakes]);

  const activeLineIndex = useMemo(() => {
    let g = 0;
    for (let li = 0; li < lines.length; li++) {
      const count = lines[li].line.words.length;
      if (activeWordCursor < g + count) return li;
      g += count;
    }
    return lines.length;
  }, [lines, activeWordCursor]);

  useEffect(() => {
    const y = lineOffsets.current[activeLineIndex];
    if (y != null) {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
    }
  }, [activeLineIndex]);

  let runningGlobal = 0;

  return (
    <ScrollView
      ref={scrollRef}
      style={[styles.scroll, style]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {lines.map((ref, lineIndex) => {
        const lineWordStart = runningGlobal;
        const wordCount = ref.line.words.length;
        const lineEnd = lineWordStart + wordCount;
        const isActiveLine =
          activeWordCursor >= lineWordStart && activeWordCursor < lineEnd;
        const isDoneLine = activeWordCursor >= lineEnd;
        const lineNum = lineIndex + 1;

        const lineEl = (
          <View
            key={ref.line.id}
            style={[
              styles.verseRow,
              isActiveLine && styles.verseRowActive,
              isDoneLine && styles.verseRowDone,
            ]}
          >
            {isActiveLine && listening ? (
              <View style={styles.pulseDot} />
            ) : null}

            <View style={styles.badgeWrap}>
              <View
                style={[
                  styles.badge,
                  isActiveLine && styles.badgeActive,
                  isDoneLine && styles.badgeDone,
                ]}
              >
                {isDoneLine ? (
                  <CheckIcon size={14} color={colors.accent} />
                ) : (
                  <Text
                    style={[
                      styles.badgeNum,
                      isActiveLine && styles.badgeNumActive,
                    ]}
                    allowFontScaling={false}
                  >
                    {String(lineNum)}
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.lineTextWrap}>
              <View style={styles.wordRow}>
                {ref.line.words.map((word, wordIndex) => {
                  const globalIndex = runningGlobal;
                  runningGlobal += 1;
                  const state = wordState(
                    globalIndex,
                    activeWordCursor,
                    hideUpcoming,
                    mistakeGlobalIndices
                  );
                  if (state === "hidden" || state === "hiddenCurrent") {
                    return (
                      <Text
                        key={`${ref.line.id}-${wordIndex}`}
                        style={arabicWordStyle([
                          styles.hiddenWord,
                          state === "hiddenCurrent" && styles.hiddenCurrentWord,
                        ])}
                        allowFontScaling={false}
                      >
                        •
                      </Text>
                    );
                  }
                  return (
                    <Text
                      key={`${ref.line.id}-${wordIndex}`}
                      allowFontScaling={false}
                      style={arabicWordStyle([
                        styles.word,
                        state === "recited" && styles.recitedWord,
                        state === "current" && styles.currentWord,
                        state === "mistake" && styles.mistakeWord,
                      ])}
                    >
                      {word}
                    </Text>
                  );
                })}
              </View>
            </View>

            <View style={styles.divider} />
          </View>
        );

        return (
          <View
            key={`block-${ref.line.id}`}
            onLayout={(e) => {
              // Y relative to ScrollView content (block is a direct child), not the inner verse row.
              lineOffsets.current[lineIndex] = e.nativeEvent.layout.y;
            }}
          >
            {lineEl}
          </View>
        );
      })}
      <View style={{ height: 16 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingTop: 4,
    paddingBottom: 24,
  },
  verseRow: {
    position: "relative",
    paddingVertical: 12,
    paddingHorizontal: 20,
    flexDirection: "row-reverse",
    direction: "ltr",
    alignItems: "flex-start",
    gap: 12,
  },
  verseRowActive: {
    backgroundColor: colors.accentMid,
  },
  verseRowDone: {
    backgroundColor: colors.recitedGlow,
  },
  pulseDot: {
    position: "absolute",
    top: 14,
    left: 20,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  badgeWrap: {
    marginTop: 8,
    flexShrink: 0,
  },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.divider,
  },
  badgeActive: {
    backgroundColor: colors.accent,
    borderWidth: 0,
  },
  badgeDone: {
    backgroundColor: `${colors.accent}18`,
    borderColor: colors.accentBorder,
  },
  badgeNum: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.verseNum,
    textAlign: "center",
    includeFontPadding: false,
  },
  badgeNumActive: {
    color: "#fff",
  },
  lineTextWrap: {
    flex: 1,
    flexGrow: 1,
    minWidth: 0,
    marginTop: 4,
    direction: "ltr",
  },
  wordRow: {
    width: "100%",
    flexDirection: "row-reverse",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    alignItems: "center",
    columnGap: 6,
    rowGap: 4,
    direction: "ltr",
  },
  word: {
    fontFamily: fonts.arabic,
    fontSize: 23,
    lineHeight: 40,
    color: colors.text,
    textAlign: "right",
    writingDirection: "rtl",
    includeFontPadding: false,
  },
  divider: {
    position: "absolute",
    bottom: 0,
    left: 58,
    right: 20,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
  },
  recitedWord: {
    color: colors.text,
  },
  currentWord: {
    color: colors.accent,
    backgroundColor: colors.accentMid,
    borderRadius: 4,
  },
  mistakeWord: {
    color: colors.error,
    textDecorationLine: "underline",
    fontFamily: fonts.arabicBold,
  },
  hiddenWord: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 40,
    paddingHorizontal: 2,
  },
  hiddenCurrentWord: {
    color: colors.accent,
    fontSize: 18,
    backgroundColor: colors.accentMid,
    borderRadius: 4,
  },
});
