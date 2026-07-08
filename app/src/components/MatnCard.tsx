import { StyleSheet, Text, View } from "react-native";
import type { MatnListItem } from "../lib/content/matnMeta";
import { colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { shadowCard } from "../theme/shadows";
import { ChevronRightIcon } from "./MutoonIcons";
import { Press } from "./ui/Press";
import { Ring } from "./ui/Ring";

interface MatnCardProps {
  matn: MatnListItem;
  progressLines: number;
  onPress: () => void;
}

/** Library list card — icon tile, title/author, progress ring once started. */
export function MatnCard({ matn, progressLines, onPress }: MatnCardProps) {
  const pct =
    matn.totalLines > 0
      ? Math.min(100, (progressLines / matn.totalLines) * 100)
      : 0;

  return (
    <Press onPress={onPress} scale={0.98}>
      <View style={styles.card}>
        <View
          style={[styles.icon, { backgroundColor: `${matn.accentColor}0F` }]}
        >
          <Text
            style={[styles.iconLetter, { color: matn.accentColor }]}
            allowFontScaling={false}
          >
            {matn.titleAr.charAt(0)}
          </Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>
            {matn.title}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {matn.author} · {matn.totalLines} lines
          </Text>
        </View>

        {progressLines > 0 ? (
          <Ring size={36} stroke={3.5} pct={pct} color={matn.accentColor}>
            <Text
              style={[styles.ringPct, { color: matn.accentColor }]}
              allowFontScaling={false}
            >
              {Math.round(pct)}%
            </Text>
          </Ring>
        ) : (
          <ChevronRightIcon size={15} color={colors.faint} />
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
    gap: 13,
    paddingVertical: 14,
    paddingHorizontal: 15,
    borderRadius: 20,
    backgroundColor: colors.card,
    ...shadowCard,
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  iconLetter: {
    fontFamily: fonts.arabicBold,
    fontSize: 21,
    includeFontPadding: false,
  },
  body: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: fonts.uiBold,
    fontSize: 15.5,
    color: colors.ink,
    letterSpacing: -0.2,
  },
  sub: {
    fontFamily: fonts.ui,
    fontSize: 12.5,
    color: colors.textMuted,
    marginTop: 2,
  },
  ringPct: {
    fontFamily: fonts.uiBold,
    fontSize: 9.5,
    fontVariant: ["tabular-nums"],
  },
});
