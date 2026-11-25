import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HeadsetIcon, MicIcon } from "../../../src/components/MutoonIcons";
import { SectionRow } from "../../../src/components/SectionRow";
import { SectionSheet } from "../../../src/components/SectionSheet";
import { Cta } from "../../../src/components/ui/Cta";
import { ScreenHeader } from "../../../src/components/ui/ScreenHeader";
import {
  getMatn,
  getSectionRanges,
  type SectionRange,
} from "../../../src/lib/content/loader";
import { toMatnListItem } from "../../../src/lib/content/matnMeta";
import { reciteParams } from "../../../src/lib/recite/session";
import {
  loadMatnCoverage,
  type MatnCoverage,
} from "../../../src/lib/stats/progressStats";
import { colors, tint } from "../../../src/theme/colors";
import { fonts } from "../../../src/theme/fonts";
import { shadowCard } from "../../../src/theme/shadows";

export default function MatnScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const matn = getMatn(id);
  const matnItem = useMemo(() => toMatnListItem(matn), [matn]);
  const sections = useMemo(() => getSectionRanges(matn), [matn]);

  // Which lines have been recited. Null only until the first load: coming back
  // from a session keeps the old numbers on screen until the new ones arrive.
  const [coverage, setCoverage] = useState<MatnCoverage | null>(null);
  const [openSection, setOpenSection] = useState<SectionRange | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadMatnCoverage(id)
        .then((next) => {
          if (!cancelled) setCoverage(next);
        })
        // Without progress the page still lists the sections and opens them.
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }, [id])
  );

  const total = matnItem.totalLines;
  const lastLine = Math.max(0, total - 1);
  const done = coverage?.linesDone ?? 0;
  const nextLine = coverage?.nextLine ?? 0;
  const fraction = total > 0 ? Math.min(1, done / total) : 0;
  // "Continue" only makes sense between the first recited line and the last.
  const midway = done > 0 && nextLine < total;

  const continueReciting = () => {
    // A finished matn starts over from its first line.
    const from = nextLine >= total ? 0 : nextLine;
    router.push({
      pathname: "/matn/[id]/recite",
      // Spread into a plain object: route params need an index signature,
      // which the helper's interface type does not have.
      params: { ...reciteParams(id, from, lastLine) },
    });
  };

  const listen = () => {
    const line = Math.min(nextLine, lastLine);
    const section = sections.find((s) => line >= s.from && line <= s.to);
    if (!section) return;
    router.push({
      pathname: "/matn/[id]/listen",
      params: {
        id,
        start: String(section.from),
        end: String(section.to),
      },
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScreenHeader />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      >
        <View style={styles.top}>
          <Text style={styles.titleAr}>{matnItem.titleAr}</Text>
          <Text style={styles.title}>{matnItem.title}</Text>
          <Text style={styles.by}>
            {matnItem.author} · {matnItem.category}
          </Text>
        </View>

        {/* Progress and the two actions depend on what has been recited. Until
            that has loaded they hold their place but stay out of sight, so
            the page never shows a zero that is not true. */}
        <View
          style={coverage ? undefined : styles.pending}
          pointerEvents={coverage ? "auto" : "none"}
          accessibilityElementsHidden={!coverage}
          importantForAccessibility={coverage ? "auto" : "no-hide-descendants"}
        >
          <View style={styles.progress}>
            <View style={styles.progressRow}>
              <Text style={styles.progressText}>
                <Text style={styles.progressNum}>{done}</Text> of {total} lines
                recited
              </Text>
              <Text style={styles.progressText}>
                {Math.round(fraction * 100)}%
              </Text>
            </View>
            <View style={styles.bar}>
              <View
                style={[styles.barFill, { width: `${fraction * 100}%` }]}
              />
            </View>
          </View>

          <View style={styles.actions}>
            <Cta
              size="sm"
              style={styles.actionMain}
              icon={<MicIcon size={17} />}
              label={
                midway ? `Continue · line ${nextLine + 1}` : "Start reciting"
              }
              onPress={continueReciting}
              disabled={total === 0}
            />
            <Cta
              size="sm"
              variant="ghost"
              style={styles.actionSide}
              icon={<HeadsetIcon size={17} />}
              label="Listen"
              onPress={listen}
              disabled={total === 0}
            />
          </View>
        </View>

        {sections.length > 0 ? (
          <>
            <Text style={styles.sectionsLabel}>Sections</Text>
            <View style={styles.list}>
              {sections.map((section, i) => (
                <SectionRow
                  key={section.id}
                  titleAr={section.title_ar}
                  from={section.from}
                  to={section.to}
                  done={coverage?.sections[i]?.done}
                  color={matnItem.accentColor}
                  onPress={() => setOpenSection(section)}
                />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      <SectionSheet
        matnId={id}
        section={openSection}
        onClose={() => setOpenSection(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    direction: "ltr",
  },
  top: {
    alignItems: "center",
    paddingTop: 4,
    paddingHorizontal: 20,
  },
  titleAr: {
    fontFamily: fonts.arabicBold,
    fontSize: 30,
    lineHeight: 51,
    color: colors.ink,
    textAlign: "center",
    writingDirection: "rtl",
    includeFontPadding: false,
  },
  title: {
    fontFamily: fonts.uiBold,
    fontSize: 17,
    color: colors.ink,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  by: {
    fontFamily: fonts.ui,
    fontSize: 12.5,
    color: colors.textMuted,
    marginTop: 3,
    textAlign: "center",
  },
  pending: { opacity: 0 },
  progress: {
    marginTop: 16,
    marginHorizontal: 20,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: colors.card,
    ...shadowCard,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  progressText: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 12.5,
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
  },
  progressNum: {
    fontFamily: fonts.uiBold,
    color: colors.ink,
  },
  bar: {
    height: 6,
    borderRadius: 3,
    marginTop: 9,
    backgroundColor: tint(10),
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  actions: {
    flexDirection: "row",
    gap: 9,
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  actionMain: { flex: 1.6 },
  actionSide: { flex: 1 },
  sectionsLabel: {
    marginTop: 22,
    marginHorizontal: 24,
    marginBottom: 8,
    fontFamily: fonts.uiBold,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  list: {
    gap: 9,
    paddingTop: 2,
    paddingHorizontal: 20,
  },
});
