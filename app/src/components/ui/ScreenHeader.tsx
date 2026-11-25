import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { ChevronLeftIcon } from "../MutoonIcons";

interface ScreenHeaderProps {
  /** Centered title, one line. Leave out for a header with only the back chevron. */
  title?: string;
  /**
   * Line under the title. It is rendered inside the subtitle text, so pass a
   * string or text with nested `<Text>` spans (no Views).
   */
  subtitle?: ReactNode;
  /** Defaults to going back one screen. */
  onBack?: () => void;
  /** Trailing slot, e.g. a small icon button. */
  right?: ReactNode;
}

/**
 * Header row of a pushed screen: back chevron, centered title and subtitle,
 * optional trailing slot. The screen root still owns the top safe-area padding.
 */
export function ScreenHeader({
  title,
  subtitle,
  onBack,
  right,
}: ScreenHeaderProps) {
  const router = useRouter();
  const hasSubtitle =
    subtitle != null && subtitle !== false && subtitle !== "";

  return (
    <View style={styles.row}>
      <Pressable
        style={styles.side}
        onPress={onBack ?? (() => router.back())}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <ChevronLeftIcon />
      </Pressable>
      <View style={styles.center}>
        {title ? (
          <Text
            style={styles.title}
            numberOfLines={1}
            accessibilityRole="header"
          >
            {title}
          </Text>
        ) : null}
        {hasSubtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {/* Same width as the back button even when empty, so the title stays centered. */}
      <View style={styles.side}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    direction: "ltr",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 10,
    gap: 8,
  },
  side: {
    minWidth: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  center: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
  },
  title: {
    fontFamily: fonts.uiBold,
    fontSize: 19,
    color: colors.text,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: fonts.ui,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: "center",
  },
});
