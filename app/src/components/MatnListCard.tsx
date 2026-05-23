import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MatnListItem } from "../lib/content/matnMeta";
import { colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import { ChevronRightIcon } from "./MutoonIcons";

interface MatnListCardProps {
  matn: MatnListItem;
  progressLines: number;
  onPress: () => void;
}

export function MatnListCard({ matn, progressLines, onPress }: MatnListCardProps) {
  const inProgress = progressLines > 0;
  const pct =
    matn.totalLines > 0
      ? Math.min(100, (progressLines / matn.totalLines) * 100)
      : 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
    >
      <View
        style={[
          styles.icon,
          { backgroundColor: `${matn.accentColor}10` },
        ]}
      >
        <Text style={[styles.iconLetter, { color: matn.accentColor }]}>
          {matn.titleAr.charAt(0)}
        </Text>
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{matn.title}</Text>
          {inProgress ? (
            <View
              style={[
                styles.badge,
                { backgroundColor: `${matn.accentColor}12` },
              ]}
            >
              <Text style={[styles.badgeText, { color: matn.accentColor }]}>
                In Progress
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.author}>{matn.author}</Text>
        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${pct}%`, backgroundColor: matn.accentColor },
              ]}
            />
          </View>
          <Text style={styles.progressLabel}>
            {inProgress
              ? `${progressLines} of ${matn.totalLines}`
              : `${matn.totalLines} lines`}
          </Text>
        </View>
      </View>

      <ChevronRightIcon />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  cardPressed: {
    opacity: 0.96,
    transform: [{ scale: 0.99 }],
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  iconLetter: {
    fontFamily: fonts.arabicBold,
    fontSize: 20,
  },
  body: { flex: 1, minWidth: 0 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 2,
    flexWrap: "wrap",
  },
  title: {
    fontFamily: fonts.uiBold,
    fontSize: 15,
    color: colors.text,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 10,
  },
  author: {
    fontFamily: fonts.ui,
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 8,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(0,0,0,0.05)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
  progressLabel: {
    fontFamily: fonts.ui,
    fontSize: 11,
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
  },
});
