import { useLocalSearchParams, useRouter } from "expo-router";
import * as Speech from "expo-speech";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArabicText } from "../../../src/components/ArabicText";
import {
  ChevronLeftIcon,
  CloudOfflineIcon,
  VolumeIcon,
} from "../../../src/components/MutoonIcons";
import { ReciteMushafView } from "../../../src/components/ReciteMushafView";
import { ReciteToolbar } from "../../../src/components/ReciteToolbar";
import { Press } from "../../../src/components/ui/Press";
import { flattenLines, getMatn } from "../../../src/lib/content/loader";
import { toMatnListItem } from "../../../src/lib/content/matnMeta";
import { getSettings } from "../../../src/lib/db/database";
import { getMicPermission } from "../../../src/lib/recite/audioCapture";
import { FilePcmSource } from "../../../src/lib/recite/filePcmSource";
import { loadCheckClip } from "../../../src/lib/recite/listeningCheck";
import { prepareListener } from "../../../src/lib/recite/nativeListener";
import { ReciteEngine } from "../../../src/lib/recite/reciteEngine";
import {
  planFromParams,
  saveSession,
  setLastSessionResult,
} from "../../../src/lib/recite/session";
import type { ReciteEngineState, Slip } from "../../../src/lib/recite/types";
import { getReciteBuildFingerprint } from "../../../src/lib/reciteBuildStamp";
import { reciteLog } from "../../../src/lib/reciteLog";
import { colors, tint } from "../../../src/theme/colors";
import { fonts } from "../../../src/theme/fonts";
import { shadowFloat } from "../../../src/theme/shadows";

const NO_SLIPS: Slip[] = [];

