import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LineRow } from "../../../src/components/ui/LineRow";
import { ScreenHeader } from "../../../src/components/ui/ScreenHeader";
import { flattenLines, getMatn } from "../../../src/lib/content/loader";
import { toMatnListItem } from "../../../src/lib/content/matnMeta";
import { colors } from "../../../src/theme/colors";
import { fonts } from "../../../src/theme/fonts";
import type { FlatLineRef } from "../../../src/types/content";

/** How often the opening scroll is tried again while rows are still being measured. */
const SCROLL_RETRIES = 5;
const SCROLL_RETRY_MS = 60;

export default function SessionStartScreen() {
  const { id, at } = useLocalSearchParams<{ id: string; at?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const matn = getMatn(id);
  const matnItem = useMemo(() => toMatnListItem(matn), [matn]);
  const allLines = useMemo(() => flattenLines(matn), [matn]);
  const lastLineIndex = Math.max(0, allLines.length - 1);

  // The line to open on (matn-wide index), e.g. the first line of a section.
  // 0 means the list simply starts at the top.
  const openAt = useMemo(() => {
    const n = Number(at);
    if (at == null || at === "" || !Number.isInteger(n)) return 0;
    return Math.max(0, Math.min(lastLineIndex, n));
  }, [at, lastLineIndex]);

  const listRef = useRef<FlatList<FlatLineRef>>(null);
  const scrolledToOpenAt = useRef(false);
  const retriesLeft = useRef(SCROLL_RETRIES);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    []
  );

  // Runs once, as soon as the list has content to scroll.
  const scrollToOpenAt = () => {
    if (scrolledToOpenAt.current || openAt === 0) return;
    scrolledToOpenAt.current = true;
    listRef.current?.scrollToIndex({ index: openAt, animated: false });
  };

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
      <ScreenHeader
        title={matnItem.title}
        subtitle="Where do you want to begin?"
      />

      <Text style={styles.hint}>
        Tap the line you want to start from. You will recite from that line
        through the end of the matn.
      </Text>

      <FlatList
        ref={listRef}
        data={allLines}
        keyExtractor={(r) => r.line.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
        // Rows wrap to different heights, so a row's offset is only known
        // once every row above it has been laid out. Render through the
        // opening line (and a screenful past it) in the first pass.
        initialNumToRender={openAt > 0 ? openAt + 16 : undefined}
        onContentSizeChange={scrollToOpenAt}
        onScrollToIndexFailed={({ index }) => {
          // The rows above the target are not measured yet; they are a
          // moment later.
          if (retriesLeft.current <= 0) return;
          retriesLeft.current -= 1;
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => {
            listRef.current?.scrollToIndex({ index, animated: false });
          }, SCROLL_RETRY_MS);
        }}
        renderItem={({ item }) => (
          <LineRow
            number={item.globalIndex + 1}
            text={item.line.text_ar}
            onPress={() => beginSession(item.globalIndex)}
          />
        )}
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
    gap: 6,
  },
});
