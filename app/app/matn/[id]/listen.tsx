import { BlurView } from "expo-blur";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Speech from "expo-speech";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
} from "../../../src/components/MutoonIcons";
import { Press } from "../../../src/components/ui/Press";
import { ScreenHeader } from "../../../src/components/ui/ScreenHeader";
import { getMatn } from "../../../src/lib/content/loader";
import { planFromParams, reciteParams } from "../../../src/lib/recite/session";
import { colors, tint } from "../../../src/theme/colors";
import { fonts } from "../../../src/theme/fonts";
import { shadowCard, shadowFloat } from "../../../src/theme/shadows";

const CAPSULE_HEIGHT = 72;

export default function ListenScreen() {
  const { id, start, end } = useLocalSearchParams<{
    id: string;
    start?: string;
    end?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const matn = getMatn(id);
  // Same clamping as Recite, so "Recite" from here covers exactly these lines.
  const lines = useMemo(
    () => planFromParams(matn, { id, start, end }).lines,
    [matn, id, start, end]
  );
  const first = lines[0];
  const last = lines[lines.length - 1];
  const empty = lines.length === 0;

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [repeat, setRepeat] = useState(1);

  // Speech callbacks fire long after the render that started them, so playback
  // reads and writes this ref; the state above only mirrors it for drawing.
  // `run` changes whenever speech is started or cut off, which lets a callback
  // from an earlier utterance see that it is out of date and do nothing.
  const live = useRef({ index: 0, count: 0, repeat: 1, playing: false, run: 0 });

  const scrollRef = useRef<ScrollView>(null);
  const lineOffsets = useRef<number[]>([]);

  useEffect(() => {
    const y = lineOffsets.current[index];
    if (y != null) {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 150), animated: true });
    }
  }, [index]);

  useEffect(() => {
    const state = live.current;
    return () => {
      state.run += 1;
      Speech.stop();
    };
  }, []);

  const halt = () => {
    live.current.run += 1;
    Speech.stop();
  };

  const setPlayingBoth = (value: boolean) => {
    live.current.playing = value;
    setPlaying(value);
  };

  const select = (i: number) => {
    live.current.index = i;
    live.current.count = 0;
    setIndex(i);
  };

  const speak = (i: number) => {
    const state = live.current;
    const ref = lines[i];
    if (!ref) return;
    state.run += 1;
    const run = state.run;
    // speak() queues behind whatever is still being said, so cut that off first.
    Speech.stop();
    Speech.speak(ref.line.text_ar, {
      language: "ar",
      onDone: () => {
        if (state.run !== run) return;
        state.count += 1;
        if (state.count < state.repeat) {
          speak(i);
        } else if (i < lines.length - 1) {
          select(i + 1);
          speak(i + 1);
        } else {
          state.count = 0;
          setPlayingBoth(false);
        }
      },
      onError: () => {
        if (state.run !== run) return;
        setPlayingBoth(false);
      },
    });
  };

  const jump = (i: number) => {
    if (empty) return;
    const target = Math.max(0, Math.min(lines.length - 1, i));
    select(target);
    if (live.current.playing) speak(target);
  };

  const togglePlay = () => {
    if (live.current.playing) {
      halt();
      setPlayingBoth(false);
      return;
    }
    if (empty) return;
    setPlayingBoth(true);
    speak(live.current.index);
  };

  const cycleRepeat = () => {
    const state = live.current;
    state.repeat = state.repeat === 1 ? 3 : state.repeat === 3 ? 5 : 1;
    setRepeat(state.repeat);
  };

  const recite = () => {
    if (!first || !last) return;
    halt();
    setPlayingBoth(false);
    router.replace({
      pathname: "/matn/[id]/recite",
      params: reciteParams(id, first.globalIndex, last.globalIndex),
    });
  };

  // The screen stays mounted while it slides away, so stop before leaving.
  const goBack = () => {
    halt();
    setPlayingBoth(false);
    router.back();
  };

  const capsuleBottom = Math.max(insets.bottom, 14) + 10;
  // Five controls do not fit a 375pt phone at the full gap.
  const gap = width < 390 ? 8 : 14;
  const showReciteLabel = width >= 345;
  const repeating = repeat > 1;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Listen"
        onBack={goBack}
        subtitle={
          first && last ? (
            <>
              {/* A leading left-to-right mark keeps the Arabic title first. */}
              {"‎"}
              <Text style={styles.subtitleAr}>{first.sectionTitle}</Text>
              {` · lines ${first.globalIndex + 1}–${last.globalIndex + 1}`}
            </>
          ) : undefined
        }
      />

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={{
          paddingTop: 6,
          paddingBottom: capsuleBottom + CAPSULE_HEIGHT + 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        {lines.map((ref, i) => {
          const active = i === index;
          const lineNum = ref.globalIndex + 1;
          return (
            <Pressable
              key={ref.line.id}
              style={[styles.line, active && styles.lineActive]}
              onPress={() => jump(i)}
              onLayout={(e) => {
                lineOffsets.current[i] = e.nativeEvent.layout.y;
              }}
              accessibilityRole="button"
              accessibilityLabel={`Line ${lineNum}, ${ref.line.text_ar}`}
              accessibilityState={{ selected: active }}
            >
              <View style={styles.badge}>
                <Text style={styles.badgeNum} allowFontScaling={false}>
                  {String(lineNum)}
                </Text>
              </View>
              <Text style={[styles.lineText, active && styles.lineTextActive]}>
                {ref.line.text_ar}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.capsule, { bottom: capsuleBottom }]}>
        {Platform.OS === "ios" ? (
          <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />
        ) : null}
        <View style={[styles.capsuleRow, { gap }]}>
          <Pressable
            style={[styles.chip, repeating && styles.chipOn]}
            onPress={cycleRepeat}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Repeat each line"
            accessibilityValue={{ text: String(repeat) }}
          >
            <RepeatIcon
              size={15}
              color={repeating ? colors.accent : colors.textMuted}
            />
            <Text
              style={[styles.chipText, repeating && styles.chipTextOn]}
              allowFontScaling={false}
            >
              ×{repeat}
            </Text>
          </Pressable>

          <Pressable
            style={styles.sideBtn}
            onPress={() => jump(live.current.index - 1)}
            disabled={empty}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Previous line"
          >
            <ChevronLeftIcon size={17} />
          </Pressable>

          <Press
            onPress={togglePlay}
            scale={0.9}
            disabled={empty}
            accessibilityLabel={playing ? "Pause" : "Play"}
          >
            <View style={styles.playBtn}>
              {playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
            </View>
          </Press>

          <Pressable
            style={styles.sideBtn}
            onPress={() => jump(live.current.index + 1)}
            disabled={empty}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Next line"
          >
            <ChevronRightIcon size={17} />
          </Pressable>

          <Pressable
            style={styles.chip}
            onPress={recite}
            disabled={empty}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Recite these lines"
          >
            <MicIcon size={15} color={colors.textMuted} />
            {showReciteLabel ? (
              <Text style={styles.chipText} allowFontScaling={false}>
                Recite
              </Text>
            ) : null}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    direction: "ltr",
    backgroundColor: colors.bg,
  },
  subtitleAr: {
    fontFamily: fonts.arabic,
    fontSize: 14,
  },
  scroll: { flex: 1 },
  line: {
    flexDirection: "row-reverse",
    direction: "ltr",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginVertical: 3,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 18,
    // Always there, so a row does not shift when it becomes the current one.
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  lineActive: {
    backgroundColor: tint(7),
    borderColor: tint(28),
    ...shadowCard,
  },
  badge: {
    width: 25,
    height: 25,
    borderRadius: 13,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.divider,
  },
  badgeNum: {
    fontFamily: fonts.uiBold,
    fontSize: 11.5,
    color: colors.faint,
    textAlign: "center",
    includeFontPadding: false,
    fontVariant: ["tabular-nums"],
  },
  lineText: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.arabic,
    fontSize: 21,
    lineHeight: 38,
    color: colors.text,
    textAlign: "right",
    writingDirection: "rtl",
    includeFontPadding: false,
  },
  lineTextActive: {
    color: colors.accentDim,
  },
  capsule: {
    position: "absolute",
    left: 16,
    right: 16,
    height: CAPSULE_HEIGHT,
    borderRadius: 36,
    backgroundColor: colors.capsule,
    borderWidth: 1,
    borderColor: colors.capsuleBorder,
    overflow: Platform.OS === "ios" ? "hidden" : "visible",
    ...shadowFloat,
  },
  capsuleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  chip: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.surfaceAlt,
  },
  chipOn: {
    backgroundColor: tint(10),
  },
  chipText: {
    fontFamily: fonts.uiBold,
    fontSize: 12.5,
    color: colors.textMuted,
    fontVariant: ["tabular-nums"],
  },
  chipTextOn: {
    color: colors.accent,
  },
  sideBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: colors.divider,
    alignItems: "center",
    justifyContent: "center",
  },
  playBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 9,
    elevation: 5,
  },
});