export default function ReciteScreen() {
  const params = useLocalSearchParams<{
    id: string;
    start?: string;
    end?: string;
    lines?: string;
    /** Dev builds only: replay the bundled test clip instead of the microphone. */
    replay?: string;
  }>();
  const { id } = params;
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const matn = getMatn(id);
  const matnItem = useMemo(() => toMatnListItem(matn), [matn]);
  const matnLineCount = useMemo(() => flattenLines(matn).length, [matn]);
  const plan = useMemo(
    () => planFromParams(matn, { id, start: params.start, end: params.end, lines: params.lines }),
    [matn, id, params.start, params.end, params.lines]
  );
  const sessionLines = plan.lines;
  const sessionKey = `${id}-${plan.mode}-${sessionLines.map((l) => l.globalIndex).join(".")}`;
  const totalWords = useMemo(
    () => sessionLines.reduce((n, l) => n + l.line.words.length, 0),
    [sessionLines]
  );
  const totalLines = sessionLines.length;

  const engine = useRef<ReciteEngine | null>(null);
  const [state, setState] = useState<ReciteEngineState | null>(null);
  const [hideUpcoming, setHideUpcoming] = useState(true);
  const [markLive, setMarkLive] = useState(true);
  const [peekWord, setPeekWord] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [toastWord, setToastWord] = useState<string | null>(null);
  const [openSlip, setOpenSlip] = useState<Slip | null>(null);

  /** Seconds spent listening, across pauses (this is what counts toward the daily pace). */
  const listenedMs = useRef(0);
  const listenStartedAt = useRef<number | null>(null);
  const seenSlips = useRef<Set<number>>(new Set());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishing = useRef(false);

  const wordCursor = state?.wordCursor ?? 0;
  const lineIndex = state?.lineIndex ?? 0;
  const mistakes = state?.mistakes ?? NO_SLIPS;
  const listening = state?.isListening ?? false;
  const preparing = state?.isPreparing ?? false;

  useEffect(() => {
    let cancelled = false;
    void getSettings().then((s) => {
      if (cancelled) return;
      setHideUpcoming(s.hideTextDefault !== "0");
      setMarkLive(s.markSlipsLive !== "0");
    });
    // Load the model while the reciter gets ready, so the first tap on the mic is instant.
    prepareListener().catch(() => {
      /* surfaced when the mic is tapped */
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let eng: ReciteEngine | null = null;
    let unsub: (() => void) | undefined;
    finishing.current = false;
    listenedMs.current = 0;
    listenStartedAt.current = null;
    seenSlips.current = new Set();
    setElapsedSec(0);
    setOpenSlip(null);

    void (async () => {
      await reciteLog.beginFileSession({
        matnId: id,
        asrMode: "on-device",
        startIdx: sessionLines[0]?.globalIndex ?? 0,
        endIdx: sessionLines[sessionLines.length - 1]?.globalIndex ?? 0,
        totalWords,
        lineCount: sessionLines.length,
      });
      if (cancelled) return;
      let source: FilePcmSource | undefined;
      if (__DEV__ && params.replay) {
        try {
          source = new FilePcmSource(await loadCheckClip());
        } catch {
          source = undefined;
        }
        if (cancelled) return;
      }
      eng = new ReciteEngine(source ? { source } : {});
      engine.current = eng;
      reciteLog.session("build", getReciteBuildFingerprint());
      reciteLog.session("screen", { matnId: id, mode: plan.mode, totalWords, lineCount: sessionLines.length });
      eng.loadSession(sessionLines);
      unsub = eng.subscribe(setState);
    })();

    return () => {
      cancelled = true;
      unsub?.();
      void eng?.stopListening();
      engine.current = null;
      void reciteLog.endFileSession();
    };
    // sessionKey identifies the session; the other values derive from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  // "Slip caught" toast whenever a new slip lands.
  useEffect(() => {
    let newest: Slip | null = null;
    for (const m of mistakes) {
      if (!seenSlips.current.has(m.globalWordIndex)) {
        seenSlips.current.add(m.globalWordIndex);
        if (!newest || m.globalWordIndex > newest.globalWordIndex) newest = m;
      }
    }
    if (newest && markLive) {
      setToastWord(newest.expectedWord);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToastWord(null), 2600);
    }
  }, [mistakes, markLive]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (peekTimer.current) clearTimeout(peekTimer.current);
      Speech.stop();
    };
  }, []);

  // Listening clock: counts only while the mic is on.
  useEffect(() => {
    if (!listening) return;
    listenStartedAt.current = Date.now();
    const t = setInterval(() => {
      if (listenStartedAt.current) {
        setElapsedSec(Math.floor((listenedMs.current + Date.now() - listenStartedAt.current) / 1000));
      }
    }, 1000);
    return () => {
      clearInterval(t);
      if (listenStartedAt.current) {
        listenedMs.current += Date.now() - listenStartedAt.current;
        listenStartedAt.current = null;
      }
    };
  }, [listening]);

  const done = totalWords > 0 && wordCursor >= totalWords;
  const progressPct = totalWords > 0 ? (Math.min(wordCursor, totalWords) / totalWords) * 100 : 0;
  const currentLine = sessionLines[Math.min(lineIndex, Math.max(0, totalLines - 1))];
  const currentLineNum = currentLine ? currentLine.globalIndex + 1 : 1;
  const accuracyPct =
    wordCursor > 0
      ? Math.max(0, Math.min(100, ((wordCursor - mistakes.length) / wordCursor) * 100))
      : 100;

  const toggleListen = useCallback(async () => {
    const eng = engine.current;
    if (!eng) return;
    try {
      if (eng.getState().isListening) {
        await eng.stopListening();
        return;
      }
      if ((await getMicPermission()) === "denied") {
        setMicDenied(true);
        return;
      }
      setMicDenied(false);
      await eng.startListening();
    } catch (e) {
      if ((await getMicPermission()) === "denied") {
        setMicDenied(true);
        return;
      }
      Alert.alert(
        "Listening could not start",
        e instanceof Error ? e.message : "Please try again."
      );
    }
  }, []);

  /** Stop, save, and return the summary. Uses the engine's final state, not this render's. */
  const stopAndSave = useCallback(async () => {
    const eng = engine.current;
    if (!eng) return null;
    const finalState = await eng.stopListening();
    const seconds =
      (listenedMs.current + (listenStartedAt.current ? Date.now() - listenStartedAt.current : 0)) / 1000;
    return saveSession(id, plan, finalState, seconds);
  }, [id, plan]);

  const finishToResults = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    try {
      const result = await stopAndSave();
      setLastSessionResult(result);
      router.replace({ pathname: "/matn/[id]/results", params: { id } });
    } catch (e) {
      finishing.current = false;
      Alert.alert("Could not save the session", e instanceof Error ? e.message : "Please try again.");
    }
  }, [id, router, stopAndSave]);

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
            void stopAndSave()
              .catch(() => null)
              .then(() => router.back());
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
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeekWord(null), 2000);
  };

  const hearWord = async (word: string) => {
    // The open mic would hear the phone speak: pause listening first.
    if (engine.current?.getState().isListening) await engine.current.stopListening();
    Speech.stop();
    Speech.speak(word, { language: "ar" });
  };

  const shownMistakes = markLive ? mistakes : NO_SLIPS;
  const openSlipLine = openSlip ? sessionLines[openSlip.lineIndex] : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.headerBtn} onPress={handleBack} hitSlop={8} accessibilityLabel="Back">
          <ChevronLeftIcon />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {plan.mode === "practice" ? "Practice slips" : matnItem.title}
          </Text>
          <Text style={styles.headerSub}>
            Line {currentLineNum} of {matnLineCount}
          </Text>
        </View>
        <View style={styles.onDevicePill} accessibilityLabel="Listening runs on this phone">
          <CloudOfflineIcon size={12} />
          <Text style={styles.onDeviceText}>On this phone</Text>
        </View>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
      </View>

      {micDenied ? (
        <Pressable
          onPress={() => void Linking.openSettings()}
          style={styles.warnBanner}
          accessibilityRole="button"
        >
          <Text style={styles.warnText}>
            Microphone is off for Mutoon. Tap to turn it on in Settings.
          </Text>
        </Pressable>
      ) : null}
      {preparing ? (
        <View style={styles.infoBanner}>
          <Text style={styles.infoText}>Getting ready to listen…</Text>
        </View>
      ) : null}
      {peekWord ? (
        <View style={styles.peekBanner}>
          <Text style={styles.peekLabel}>Hint: </Text>
          <ArabicText inline size="body" style={styles.peekWord}>
            {peekWord}
          </ArabicText>
        </View>
      ) : null}
      {state?.asrError ? <Text style={styles.asrError}>{state.asrError}</Text> : null}
      {state?.stuckHint && listening ? (
        <Pressable
          onPress={() => void engine.current?.rewindAndRetry(2)}
          style={styles.warnBanner}
          accessibilityRole="button"
        >
          <Text style={styles.warnText}>Stuck? Tap to go back 2 lines and try again</Text>
        </Pressable>
      ) : null}
      {state?.lowInput && listening ? (
        <View style={styles.warnBanner}>
          <Text style={styles.warnText}>Mic seems quiet — move closer or speak up</Text>
        </View>
      ) : null}

      <ReciteMushafView
        lines={sessionLines}
        activeWordCursor={wordCursor}
        mistakes={shownMistakes}
        onPressMistake={(g) => setOpenSlip(mistakes.find((m) => m.globalWordIndex === g) ?? null)}
        hideUpcoming={hideUpcoming}
        listening={listening}
        style={styles.mushaf}
      />

      {/* Slip toast */}
      <View
        style={[
          styles.toastWrap,
          { bottom: Math.max(insets.bottom, 14) + 96 },
          (!toastWord || openSlip != null) && styles.toastHidden,
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

      {/* What was heard for a slipped word */}
      {openSlip && openSlipLine ? (
        <View style={[styles.slipCard, { bottom: Math.max(insets.bottom, 14) + 96 }]}>
          <Text style={styles.slipKicker}>
            LINE {openSlipLine.globalIndex + 1} · {openSlip.kind === "skipped" ? "SKIPPED WORD" : "WRONG WORD"}
          </Text>
          <View style={styles.slipPair}>
            <View style={styles.slipCell}>
              <Text style={styles.slipCellLabel}>The matn says</Text>
              <Text style={styles.slipWord} allowFontScaling={false}>
                {openSlip.expectedWord}
              </Text>
            </View>
            <View style={styles.slipCell}>
              <Text style={styles.slipCellLabel}>
                {openSlip.kind === "skipped" ? "You said" : "Sounded like"}
              </Text>
              {openSlip.kind === "skipped" || !openSlip.heard ? (
                <Text style={styles.slipNothing}>Nothing</Text>
              ) : (
                <Text style={[styles.slipWord, styles.slipWordBad]} allowFontScaling={false}>
                  {openSlip.heard}
                </Text>
              )}
            </View>
          </View>
          <View style={styles.slipActions}>
            <Press onPress={() => void hearWord(openSlip.expectedWord)} scale={0.97} style={styles.slipActionFlex}>
              <View style={[styles.slipBtn, styles.slipBtnGhost]}>
                <VolumeIcon size={17} />
                <Text style={styles.slipBtnGhostText}>Hear it</Text>
              </View>
            </Press>
            <Press onPress={() => setOpenSlip(null)} scale={0.97} style={styles.slipActionFlex}>
              <View style={styles.slipBtn}>
                <Text style={styles.slipBtnText}>Got it</Text>
              </View>
            </Press>
          </View>
        </View>
      ) : null}

      <ReciteToolbar
        listening={listening}
        hideUpcoming={hideUpcoming}
        mistakeCount={mistakes.length}
        elapsedSec={elapsedSec}
        accuracyPct={accuracyPct}
        inputLevel={state?.inputLevel ?? 0}
        lowInput={state?.lowInput ?? false}
        canFinish={wordCursor > 0}
        onToggleListen={() => void toggleListen()}
        onToggleHideText={() => setHideUpcoming((h) => !h)}
        onPeek={handlePeek}
        onFinish={() => void finishToResults()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, direction: "ltr" },
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
  onDevicePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: tint(10),
  },
  onDeviceText: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 11.5,
    color: colors.accent,
  },
  headerCenter: { flex: 1, alignItems: "center", minWidth: 0 },
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
    paddingTop: 6,
    fontFamily: fonts.ui,
  },
  warnBanner: {
    marginHorizontal: 20,
    marginTop: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(196, 134, 26, 0.12)",
  },
  warnText: {
    fontFamily: fonts.uiMedium,
    fontSize: 12,
    color: colors.warning,
    textAlign: "center",
  },
  infoBanner: {
    marginHorizontal: 20,
    marginTop: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: tint(10),
  },
  infoText: {
    fontFamily: fonts.uiMedium,
    fontSize: 12,
    color: colors.accentDim,
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
  slipCard: {
    position: "absolute",
    left: 20,
    right: 20,
    padding: 16,
    borderRadius: 20,
    backgroundColor: colors.card,
    ...shadowFloat,
  },
  slipKicker: {
    fontFamily: fonts.uiBold,
    fontSize: 11,
    letterSpacing: 1.1,
    color: colors.textMuted,
  },
  slipPair: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  slipCell: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: colors.bg,
    alignItems: "center",
  },
  slipCellLabel: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 11.5,
    color: colors.textMuted,
  },
  slipWord: {
    fontFamily: fonts.arabic,
    fontSize: 22,
    lineHeight: 38,
    color: colors.accent,
    includeFontPadding: false,
    writingDirection: "rtl",
  },
  slipWordBad: { color: colors.error },
  slipNothing: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 14,
    lineHeight: 38,
    color: colors.error,
  },
  slipActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  slipActionFlex: { flex: 1 },
  slipBtn: {
    height: 46,
    borderRadius: 15,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
  },
  slipBtnGhost: {
    backgroundColor: colors.bg,
  },
  slipBtnText: {
    fontFamily: fonts.uiBold,
    fontSize: 14.5,
    color: "#fff",
  },
  slipBtnGhostText: {
    fontFamily: fonts.uiBold,
    fontSize: 14.5,
    color: colors.ink,
  },
});
