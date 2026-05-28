import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MatnListCard } from "../src/components/MatnListCard";
import { MoreIcon, SearchIcon } from "../src/components/MutoonIcons";
import { listMatns } from "../src/lib/content/loader";
import {
  MATN_CATEGORIES,
  toMatnListItem,
  type MatnCategory,
} from "../src/lib/content/matnMeta";
import { getMatnProgressMap } from "../src/lib/db/database";
import { colors } from "../src/theme/colors";
import { fonts } from "../src/theme/fonts";

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const matns = useMemo(() => listMatns().map(toMatnListItem), []);
  const [activeCategory, setActiveCategory] = useState<MatnCategory | "All">(
    "All"
  );
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});

  useEffect(() => {
    void getMatnProgressMap().then(setProgressMap);
  }, []);

  const filtered = useMemo(() => {
    let list = matns;
    if (activeCategory !== "All") {
      list = list.filter((m) => m.category === activeCategory);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.titleAr.includes(query.trim()) ||
          m.author.toLowerCase().includes(q)
      );
    }
    return list;
  }, [matns, activeCategory, query]);

  const inProgressCount = matns.filter((m) => {
    const p = progressMap[m.id] ?? 0;
    return p > 0 && p < m.totalLines;
  }).length;

  const openRecite = (matnId: string) => {
    router.push({
      pathname: "/matn/[id]/start",
      params: { id: matnId },
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.brand}>Mutoon</Text>
        <Pressable style={styles.iconBtn} hitSlop={8}>
          <MoreIcon />
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <View
          style={[
            styles.searchBox,
            searchFocused && styles.searchBoxFocused,
          ]}
        >
          <SearchIcon />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search for a matn..."
            placeholderTextColor={colors.textMuted}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            style={styles.searchInput}
            autoCorrect={false}
          />
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.pillsScroll}
        contentContainerStyle={styles.pills}
      >
        {MATN_CATEGORIES.map((cat) => {
          const active = activeCategory === cat;
          return (
            <Pressable
              key={cat}
              onPress={() => setActiveCategory(cat)}
              style={[styles.pill, active && styles.pillActive]}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>
                {cat}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{inProgressCount}</Text>
          <Text style={styles.statLabel}>In Progress</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, styles.statAccent]}>
            {Object.values(progressMap).reduce((a, b) => a + b, 0)}
          </Text>
          <Text style={styles.statLabel}>Lines Practiced</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{matns.length}</Text>
          <Text style={styles.statLabel}>Available</Text>
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(m) => m.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <MatnListCard
            matn={item}
            progressLines={progressMap[item.id] ?? 0}
            onPress={() => openRecite(item.id)}
          />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>No matn matches your search.</Text>
        }
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
  header: {
    flexDirection: "row",
    direction: "ltr",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 14,
  },
  brand: {
    fontFamily: fonts.uiBold,
    fontSize: 28,
    color: colors.text,
    letterSpacing: -0.5,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrap: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  searchBox: {
    flexDirection: "row",
    direction: "ltr",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  searchBoxFocused: {
    borderColor: `${colors.accent}40`,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 15,
    color: colors.text,
    padding: 0,
  },
  pillsScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  pills: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
    gap: 8,
    direction: "ltr",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.surfaceAlt,
  },
  pillActive: {
    backgroundColor: colors.accent,
  },
  pillText: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 13,
    textAlign: "center",
    color: colors.textMuted,
    includeFontPadding: false,
    ...Platform.select({
      android: { textAlignVertical: "center" as const },
      default: {},
    }),
  },
  pillTextActive: {
    color: "#fff",
  },
  statsRow: {
    flexDirection: "row",
    direction: "ltr",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  statCard: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.surface,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  statValue: {
    fontFamily: fonts.uiBold,
    fontSize: 22,
    color: colors.text,
  },
  statAccent: {
    color: colors.accent,
  },
  statLabel: {
    fontFamily: fonts.ui,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  empty: {
    fontFamily: fonts.ui,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 32,
  },
});
