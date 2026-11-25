import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/fonts";

interface SlipTileProps {
  /** The Arabic word that slipped. */
  word: string;
  /** Width and height of the tile. */
  size?: number;
}

/** Small red tile showing a slipped word. */
export function SlipTile({ word, size = 40 }: SlipTileProps) {
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: Math.round(size * 0.325) },
      ]}
    >
      {/* Longer words are wider than the tile at full size, so they scale down to fit. */}
      <Text
        style={[styles.word, { fontSize: size * 0.375 }]}
        allowFontScaling={false}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {word}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexShrink: 0,
    paddingHorizontal: 3,
    backgroundColor: "rgba(217,83,74,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  word: {
    fontFamily: fonts.arabic,
    color: colors.error,
    textAlign: "center",
    writingDirection: "rtl",
    includeFontPadding: false,
  },
});
