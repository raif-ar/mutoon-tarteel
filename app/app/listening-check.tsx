import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeftIcon } from "../src/components/MutoonIcons";
import { Press } from "../src/components/ui/Press";
import { runListeningCheck, type ListeningCheckResult } from "../src/lib/recite/listeningCheck";
import { isListenerAvailable } from "../src/lib/recite/nativeListener";
import { colors } from "../src/theme/colors";
import { fonts } from "../src/theme/fonts";
import { shadowCard } from "../src/theme/shadows";

type Phase =
  | { kind: "running" }
  | { kind: "done"; result: ListeningCheckResult }
  | { kind: "failed"; message: string };

/** Settings → Check listening: proves the on-device engine works on this phone. */
export default function ListeningCheckScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: "running" });

  const run = useCallback(() => {
    setPhase({ kind: "running" });
    if (!isListenerAvailable()) {
      setPhase({ kind: "failed", message: "Listening is not available on this device yet." });
      return;
    }
    runListeningCheck()
      .then((result) => {
        console.log(`[MutoonRecite] listeningCheck ${JSON.stringify(result)}`);
        setPhase({ kind: "done", result });
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        console.log(`[MutoonRecite] listeningCheck FAILED ${message}`);
        setPhase({ kind: "failed", message });
      });
  }, []);

  useEffect(run, [run]);

  let title = "Checking…";
  let body = "Playing a short test clip to the listener on this phone.";
  if (phase.kind === "done") {
    title = phase.result.ok ? "Listening works" : "Listening needs attention";
    body = phase.result.ok
      ? `All ${phase.result.totalWords} words of the test clip were followed, ${phase.result.speed.toFixed(0)} times faster than real time.`
      : `Only ${phase.result.wordsHeard} of ${phase.result.totalWords} words of the test clip were followed.`;
  } else if (phase.kind === "failed") {
    title = "Listening is not working";
    body = phase.message;
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.headerBtn} onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <ChevronLeftIcon />
        </Pressable>
        <Text style={styles.headerTitle}>Check listening</Text>
        <View style={styles.headerBtn} />
      </View>
      <View style={styles.card}>
        <Text style={styles.title} testID="listening-check-title">{title}</Text>
        <Text style={styles.body} testID="listening-check-body">{body}</Text>
        <Text style={styles.note}>Runs on this phone. Nothing is uploaded.</Text>
      </View>
      {phase.kind !== "running" ? (
        <View style={styles.footer}>
          <Press onPress={run} scale={0.97}>
            <View style={styles.cta}>
              <Text style={styles.ctaText}>Run again</Text>
            </View>
          </Press>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, direction: "ltr" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 2, paddingBottom: 10, gap: 8 },
  headerBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontFamily: fonts.uiBold, fontSize: 19, color: colors.text },
  card: { marginHorizontal: 20, marginTop: 10, padding: 20, borderRadius: 20, backgroundColor: colors.card, gap: 8, ...shadowCard },
  title: { fontFamily: fonts.uiBold, fontSize: 20, color: colors.ink, letterSpacing: -0.3 },
  body: { fontFamily: fonts.ui, fontSize: 14.5, lineHeight: 21, color: colors.text },
  note: { fontFamily: fonts.ui, fontSize: 12.5, color: colors.textMuted, marginTop: 4 },
  footer: { paddingHorizontal: 20, paddingTop: 16 },
  cta: { height: 52, borderRadius: 18, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  ctaText: { fontFamily: fonts.uiBold, fontSize: 16, color: "#fff" },
});
