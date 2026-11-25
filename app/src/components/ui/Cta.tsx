import type { ReactNode } from "react";
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { shadowCard } from "../../theme/shadows";
import { Press } from "./Press";

interface CtaProps {
  label: string;
  onPress?: () => void;
  /** "primary": accent fill, white label. "ghost": card fill, ink label. */
  variant?: "primary" | "ghost";
  /** "lg": 54 high, the main action of a screen. "sm": 46 high, for rows and cards. */
  size?: "lg" | "sm";
  /** Shown before the label. The caller picks its colour to suit the variant. */
  icon?: ReactNode;
  disabled?: boolean;
  /** Defaults to the label. */
  accessibilityLabel?: string;
  /** Applied to the outer wrapper, e.g. `{ flex: 1 }` inside a row. */
  style?: StyleProp<ViewStyle>;
}

/** The app's button. Fills its parent's width unless `style` says otherwise. */
export function Cta({
  label,
  onPress,
  variant = "primary",
  size = "lg",
  icon,
  disabled = false,
  accessibilityLabel,
  style,
}: CtaProps) {
  const ghost = variant === "ghost";
  const small = size === "sm";

  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? label}
      // The wrapper carries the width: stretch also works under a parent that
      // centers its children, and a row can override it with flex.
      style={[styles.wrap, style]}
    >
      <View
        style={[
          styles.base,
          small ? styles.sm : styles.lg,
          ghost ? styles.ghost : styles.primary,
          disabled && styles.disabled,
        ]}
      >
        {icon}
        <Text
          style={[
            styles.label,
            small && styles.labelSm,
            ghost && styles.labelGhost,
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {label}
        </Text>
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "stretch",
  },
  base: {
    flexDirection: "row",
    direction: "ltr",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  lg: {
    height: 54,
    borderRadius: 27,
    paddingHorizontal: 18,
  },
  sm: {
    height: 46,
    borderRadius: 15,
    paddingHorizontal: 12,
  },
  primary: {
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  ghost: {
    backgroundColor: colors.card,
    ...shadowCard,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    flexShrink: 1,
    fontFamily: fonts.uiBold,
    fontSize: 16,
    color: "#fff",
    textAlign: "center",
  },
  labelSm: {
    fontSize: 14.5,
  },
  labelGhost: {
    color: colors.ink,
  },
});
