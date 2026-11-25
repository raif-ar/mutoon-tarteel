import { StyleSheet, Text, View } from "react-native";
import { colors, tint } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { shadowCard } from "../theme/shadows";
import { CheckIcon, ChevronLeftIcon } from "./MutoonIcons";
import { Press } from "./ui/Press";
import { Ring } from "./ui/Ring";

interface SectionRowProps {
  /** The section's Arabic title. */
  titleAr: string;
  /** First and last line of the section (matn-wide indices, inclusive). */
  from: number;
  to: number;
  /** Lines of the section recited so far. Leave out while progress is loading. */
  done?: number;
  /** Colour of the ring on a partly recited section. */
  color?: string;
  onPress: () => void;
}

/** A section of a matn: its title, its lines and how much of it is recited. */
export function SectionRow({
  titleAr,
  from,
  to,
  done,
  color = colors.accent,
  onPress,
}: SectionRowProps) {
  const total = to - from + 1;
  const known = done != null;
  const recited = done ?? 0;
  const complete = known && recited >= total;
  const partial = recited > 0 && recited < total;
  const sub = `Lines ${from + 1}–${to + 1}${
    partial ? ` · ${recited} of ${total} done` : ""
  }`;

  return (
    <Press
      onPress={onPress}
      scale={0.98}
      accessibilityLabel={`${titleAr}, ${sub}${complete ? ", done" : ""}`}
    >
      <View style={styles.card}>
        {/* The chevron leads because the row reads right to left. */}
        <ChevronLeftIcon size={15} color={colors.faint} />

        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>
            {titleAr}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        </View>

        {complete ? (
          <View style={[styles.state, styles.stateDone]}>
            <CheckIcon size={14} />
          </View>
        ) : partial ? (
          <Ring
            size={30}
            stroke={3}
            pct={(recited / total) * 100}
            color={color}
          >
            <Text style={[styles.count, { color }]} allowFontScaling={false}>
              {recited}
            </Text>
          </Ring>
        ) : (
          // Nothing is drawn until the progress is known, so an untouched
          // section never flashes before its real state.
          <View style={[styles.state, known && styles.stateNone]} />
        )}
      </View>
    </Press>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    direction: "ltr",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 20,
    backgroundColor: colors.card,
    ...shadowCard,
  },
  body: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: fonts.arabicBold,
    fontSize: 17,
    lineHeight: 29,
    color: colors.ink,
    textAlign: "right",
    writingDirection: "rtl",
    includeFontPadding: false,
  },
  sub: {
    fontFamily: fonts.ui,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "right",
  },
  state: {
    width: 30,
    height: 30,
    borderRadius: 15,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  stateDone: { backgroundColor: tint(12) },
  stateNone: { borderWidth: 1.5, borderColor: colors.divider },
  count: {
    fontFamily: fonts.uiBold,
    fontSize: 9,
    fontVariant: ["tabular-nums"],
  },
});
