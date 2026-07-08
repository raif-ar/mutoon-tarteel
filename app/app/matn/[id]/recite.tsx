import { useLocalSearchParams, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArabicText } from "../../../src/components/ArabicText";
import { ChevronLeftIcon } from "../../../src/components/MutoonIcons";
import { ReciteMushafView } from "../../../src/components/ReciteMushafView";
import { ReciteToolbar } from "../../../src/components/ReciteToolbar";
import {
  ASR_MODE,
  createAsrProvider,
} from "../../../src/lib/asr/createAsrProvider";
import { ReciteEngine } from "../../../src/lib/asr/reciteEngine";
import {
  flattenLines,
  getLineRange,
  getMatn,
} from "../../../src/lib/content/loader";
import { toMatnListItem } from "../../../src/lib/content/matnMeta";
import { getReciteBuildFingerprint } from "../../../src/lib/reciteBuildStamp";
import { logMistakes, logSession } from "../../../src/lib/db/database";
import { reciteLog } from "../../../src/lib/reciteLog";
import { colors, tint } from "../../../src/theme/colors";
import { fonts } from "../../../src/theme/fonts";

function countWords(lines: ReturnType<typeof getLineRange>): number {
  return lines.reduce((n, l) => n + l.line.words.length, 0);
}

export default function ReciteScreen() {
  const { id, start, end } = useLocalSearchParams<{
    id: string;
    start?: string;
    end?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const matn = getMatn(id);
  const matnItem = useMemo(() => toMatnListItem(matn), [matn]);
  const allLines = useMemo(() => flattenLines(matn), [matn]);
  const startIdx = Number(start ?? 0);
  const endIdx = Number(end ?? Math.max(0, allLines.length - 1));
  const sessionLines = useMemo(
    () => getLineRange(matn, startIdx, endIdx),
    [matn, startIdx, endIdx]
  );
  const sessionKey = `${id}-${startIdx}-${endIdx}`;
  const totalWords = useMemo(() => countWords(sessionLines), [sessionLines]);
  const totalLines = sessionLines.length;

  const engine = useRef<ReciteEngine | null>(null);

  const [hideUpcoming, setHideUpcoming] = useState(true);
  const [listening, setListening] = useState(false);
  const [wordCursor, setWordCursor] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);
  const [mistakes, setMistakes] = useState<
    import("../../../src/lib/asr/align").WordMistake[]
  >([]);
  const [peekWord, setPeekWord] = useState<string | null>(null);
  const [asrError, setAsrError] = useState<string | null>(null);
  const [stuckHint, setStuckHint] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [lowInput, setLowInput] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [toastWord, setToastWord] = useState<string | null>(null);
  const startedAt = useRef(Date.now());
  const listenStartedAt = useRef<number | null>(null);
  const seenMistakes = useRef<Set<number>>(new Set());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishing = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let eng: ReciteEngine | null = null;
    let unsub: (() => void) | undefined;

    void (async () => {
      await reciteLog.beginFileSession({
        matnId: id,
        asrMode: ASR_MODE,
        startIdx,
        endIdx,
        totalWords,
        lineCount: sessionLines.length,
      });
      if (cancelled) return;

      eng = new ReciteEngine(createAsrProvider(), {
        strictTashkeel: false,
      });
      engine.current = eng;
      reciteLog.session("build", getReciteBuildFingerprint());
      reciteLog.session("screen", {
        matnId: id,
        startIdx,
        endIdx,
        totalWords,
        lineCount: sessionLines.length,
        asrMode: ASR_MODE,
      });
      eng.loadSession(sessionLines);
      unsub = eng.subscribe((s) => {
        setWordCursor(s.wordCursor);
        setLineIndex(s.lineIndex);
        setMistakes(s.mistakes);
        setListening(s.isListening);
        setAsrError(s.asrError);
        setStuckHint(s.stuckHint ?? false);
        setInputLevel(s.inputLevel ?? 0);
        setLowInput(s.lowInput ?? false);
      });
    })();

    return () => {
      cancelled = true;
      unsub?.();
      void eng?.stopListening();
      engine.current = null;
      void reciteLog.endFileSession();
    };
  }, [sessionKey]);

  // "Slip caught" toast whenever a new mistake lands.
  useEffect(() => {
    let newest: import("../../../src/lib/asr/align").WordMistake | null = null;
    for (const m of mistakes) {
      const gi = m.globalWordIndex ?? -1;
      if (gi >= 0 && !seenMistakes.current.has(gi)) {
        seenMistakes.current.add(gi);
        if (!newest || gi > (newest.globalWordIndex ?? -1)) newest = m;
      }
    }
    if (newest?.expectedWord) {
      setToastWord(newest.expectedWord);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToastWord(null), 2600);
    }
  }, [mistakes]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const shareLog = useCallback(async () => {
    await reciteLog.flushFileLog();
    const uri = reciteLog.getActiveLogFileUri();
    if (!uri) {
      Alert.alert(
        "No log yet",
        "Recite logs are written during a session. Start listening, then share the log."
      );
      return;
    }
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: "text/plain",
          dialogTitle: "Share recite log",
          UTI: "public.plain-text",
        });
      } else {
        Alert.alert("Sharing unavailable", uri);
      }
    } catch {
      /* user cancelled the share sheet */
    }
  }, []);

  useEffect(() => {
    if (!listening) return;
    listenStartedAt.current = Date.now();
    const t = setInterval(() => {
      if (listenStartedAt.current) {
        setElapsedSec(
          Math.floor((Date.now() - listenStartedAt.current) / 1000)
        );
      }
    }, 1000);
    return () => clearInterval(t);
  }, [listening]);

  const done = totalWords > 0 && wordCursor >= totalWords;
  const progressPct =
    totalWords > 0 ? (Math.min(wordCursor, totalWords) / totalWords) * 100 : 0;
  const matnLineCount = allLines.length;
  const currentLineNum = Math.min(
    startIdx + lineIndex + 1,
    startIdx + totalLines
  );
  const accuracyPct =
    wordCursor > 0
      ? Math.max(
          0,
          Math.min(100, ((wordCursor - mistakes.length) / wordCursor) * 100)
        )
      : 100;

  const toggleListen = useCallback(async () => {
    const eng = engine.current;
    if (!eng) return;
    try {
      if (listening) {
        await eng.stopListening();
        listenStartedAt.current = null;
      } else {
        setElapsedSec(0);
        await eng.startListening();
      }
    } catch (e) {
      Alert.alert(
        "Microphone",
        e instanceof Error ? e.message : "Could not start speech recognition."
      );
    }
  }, [listening]);

  const saveSession = useCallback(async () => {
    await engine.current?.stopListening();
    const duration = Math.round((Date.now() - startedAt.current) / 1000);
    await logSession({
      matn_id: id,
      start_line_index: startIdx,
      end_line_index: Math.min(startIdx + lineIndex, endIdx),
      duration_sec: duration,
      mistake_count: mistakes.length,
    });
    const lastLine = sessionLines[Math.min(lineIndex, sessionLines.length - 1)];
    if (lastLine && mistakes.length > 0) {
      await logMistakes(
        id,
        lastLine.line.id,
        mistakes.map((m) => ({
          kind: m.kind,
          expectedWord: m.expectedWord,
          recognizedWord: m.recognizedWord,
        }))
      );
    }
    return duration;
  }, [endIdx, id, lineIndex, mistakes, sessionLines, startIdx]);

  /** Save, then hand off to the results sheet. */
  const finishToResults = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    const duration = await saveSession();
    const worstMistake = mistakes[0];
    router.replace({
      pathname: "/matn/[id]/results",
      params: {
        id,
        lines: String(done ? totalLines : lineIndex),
        seconds: String(duration),
        mistakes: String(mistakes.length),
        accuracy: accuracyPct.toFixed(1),
        reviewWord: worstMistake?.expectedWord ?? "",
        reviewLine:
          worstMistake?.lineIndex != null
            ? String(startIdx + worstMistake.lineIndex + 1)
            : "",
      },
    });
  }, [
    accuracyPct,
    done,
    id,
    lineIndex,
    mistakes,
    router,
    saveSession,
    startIdx,
    totalLines,
  ]);

  // Session complete → results.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => void finishToResults(), 700);
    return () => clearTimeout(t);
  }, [done, finishToResults]);

  const handleBack = () => {
    if (listening || mistakes.length > 0 || wordCursor > 0) {
      Alert.alert("Leave session?", "Your progress will be saved.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => {
            if (finishing.current) return;
            finishing.current = true;
            void saveSession().then(() => router.back());
          },
        },
      ]);
      return;
    }
    router.back();
  };

  const handlePeek = () => {
    const w = engine.current?.peekNextWord() ?? null;
    setPeekWord(w);
    setTimeout(() => setPeekWord(null), 2000);
  };

  const linesThisSession = done ? totalLines : lineIndex;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.headerBtn} onPress={handleBack} hitSlop={8}>
          <ChevronLeftIcon />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{matnItem.title}</Text>
          <Text style={styles.headerSub}>
            Line {currentLineNum} of {matnLineCount}
          </Text>
        </View>
        <Pressable
          style={styles.asrPill}
          onPress={() => void shareLog()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Share recite log"
        >
          <Text style={styles.asrPillText}>Share log</Text>
        </Pressable>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
      </View>

      {peekWord ? (
        <View style={styles.peekBanner}>
          <Text style={styles.peekLabel}>Hint: </Text>
          <ArabicText inline size="body" style={styles.peekWord}>
            {peekWord}
          </ArabicText>
        </View>
      ) : null}

      {asrError ? <Text style={styles.asrError}>{asrError}</Text> : null}

      {stuckHint && listening ? (
        <Pressable
          onPress={() => void engine.current?.rewindAndRetry(2)}
          style={styles.stuckBanner}
        >
          <Text style={styles.stuckHint}>
            Stuck? Tap to go back 2 lines and try again
          </Text>
        </Pressable>
      ) : null}

      {lowInput && listening ? (
        <View style={styles.stuckBanner}>
          <Text style={styles.stuckHint}>
            Mic seems quiet — move closer or speak up
          </Text>
        </View>
      ) : null}

      <ReciteMushafView
        lines={sessionLines}
        activeWordCursor={wordCursor}
        mistakes={mistakes}
        hideUpcoming={hideUpcoming}
        listening={listening}
        style={styles.mushaf}
      />

      {/* Slip toast */}
      <View
        style={[
          styles.toastWrap,
          { bottom: Math.max(insets.bottom, 14) + 96 },
          !toastWord && styles.toastHidden,
        ]}
        pointerEvents="none"
      >
        <View style={styles.toast}>
          <View style={styles.toastDot} />
          <Text style={styles.toastLabel}>Slip caught</Text>
          {toastWord ? (
            <Text style={styles.toastWord} allowFontScaling={false}>
              {toastWord}
            </Text>
          ) : null}
        </View>
      </View>

      <ReciteToolbar
        listening={listening}
        hideUpcoming={hideUpcoming}
        mistakeCount={mistakes.length}
        elapsedSec={elapsedSec}
        accuracyPct={accuracyPct}
        inputLevel={inputLevel}
        lowInput={lowInput}
        canFinish={linesThisSession > 0 || wordCursor > 0}
        onToggleListen={() => void toggleListen()}
        onToggleHideText={() => setHideUpcoming((h) => !h)}
        onPeek={handlePeek}
        onFinish={() => void finishToResults()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 2,
    paddingBottom: 8,
    gap: 6,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  asrPill: {
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  asrPillText: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 12,
    color: colors.accent,
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: {
    fontFamily: fonts.uiBold,
    fontSize: 17,
    color: colors.ink,
    letterSpacing: -0.3,
    textAlign: "center",
  },
  headerSub: {
    fontFamily: fonts.ui,
    fontSize: 11.5,
    color: colors.textMuted,
    marginTop: 1,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  progressTrack: {
    height: 3.5,
    backgroundColor: tint(10),
    marginHorizontal: 20,
    borderRadius: 2,
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.accent,
    borderRadius: 2,
  },
  peekBanner: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  peekLabel: {
    fontFamily: fonts.ui,
    fontSize: 13,
    color: colors.warning,
  },
  peekWord: {
    color: colors.warning,
    fontSize: 17,
  },
  asrError: {
    color: colors.error,
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 16,
    fontFamily: fonts.ui,
  },
  stuckBanner: {
    marginHorizontal: 20,
    marginTop: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(196, 134, 26, 0.12)",
  },
  stuckHint: {
    fontFamily: fonts.uiMedium,
    fontSize: 12,
    color: colors.warning,
    textAlign: "center",
  },
  mushaf: { flex: 1 },
  toastWrap: {
    position: "absolute",
    left: 20,
    right: 20,
    alignItems: "center",
  },
  toastHidden: {
    opacity: 0,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: "#1E2724",
    shadowColor: "#141E1A",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  toastDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.error,
  },
  toastLabel: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 13,
    color: "#fff",
  },
  toastWord: {
    fontFamily: fonts.arabic,
    fontSize: 15,
    color: "#FFB4AE",
    includeFontPadding: false,
  },
});
