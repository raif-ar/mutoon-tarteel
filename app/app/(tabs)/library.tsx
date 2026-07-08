import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  FlameIcon,
  MicIcon,
  SearchIcon,
} from "../../src/components/MutoonIcons";
import { BrandLockup } from "../../src/components/brand/BrandLockup";
import { MatnCard } from "../../src/components/MatnCard";
import { Press } from "../../src/components/ui/Press";
import { Ring } from "../../src/components/ui/Ring";
import { listMatns } from "../../src/lib/content/loader";
import {
  MATN_CATEGORIES,
  toMatnListItem,
  type MatnCategory,
  type MatnListItem,
} from "../../src/lib/content/matnMeta";
import {
  getMatnProgressMap,
  getPracticeStreak,
  listRecentSessions,
} from "../../src/lib/db/database";
import { colors, tint } from "../../src/theme/colors";
import { fonts } from "../../src/theme/fonts";
import { shadowCard } from "../../src/theme/shadows";

export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const matns = useMemo(() => listMatns().map(toMatnListItem), []);
  const [activeCategory, setActiveCategory] = useState<MatnCategory | "All">(
    "All"
  );
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [streak, setStreak] = useState(0);
  const [lastMatnId, setLastMatnId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void getMatnProgressMap().then(setProgressMap);
      void getPracticeStreak().then(setStreak);
      void listRecentSessions(1).then((rows) =>
        setLastMatnId(rows[0]?.matn_id ?? null)
      );
    }, [])
  );

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

  const continueMatn: MatnListItem | undefined =
    matns.find((m) => m.id === lastMatnId) ?? matns[0];
  const continueLines = continueMatn
    ? Math.min(progressMap[continueMatn.id] ?? 0, continueMatn.totalLines)
    : 0;
  const continueStarted = continueLines > 0 && continueMatn != null;
  const continuePct = continueMatn
    ? (continueLines / continueMatn.totalLines) * 100
    : 0;

  const openPicker = (matnId: string) => {
    router.push({ pathname: "/matn/[id]/start", params: { id: matnId } });
  };

  const continueSession = () => {
    if (!continueMatn) return;
    // Resume at the first line not yet covered; restart if the matn is done.
    const start =
      continueLines >= continueMatn.totalLines ? 0 : continueLines;
    router.push({
      pathname: "/matn/[id]/recite",
      params: {
        id: continueMatn.id,
        start: String(start),
        end: String(continueMatn.totalLines - 1),
      },
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ gap: 3 }}>
          <Text style={styles.greeting}>As-salamu alaykum</Text>
          <BrandLockup size={30} />
        </View>
        <View style={styles.streakPill}>
          <FlameIcon size={17} />
          <Text style={styles.streakCount}>{streak}</Text>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Continue hero */}
        {continueMatn ? (
          <View style={styles.heroWrap}>
            <Press onPress={continueSession} scale={0.98}>
              <View style={styles.hero}>
                <Svg
                  width="100%"
                  height="100%"
                  style={StyleSheet.absoluteFill}
                  preserveAspectRatio="none"
                >
                  <Defs>
                    <LinearGradient id="heroGrad" x1="0" y1="0" x2="1" y2="1">
                      <Stop offset="0" stopColor={colors.accent} />
                      <Stop offset="1" stopColor="#0B6E63" />
                    </LinearGradient>
                  </Defs>
                  <Rect width="100%" height="100%" fill="url(#heroGrad)" />
                </Svg>
                <Text style={styles.heroWatermark} allowFontScaling={false}>
                  {continueMatn.titleAr.charAt(0)}
                </Text>

                <Ring
                  size={58}
                  stroke={5}
                  pct={continuePct}
                  color="#fff"
                  track="rgba(255,255,255,0.22)"
                >
                  <Text style={styles.heroRingLetter} allowFontScaling={false}>
                    {continueMatn.titleAr.charAt(0)}
                  </Text>
                </Ring>

                <View style={styles.heroBody}>
                  <Text style={styles.heroKicker}>
                    {continueStarted ? "CONTINUE" : "START"}
                  </Text>
                  <Text style={styles.heroTitle} numberOfLines={1}>
                    {continueMatn.title}
                  </Text>
                  <Text style={styles.heroSub} numberOfLines={1}>
                    {continueStarted
                      ? `Line ${continueLines} of ${continueMatn.totalLines} · ${continueMatn.author}`
                      : `${continueMatn.totalLines} lines · ${continueMatn.author}`}
                  </Text>
                </View>

                <View style={styles.heroMic}>
                  <MicIcon size={19} color={colors.accent} />
                </View>
              </View>
            </Press>
          </View>
        ) : null}

        {/* Search */}
        <View style={styles.searchWrap}>
          <View
            style={[styles.searchBox, searchFocused && styles.searchBoxFocused]}
          >
            <SearchIcon size={16} color={colors.faint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search the mutoon…"
              placeholderTextColor={colors.faint}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              style={styles.searchInput}
              autoCorrect={false}
            />
          </View>
        </View>

        {/* Category chips */}
        <View style={styles.chips}>
          {MATN_CATEGORIES.map((cat) => {
            const active = activeCategory === cat;
            return (
              <Press key={cat} onPress={() => setActiveCategory(cat)} scale={0.94}>
                <View style={[styles.chip, active && styles.chipActive]}>
                  <Text
                    style={[styles.chipText, active && styles.chipTextActive]}
                  >
                    {cat}
                  </Text>
                </View>
              </Press>
            );
          })}
        </View>

        {/* Matn list */}
        <View style={styles.list}>
          {filtered.map((matn) => (
            <MatnCard
              key={matn.id}
              matn={matn}
              progressLines={Math.min(
                progressMap[matn.id] ?? 0,
                matn.totalLines
              )}
              onPress={() => openPicker(matn.id)}
            />
          ))}
          {filtered.length === 0 ? (
            <Text style={styles.empty}>No matn matches your search.</Text>
          ) : null}
        </View>
      </ScrollView>
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
    paddingTop: 6,
    paddingBottom: 16,
  },
  greeting: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 13,
    color: colors.textMuted,
    letterSpacing: 0.1,
  },
  streakPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingLeft: 10,
    paddingRight: 13,
    borderRadius: 20,
    backgroundColor: colors.card,
    ...shadowCard,
  },
  streakCount: {
    fontFamily: fonts.uiBold,
    fontSize: 15,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  heroWrap: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 18,
    borderRadius: 24,
    overflow: "hidden",
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 15,
    elevation: 6,
  },
  heroWatermark: {
    position: "absolute",
    right: -14,
    top: -28,
    fontFamily: fonts.arabicBold,
    fontSize: 130,
    color: "rgba(255,255,255,0.07)",
    includeFontPadding: false,
  },
  heroRingLetter: {
    fontFamily: fonts.arabic,
    fontSize: 22,
    color: "#fff",
    includeFontPadding: false,
  },
  heroBody: { flex: 1, minWidth: 0 },
  heroKicker: {
    fontFamily: fonts.uiBold,
    fontSize: 11.5,
    color: "rgba(255,255,255,0.75)",
    letterSpacing: 1.2,
  },
  heroTitle: {
    fontFamily: fonts.uiBold,
    fontSize: 18,
    color: "#fff",
    letterSpacing: -0.3,
    marginTop: 2,
  },
  heroSub: {
    fontFamily: fonts.ui,
    fontSize: 12.5,
    color: "rgba(255,255,255,0.72)",
    marginTop: 2,
  },
  heroMic: {
    width: 44,
    height: 44,
    borderRadius: 22,
    flexShrink: 0,
    backgroundColor: "rgba(255,255,255,0.95)",
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
    gap: 9,
    paddingVertical: 11,
    paddingHorizontal: 15,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: "transparent",
    ...shadowCard,
  },
  searchBoxFocused: {
    borderColor: tint(45),
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.ui,
    fontSize: 15,
    color: colors.ink,
    padding: 0,
  },
  chips: {
    flexDirection: "row",
    direction: "ltr",
    gap: 7,
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 14,
  },
  chip: {
    paddingHorizontal: 15,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "rgba(22,33,30,0.05)",
  },
  chipActive: {
    backgroundColor: colors.ink,
  },
  chipText: {
    fontFamily: fonts.uiBold,
    fontSize: 13,
    color: colors.textMuted,
  },
  chipTextActive: {
    color: "#fff",
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 2,
    gap: 9,
  },
  empty: {
    fontFamily: fonts.ui,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: 32,
  },
});
