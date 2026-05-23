import {
  StyleSheet,
  Text,
  type StyleProp,
  type TextProps,
  type TextStyle,
} from "react-native";
import { colors } from "../theme/colors";
import { fonts } from "../theme/fonts";

interface ArabicTextProps extends TextProps {
  size?: "body" | "line" | "title" | "verse";
  muted?: boolean;
  inline?: boolean;
}

export function ArabicText({
  size = "body",
  muted,
  inline,
  style,
  ...rest
}: ArabicTextProps) {
  return (
    <Text
      {...rest}
      style={[
        styles.base,
        size === "title" && styles.title,
        size === "verse" && styles.verse,
        size === "line" && styles.line,
        size === "body" && styles.body,
        muted && styles.muted,
        !inline && styles.block,
        style,
      ]}
    />
  );
}

/** Block / parent line — sets RTL paragraph direction. */
export function arabicLineStyle(
  extra?: StyleProp<TextStyle>
): StyleProp<TextStyle> {
  return [
    styles.base,
    styles.verse,
    { textAlign: "right" as const, writingDirection: "rtl" as const },
    extra,
  ];
}

/** Inline word spans inside an RTL parent Text — omit writingDirection to avoid bidi fights. */
export function arabicWordStyle(
  extra?: StyleProp<TextStyle>
): StyleProp<TextStyle> {
  return [styles.verse, extra];
}

const styles = StyleSheet.create({
  base: {
    color: colors.text,
    textAlign: "right",
    writingDirection: "rtl",
    fontFamily: fonts.arabic,
    includeFontPadding: false,
  },
  block: {
    width: "100%",
    alignSelf: "stretch",
  },
  title: {
    fontSize: 28,
    lineHeight: 44,
  },
  verse: {
    fontSize: 23,
    lineHeight: 40,
  },
  line: {
    fontSize: 22,
    lineHeight: 38,
  },
  body: {
    fontSize: 17,
    lineHeight: 30,
  },
  muted: {
    color: colors.textMuted,
  },
});
