import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { WhorlMark } from "./WhorlMark";

interface BrandWordmarkProps {
  /** Font size of the wordmark text. */
  size?: number;
  /** Light treatment for dark surfaces ("Matn" white, "Hifdh" mint). */
  light?: boolean;
}

/** MatnHifdh two-tone wordmark. */
export function BrandWordmark({ size = 24, light }: BrandWordmarkProps) {
  return (
    <Text
      style={[styles.wordmark, { fontSize: size }]}
      allowFontScaling={false}
    >
      <Text style={{ color: light ? "#fff" : colors.ink }}>Matn</Text>
      <Text style={{ color: light ? "#6FD5C2" : colors.accent }}>Hifdh</Text>
    </Text>
  );
}

interface BrandLockupProps {
  /** Mark size; wordmark scales to ~2/3 of it. */
  size?: number;
  light?: boolean;
}

/** Primary lockup — the whorl mark beside the MatnHifdh wordmark. */
export function BrandLockup({ size = 36, light }: BrandLockupProps) {
  return (
    <View style={styles.row}>
      <WhorlMark
        size={size}
        color={light ? "#fff" : colors.accent}
        strokeWidth={5}
        variant="full"
      />
      <BrandWordmark size={size * 0.67} light={light} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  wordmark: {
    fontFamily: fonts.brand,
    letterSpacing: -0.5,
    includeFontPadding: false,
  },
});
