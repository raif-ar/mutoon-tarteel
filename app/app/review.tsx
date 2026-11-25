import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MicIcon } from "../src/components/MutoonIcons";
import { Cta } from "../src/components/ui/Cta";
import { LineRow } from "../src/components/ui/LineRow";
import { ScreenHeader } from "../src/components/ui/ScreenHeader";
import { flattenLines, getMatn } from "../src/lib/content/loader";
import { toMatnListItem } from "../src/lib/content/matnMeta";
import { listSlips, type SlipRow } from "../src/lib/db/database";
import { practiceParams } from "../src/lib/recite/session";
import { colors } from "../src/theme/colors";
import { fonts } from "../src/theme/fonts";
import type { FlatLineRef } from "../src/types/content";

/** A line with at least one word still to review. */
interface ReviewLine {
  /** Matn-wide index of the line as the content stands now. */
  lineIndex: number;
  text: string;
  /** Slipped words on this line. */
  words: number;
}

interface ReviewGroup {
  matnId: string;
  title: string;
  lines: ReviewLine[];
}

interface MatnLookup {
  title: string;
  linesById: Map<string, FlatLineRef>;
}

function lookupMatn(matnId: string): MatnLookup | null {
  try {
    const matn = getMatn(matnId);
    const linesById = new Map<string, FlatLineRef>();
    for (const ref of flattenLines(matn)) linesById.set(ref.line.id, ref);
    return { title: toMatnListItem(matn).title, linesById };
  } catch {
    // A slip saved against a matn that has since left the app.
    return null;
  }
}

/**
 * Slips arrive newest first; the maps keep that order, so both the matns and
 * the lines inside each come out with the most recent slip on top.
 */
function buildGroups(slips: SlipRow[]): ReviewGroup[] {
  const matns = new Map<string, MatnLookup | null>();
  const groups = new Map<string, { group: ReviewGroup; byLineId: Map<string, ReviewLine> }>();

  for (const slip of slips) {
    let matn = matns.get(slip.matn_id);
    if (matn === undefined) {
      matn = lookupMatn(slip.matn_id);
      matns.set(slip.matn_id, matn);
    }
    if (!matn) continue;
    // The text may have been corrected since the slip was saved: only keep a
    // slip whose word is still where it was.
    const ref = matn.linesById.get(slip.line_id);
    if (!ref || ref.line.words[slip.word_index] !== slip.expected_word) continue;

    let entry = groups.get(slip.matn_id);
    if (!entry) {
      entry = {
        group: { matnId: slip.matn_id, title: matn.title, lines: [] },
        byLineId: new Map(),
      };
      groups.set(slip.matn_id, entry);
    }
    const line = entry.byLineId.get(slip.line_id);
    if (line) {
      line.words += 1;
    } else {
      const added: ReviewLine = {
        lineIndex: ref.globalIndex,
        text: ref.line.text_ar,
        words: 1,
      };
      entry.byLineId.set(slip.line_id, added);
      entry.group.lines.push(added);
    }
  }

  return [...groups.values()].map((entry) => entry.group);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function SlipCount({ n }: { n: number }) {
  return (
    <View style={styles.count}>
      <Text style={styles.countText} allowFontScaling={false}>
        {n}
      </Text>
    </View>
  );
}

export default function ReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // null until the first read finishes, so the empty message never flashes.
  const [groups, setGroups] = useState<ReviewGroup[] | null>(null);

  // A practice session changes the list, so it is read again on every return.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      listSlips()
        .then((rows) => {
          if (active) setGroups(buildGroups(rows));
        })
        .catch(() => {
          // Keep what is on screen; on a first read show the empty state
          // rather than a blank page.
          if (active) setGroups((current) => current ?? []);
        });
      return () => {
        active = false;
      };
    }, [])
  );

  const practise = (matnId: string, lineIndices: number[]) => {
    router.push({
      pathname: "/matn/[id]/recite",
      // Spread into a plain object: the router's params type needs an index
      // signature, which the params interface does not carry.
      params: { ...practiceParams(matnId, lineIndices) },
    });
  };

  const lineCount = groups?.reduce((sum, g) => sum + g.lines.length, 0) ?? 0;
  const wordCount =
    groups?.reduce(
      (sum, g) => sum + g.lines.reduce((words, l) => words + l.words, 0),
      0
    ) ?? 0;
  const showTitles = (groups?.length ?? 0) > 1;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Review"
        subtitle={
          lineCount > 0
            ? `${plural(wordCount, "word")} in ${plural(lineCount, "line")}`
            : undefined
        }
      />

      {groups == null ? null : lineCount === 0 ? (
        <Text style={styles.empty}>
          Nothing to review.{"\n"}Words you miss while reciting collect here.
        </Text>
      ) : (
        <>
          <Text style={styles.hint}>
            Lines where a word slipped. Recite a line cleanly and it leaves
            this list.
          </Text>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.list,
              { paddingBottom: insets.bottom + 24 },
            ]}
          >
            {groups.map((group) => (
              <View key={group.matnId}>
                {showTitles ? (
                  <Text
                    style={styles.groupTitle}
                    numberOfLines={1}
                    accessibilityRole="header"
                  >
                    {group.title}
                  </Text>
                ) : null}
                <View style={styles.rows}>
                  {group.lines.map((line) => (
                    <LineRow
                      key={line.lineIndex}
                      number={line.lineIndex + 1}
                      text={line.text}
                      right={<SlipCount n={line.words} />}
                      accessibilityLabel={`Line ${line.lineIndex + 1}, ${plural(line.words, "slip")}`}
                      onPress={() => practise(group.matnId, [line.lineIndex])}
                    />
                  ))}
                </View>
                <View style={styles.cta}>
                  <Cta
                    icon={<MicIcon size={18} />}
                    label={
                      group.lines.length === 1
                        ? "Practice this line"
                        : `Practice all ${group.lines.length} lines`
                    }
                    onPress={() =>
                      practise(
                        group.matnId,
                        group.lines.map((l) => l.lineIndex)
                      )
                    }
                  />
                </View>
              </View>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    direction: "ltr",
    backgroundColor: colors.bg,
  },
  hint: {
    fontFamily: fonts.ui,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  list: {
    paddingHorizontal: 16,
    gap: 28,
  },
  groupTitle: {
    fontFamily: fonts.uiBold,
    fontSize: 14.5,
    color: colors.ink,
    paddingHorizontal: 4,
    marginBottom: 10,
  },
  rows: {
    gap: 6,
  },
  // The button sits 20 from the screen edge, 4 in from the rows.
  cta: {
    paddingTop: 16,
    paddingHorizontal: 4,
  },
  count: {
    flexShrink: 0,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 9,
    backgroundColor: "rgba(217,83,74,0.08)",
  },
  countText: {
    fontFamily: fonts.uiBold,
    fontSize: 11,
    lineHeight: 16,
    color: colors.error,
    fontVariant: ["tabular-nums"],
  },
  empty: {
    fontFamily: fonts.ui,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 32,
    marginHorizontal: 20,
  },
});
