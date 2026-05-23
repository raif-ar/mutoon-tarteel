import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArabicText } from "../../../src/components/ArabicText";
import { ChevronLeftIcon, ChevronRightIcon } from "../../../src/components/MutoonIcons";
import {
  flattenLines,
  getMatn,
  listSectionStarts,
} from "../../../src/lib/content/loader";
import { toMatnListItem } from "../../../src/lib/content/matnMeta";
import { colors } from "../../../src/theme/colors";
import { fonts } from "../../../src/theme/fonts";

export default function SessionStartScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const matn = getMatn(id);
  const matnItem = useMemo(() => toMatnListItem(matn), [matn]);
  const allLines = useMemo(() => flattenLines(matn), [matn]);
  const sections = useMemo(() => listSectionStarts(matn), [matn]);
  const lastLineIndex = Math.max(0, allLines.length - 1);

  const beginSession = (startLineIndex: number) => {
    router.replace({
      pathname: "/matn/[id]/recite",
      params: {
        id,
        start: String(startLineIndex),
        end: String(lastLineIndex),
      },
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          style={styles.headerBtn}
          onPress={() => router.back()}
          hitSlop={8}
        >
          <ChevronLeftIcon />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{matnItem.title}</Text>
          <Text style={styles.headerSub}>Where do you want to begin?</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <Text style={styles.hint}>
        Pick a section to start from. You will recite from that point through the
        end of the matn.
      </Text>

      <FlatList
        data={sections}
        keyExtractor={(s) => s.sectionId}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <Pressable
            style={({ pressed }) => [
              styles.sectionRow,
              pressed && styles.sectionRowPressed,
            ]}
            onPress={() => beginSession(item.lineIndex)}
          >
            <View style={styles.sectionNum}>
              <Text style={styles.sectionNumText}>{index + 1}</Text>
            </View>
            <View style={styles.sectionBody}>
              <ArabicText size="body" style={styles.sectionTitle}>
                {item.titleAr}
              </ArabicText>
              <Text style={styles.sectionMeta}>
                Line {item.lineIndex + 1} · {item.lineCount} lines
              </Text>
            </View>
            <ChevronRightIcon size={16} color={colors.textMuted} />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 10,
    gap: 8,
  },
  headerBtn: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: {
    fontFamily: fonts.uiBold,
    fontSize: 19,
    color: colors.text,
    textAlign: "center",
  },
  headerSub: {
    fontFamily: fonts.ui,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: "center",
  },
  hint: {
    fontFamily: fonts.ui,
    fontSize: 13,
    color: colors.textMuted,
    paddingHorizontal: 20,
    paddingBottom: 12,
    lineHeight: 19,
  },
  list: {
    paddingHorizontal: 16,
    gap: 8,
  },
  sectionRow: {
    flexDirection: "row",
    direction: "ltr",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionRowPressed: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentBorder,
  },
  sectionNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionNumText: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 12,
    color: colors.accent,
  },
  sectionBody: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-end",
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 28,
  },
  sectionMeta: {
    fontFamily: fonts.ui,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: "right",
  },
});
