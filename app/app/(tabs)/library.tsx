import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ChevronRightIcon,
  FlameIcon,
  MicIcon,
  SearchIcon,
  SettingsIcon,
} from "../../src/components/MutoonIcons";
import { BrandLockup } from "../../src/components/brand/BrandLockup";
import { MatnCard } from "../../src/components/MatnCard";
import { PaceRing } from "../../src/components/ui/PaceRing";
import { Press } from "../../src/components/ui/Press";
import { Ring } from "../../src/components/ui/Ring";
import { SlipTile } from "../../src/components/ui/SlipTile";
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
  listSlips,
  type SlipRow,
} from "../../src/lib/db/database";
import { reciteParams } from "../../src/lib/recite/session";
import {
  loadDailyPace,
  loadMatnCoverage,
  type DailyPace,
  type MatnCoverage,
} from "../../src/lib/stats/progressStats";
import { colors, tint } from "../../src/theme/colors";
import { fonts } from "../../src/theme/fonts";
import { shadowCard } from "../../src/theme/shadows";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const matns = useMemo(() => listMatns().map(toMatnListItem), []);
  const [activeCategory, setActiveCategory] = useState<MatnCategory | "All">(
    "All"
  );
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [streak, setStreak] = useState(0);
  const [pace, setPace] = useState<DailyPace | null>(null);
  const [slips, setSlips] = useState<SlipRow[]>([]);
  // The matn the hero continues, with its recited lines; set together so the
  // hero never shows one matn with another's progress.
  const [hero, setHero] = useState<{
    matnId: string;
    coverage: MatnCoverage;
  } | null>(null);

  useFocusEffect(
    useCallback(() => {
      // A load that finishes after the screen lost focus is dropped.
      let active = true;
      void getMatnProgressMap().then((map) => {
        if (active) setProgressMap(map);
      });
      void getPracticeStreak().then((days) => {
        if (active) setStreak(days);
      });
      void loadDailyPace().then((next) => {
        if (active) setPace(next);
      });
      void listSlips().then((rows) => {
        if (active) setSlips(rows);
      });
      void listRecentSessions(1)
        .then(async (rows) => {
          const last = rows[0]?.matn_id;
          // The last session may belong to a matn that is no longer bundled.
          const matnId = matns.some((m) => m.id === last)
            ? last
            : matns[0]?.id;
          if (!matnId) return null;
          return { matnId, coverage: await loadMatnCoverage(matnId) };
        })
        .then((next) => {
          if (active && next) setHero(next);
        });
      return () => {
        active = false;
      };
    }, [matns])
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
    matns.find((m) => m.id === hero?.matnId) ?? matns[0];
  const coverage =
    hero != null && continueMatn != null && hero.matnId === continueMatn.id
      ? hero.coverage
      : null;
  // Lines recited at least once. Until the first load lands, the library
  // count stands in for it.
  const continueLines = !continueMatn
    ? 0
    : coverage
      ? coverage.linesDone
      : Math.min(progressMap[continueMatn.id] ?? 0, continueMatn.totalLines);
  const continueStarted = continueLines > 0 && continueMatn != null;
  const continuePct = continueMatn
    ? (continueLines / continueMatn.totalLines) * 100
    : 0;

  // Words still to review, across every matn. The newest slip names the card.
  const review = useMemo(() => {
    const titles = new Map(matns.map((m) => [m.id, m.title] as const));
    const known = slips.filter((s) => titles.has(s.matn_id));
    const first = known[0];
    if (!first) return null;
    return {
      word: first.expected_word,
      words: known.length,
      lines: new Set(known.map((s) => `${s.matn_id}:${s.line_id}`)).size,
      matnTitle: titles.get(first.matn_id) ?? "",
    };
  }, [slips, matns]);

  // Narrow phones cannot fit the full header on one row: the pace pill first
  // drops its unit, then its ring, and the lockup tightens.
  const showPaceUnit = width >= 380;
  const compactHeader = width < 345;

  const openMatn = (matnId: string) => {
    router.push({ pathname: "/matn/[id]", params: { id: matnId } });
  };

  const continueSession = async () => {
    if (!continueMatn) return;
    const { id, totalLines } = continueMatn;
    // The hero can be tapped before its first load lands.
    const { nextLine } = coverage ?? (await loadMatnCoverage(id));
    // Resume at the first line not yet recited; start over once the matn is
    // complete. The session runs to the end of the matn.
    const start = nextLine >= totalLines ? 0 : nextLine;
    router.push({
      pathname: "/matn/[id]/recite",
      params: { ...reciteParams(id, start, totalLines - 1) },
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, compactHeader && styles.headerCompact]}>
        <View style={styles.brand}>
          {/* The pills keep their size; the greeting gives way first. */}
          <Text
            style={styles.greeting}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            As-salamu alaykum
          </Text>
          <BrandLockup size={compactHeader ? 27 : 30} />
        </View>
        <View style={styles.pills}>
          {pace ? (
            <Press
              onPress={() => router.navigate("/progress")}
              scale={0.96}
              hitSlop={3}
              accessibilityLabel={`Today's pace, ${pace.minutesToday} of ${pace.goalMin} minutes`}
            >
              <View style={styles.pill}>
                {compactHeader ? null : (
                  <PaceRing fraction={pace.fraction} size={20} stroke={3} />
                )}
                <Text
                  style={styles.pillCount}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.2}
                >
                  {pace.minutesToday}
                  <Text style={styles.pillSmall}>
                    {` / ${pace.goalMin}${showPaceUnit ? " min" : ""}`}
                  </Text>
                </Text>
              </View>
            </Press>
          ) : null}
          <View style={styles.pill}>
            <FlameIcon size={17} />
            <Text
              style={styles.pillCount}
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
            >
              {streak}
            </Text>
          </View>
          <Press
            onPress={() => router.push("/settings")}
            scale={0.94}
            hitSlop={3}
            accessibilityLabel="Settings"
          >
            <View style={[styles.pill, styles.pillIcon]}>
              <SettingsIcon size={18} color={colors.textMuted} />
            </View>
          </Press>
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
            <Press onPress={() => void continueSession()} scale={0.98}>
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

        {/* Words to review */}
        {review ? (
          <View style={styles.reviewWrap}>
            <Press
              onPress={() => router.push("/review")}
              scale={0.98}
              accessibilityLabel={`${plural(review.words, "word")} to review, ${plural(review.lines, "line")}, ${review.matnTitle}`}
            >
              <View style={styles.reviewCard}>
                <SlipTile word={review.word} />
                <View style={styles.reviewBody}>
                  <Text style={styles.reviewTitle} numberOfLines={1}>
                    {plural(review.words, "word")} to review
                  </Text>
                  <Text style={styles.reviewSub} numberOfLines={1}>
                    {plural(review.lines, "line")} · {review.matnTitle}
                  </Text>
                </View>
                <ChevronRightIcon size={15} color={colors.faint} />
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
              onPress={() => openMatn(matn.id)}
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
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 16,
  },
  headerCompact: {
    paddingHorizontal: 14,
  },
  brand: {
    gap: 3,
    flexShrink: 1,
    minWidth: 0,
  },
  greeting: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 13,
    color: colors.textMuted,
    letterSpacing: 0.1,
  },
  pills: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  // One shape for the pace pill, the streak pill and the settings button.
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 36,
    paddingLeft: 9,
    paddingRight: 11,
    borderRadius: 20,
    backgroundColor: colors.card,
    ...shadowCard,
  },
  pillIcon: {
    width: 36,
    paddingLeft: 0,
    paddingRight: 0,
    justifyContent: "center",
  },
  pillCount: {
    fontFamily: fonts.uiBold,
    fontSize: 15,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  },
  pillSmall: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 12,
    color: colors.textMuted,
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
  reviewWrap: {
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  reviewCard: {
    flexDirection: "row",
    direction: "ltr",
    alignItems: "center",
    gap: 13,
    paddingVertical: 13,
    paddingHorizontal: 15,
    borderRadius: 20,
    backgroundColor: colors.card,
    ...shadowCard,
  },
  reviewBody: { flex: 1, minWidth: 0 },
  reviewTitle: {
    fontFamily: fonts.uiBold,
    fontSize: 14,
    color: colors.ink,
  },
  reviewSub: {
    fontFamily: fonts.ui,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
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
