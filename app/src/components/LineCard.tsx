import { Pressable, StyleSheet, Text } from "react-native";
import type { MatnLine } from "../types/content";
import { ArabicText, arabicLineStyle } from "./ArabicText";
import { colors } from "../theme/colors";

interface LineCardProps {
  line: MatnLine;
  hidden?: boolean;
  revealedWordCount?: number;
  highlightMistakeIndices?: number[];
  onPress?: () => void;
}

export function LineCard({
  line,
  hidden,
  revealedWordCount = 0,
  highlightMistakeIndices = [],
  onPress,
}: LineCardProps) {
  if (hidden) {
    const visible = line.words.slice(0, revealedWordCount);
    const hiddenRest = line.words.length - revealedWordCount;
    const dots = hiddenRest > 0 ? ` ${"•".repeat(Math.min(hiddenRest, 8))}` : "";
    return (
      <Pressable onPress={onPress} style={styles.card}>
        <ArabicText size="line">
          {visible.length > 0 ? `${visible.join(" ")}${dots}` : dots || " "}
        </ArabicText>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} style={styles.card}>
      <Text style={styles.lineText}>
        {line.words.map((word, i) => {
          const bad = highlightMistakeIndices.includes(i);
          return (
            <Text
              key={`${line.id}-${i}`}
              style={arabicLineStyle(bad && styles.mistakeWord)}
            >
              {word}{" "}
            </Text>
          );
        })}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: "stretch",
  },
  lineText: {
    width: "100%",
    textAlign: "right",
    writingDirection: "rtl",
  },
  mistakeWord: {
    color: colors.error,
    textDecorationLine: "underline",
  },
});
