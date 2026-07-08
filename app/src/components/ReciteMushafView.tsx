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
import { Waveform } from "./ui/Waveform";
import { colors, tint } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { shadowCard } from "../theme/shadows";

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
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 150), animated: true });
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
        const lineHasMistake = ref.line.words.some((_, wi) =>
          mistakeGlobalIndices.has(lineWordStart + wi)
        );
        const lineNum = lineIndex + 1;
        const showSection =
          lineIndex === 0 ||
          lines[lineIndex - 1].sectionTitle !== ref.sectionTitle;

        const lineEl = (
          <View
            key={ref.line.id}
            style={[styles.verseCard, isActiveLine && styles.verseCardActive]}
          >
            {/* badge */}
            <View
              style={[
                styles.badge,
                isActiveLine && styles.badgeActive,
                isDoneLine && styles.badgeDone,
              ]}
            >
              {isDoneLine ? (
                <CheckIcon
                  size={12}
                  color={lineHasMistake ? colors.amber : colors.accent}
                />
              ) : (
                <Text
                  style={[styles.badgeNum, isActiveLine && styles.badgeNumActive]}
                  allowFontScaling={false}
                >
                  {String(lineNum)}
                </Text>
              )}
            </View>

            {/* text */}
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
                        state === "upcoming" &&
                          (isActiveLine
                            ? styles.upcomingActiveLineWord
                            : styles.upcomingWord),
                        state === "recited" &&
                          (isDoneLine ? styles.doneLineWord : styles.recitedWord),
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

            {isActiveLine && listening ? (
              <View style={styles.waveWrap}>
                <Waveform
                  active
                  bars={3}
                  height={11}
                  width={2.5}
                  color={tint(60)}
                />
              </View>
            ) : null}
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
            {showSection && ref.sectionTitle ? (
              <View style={styles.sectionRow}>
                <View style={styles.sectionDivider} />
                <View style={styles.sectionChip}>
                  <Text style={styles.sectionChipText} allowFontScaling={false}>
                    {ref.sectionTitle}
                  </Text>
                </View>
              </View>
            ) : null}
            {lineEl}
          </View>
        );
      })}
      <View style={{ height: 140 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: {
    paddingTop: 10,
    paddingBottom: 24,
  },
  sectionRow: {
    flexDirection: "row-reverse",
    direction: "ltr",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 8,
  },
  sectionChip: {
    paddingVertical: 4,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: tint(8),
  },
  sectionChipText: {
    fontFamily: fonts.arabic,
    fontSize: 13,
    color: colors.accent,
    includeFontPadding: false,
  },
  sectionDivider: {
    flex: 1,
    height: 1,
    backgroundColor: colors.divider,
  },
  verseCard: {
    position: "relative",
    marginHorizontal: 16,
    marginVertical: 3,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 18,
    flexDirection: "row-reverse",
    direction: "ltr",
    alignItems: "flex-start",
    gap: 12,
  },
  verseCardActive: {
    backgroundColor: tint(7, colors.accent),
    borderWidth: 1.5,
    borderColor: tint(28),
    ...shadowCard,
  },
  waveWrap: {
    position: "absolute",
    top: 12,
    left: 12,
  },
  badge: {
    width: 25,
    height: 25,
    borderRadius: 13,
    flexShrink: 0,
    marginTop: 10,
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
    backgroundColor: tint(11),
    borderWidth: 0,
  },
  badgeNum: {
    fontFamily: fonts.uiBold,
    fontSize: 11.5,
    color: colors.faint,
    textAlign: "center",
    includeFontPadding: false,
    fontVariant: ["tabular-nums"],
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
    color: colors.ink,
    textAlign: "right",
    writingDirection: "rtl",
    includeFontPadding: false,
  },
  upcomingWord: {
    color: "rgba(22,33,30,0.8)",
  },
  upcomingActiveLineWord: {
    color: "rgba(22,33,30,0.32)",
  },
  recitedWord: {
    color: colors.accent,
  },
  doneLineWord: {
    color: "rgba(22,33,30,0.42)",
  },
  currentWord: {
    color: colors.accent,
    backgroundColor: tint(10),
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
    backgroundColor: tint(10),
    borderRadius: 4,
  },
});
