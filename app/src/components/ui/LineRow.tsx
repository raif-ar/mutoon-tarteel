import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { ArabicText } from "../ArabicText";

interface LineRowProps {
  /** Shown in the circle: the line's 1-based number in the matn. */
  number: number | string;
  /** The Arabic line. */
  text: string;
  onPress?: () => void;
  /** Trailing content after the text, e.g. a slip count badge. */
  right?: ReactNode;
  /** Defaults to "Line {number}". */
  accessibilityLabel?: string;
}

/** A tappable matn line: number in a circle, then the Arabic text. */
export function LineRow({
  number,
  text,
  onPress,
  right,
  accessibilityLabel,
}: LineRowProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? `Line ${number}`}
    >
      <View style={styles.num}>
        <Text style={styles.numText} allowFontScaling={false}>
          {number}
        </Text>
      </View>
      <ArabicText size="body" style={styles.text}>
        {text}
      </ArabicText>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A plain LTR row keeps the number on the left on every device; the text
  // itself runs right to left.
  row: {
    flexDirection: "row",
    direction: "ltr",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentBorder,
  },
  num: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  numText: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 12,
    color: colors.accent,
    fontVariant: ["tabular-nums"],
  },
  text: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 17,
    lineHeight: 30,
    textAlign: "right",
  },
});
