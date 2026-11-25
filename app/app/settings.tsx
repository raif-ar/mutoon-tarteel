import Constants from "expo-constants";
import { useFocusEffect, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ChevronRightIcon,
  ShareIcon,
  ShieldCheckIcon,
} from "../src/components/MutoonIcons";
import { ScreenHeader } from "../src/components/ui/ScreenHeader";
import {
  getSettings,
  setSetting,
  type SettingKey,
} from "../src/lib/db/database";
import {
  getMicPermission,
  requestMicPermission,
  type MicPermission,
} from "../src/lib/recite/audioCapture";
import { reciteLog } from "../src/lib/reciteLog";
import { loadDailyPace } from "../src/lib/stats/progressStats";
import { colors, tint } from "../src/theme/colors";
import { fonts } from "../src/theme/fonts";
import { shadowCard } from "../src/theme/shadows";

const GOALS = [5, 10, 20];

const SWITCH_TRACK = { false: tint(14, colors.ink), true: colors.accent };

interface RowProps {
  title: string;
  sub?: string;
  /** Trailing control, value or icon. */
  right?: ReactNode;
  /** Makes the whole row a button. */
  onPress?: () => void;
  /** The first row of a card has no divider above it. */
  first?: boolean;
}

function Row({ title, sub, right, onPress, first }: RowProps) {
  const content = (
    <>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{title}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {right}
    </>
  );

  if (!onPress) {
    return (
      <View style={[styles.row, !first && styles.rowDivider]}>{content}</View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        !first && styles.rowDivider,
        pressed && styles.rowPressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

function Group({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      {label ? <Text style={styles.groupLabel}>{label}</Text> : null}
      <View style={styles.card}>{children}</View>
    </View>
  );
}

/** Daily pace, the two Recite switches, listening status and help. */
export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // The controls wait for the stored values, so a switch never flips after it
  // has been drawn.
  const [ready, setReady] = useState(false);
  const [goalMin, setGoalMin] = useState(10);
  const [minutesToday, setMinutesToday] = useState(0);
  const [hideText, setHideText] = useState(true);
  const [markSlips, setMarkSlips] = useState(true);
  const [mic, setMic] = useState<MicPermission>("undetermined");
  const sharing = useRef(false);

  /** Minutes done today and the microphone permission: both change outside this screen. */
  const refreshLive = useCallback(async () => {
    const [pace, permission] = await Promise.all([
      loadDailyPace().catch(() => null),
      getMicPermission(),
    ]);
    if (pace) setMinutesToday(pace.minutesToday);
    setMic(permission);
  }, []);

  const load = useCallback(async () => {
    const [settings, pace, permission] = await Promise.all([
      getSettings().catch(() => null),
      loadDailyPace().catch(() => null),
      getMicPermission(),
    ]);
    if (settings) {
      setHideText(settings.hideTextDefault !== "0");
      setMarkSlips(settings.markSlipsLive !== "0");
    }
    if (pace) {
      setGoalMin(pace.goalMin);
      setMinutesToday(pace.minutesToday);
    }
    setMic(permission);
    setReady(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // The permission is changed in iOS Settings, so read it again on the way back.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshLive();
    });
    return () => subscription.remove();
  }, [refreshLive]);

  const save = useCallback(
    (key: SettingKey, value: string) => {
      // A failed write reloads what is stored, so no control shows a value
      // that was not saved.
      setSetting(key, value).catch(() => void load());
    },
    [load]
  );

  const chooseGoal = useCallback(
    (minutes: number) => {
      setGoalMin(minutes);
      save("dailyGoalMin", String(minutes));
    },
    [save]
  );

  const toggleHideText = useCallback(
    (on: boolean) => {
      setHideText(on);
      save("hideTextDefault", on ? "1" : "0");
    },
    [save]
  );

  const toggleMarkSlips = useCallback(
    (on: boolean) => {
      setMarkSlips(on);
      save("markSlipsLive", on ? "1" : "0");
    },
    [save]
  );

  const askForMic = useCallback(() => {
    void requestMicPermission().then(setMic);
  }, []);

  const sendLog = useCallback(async () => {
    if (sharing.current) return;
    sharing.current = true;
    try {
      await reciteLog.flushFileLog();
      const uri = await reciteLog.getLatestLogFileUri();
      if (!uri) {
        Alert.alert("No log yet", "Recite once, then send the log from here.");
        return;
      }
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
      /* the share sheet was dismissed */
    } finally {
      sharing.current = false;
    }
  }, []);

  const replayIntro = useCallback(() => {
    // The intro ends by replacing itself with the tabs, so it has to be the
    // only screen left: pushing it would stack a second tab shell.
    if (router.canDismiss()) router.dismissAll();
    router.replace("/onboarding");
  }, [router]);

  // iOS asks only once: after a refusal the switch lives in iOS Settings.
  let micSub = "Off. Reciting needs it.";
  let onMicPress: (() => void) | undefined;
  if (mic === "granted") {
    micSub = "Allowed";
  } else if (mic === "undetermined") {
    micSub = "Not asked yet";
    onMicPress = askForMic;
  } else if (mic === "denied") {
    onMicPress = () => void Linking.openSettings();
  }

  const version = Constants.expoConfig?.version;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScreenHeader title="Settings" />
      {ready ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 40 },
          ]}
        >
          <Group label="Daily pace">
            <Row
              first
              title="Minutes a day"
              sub={`${minutesToday} of ${goalMin} min done today`}
              right={
                <View style={styles.seg}>
                  {GOALS.map((minutes) => {
                    const selected = goalMin === minutes;
                    return (
                      <Pressable
                        key={minutes}
                        onPress={() => chooseGoal(minutes)}
                        hitSlop={{ top: 10, bottom: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel={`${minutes} minutes a day`}
                        accessibilityState={{ selected }}
                        style={[styles.segBtn, selected && styles.segBtnOn]}
                      >
                        <Text
                          style={[styles.segText, selected && styles.segTextOn]}
                        >
                          {minutes}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              }
            />
          </Group>

          <Group label="Reciting">
            <Row
              first
              title="Hide the text when I start"
              sub="Recite from memory. The eye button shows it again."
              right={
                <Switch
                  value={hideText}
                  onValueChange={toggleHideText}
                  trackColor={SWITCH_TRACK}
                  ios_backgroundColor={SWITCH_TRACK.false}
                  accessibilityLabel="Hide the text when I start"
                />
              }
            />
            <Row
              title="Mark slips as I recite"
              sub="Off: slips wait for the summary at the end."
              right={
                <Switch
                  value={markSlips}
                  onValueChange={toggleMarkSlips}
                  trackColor={SWITCH_TRACK}
                  ios_backgroundColor={SWITCH_TRACK.false}
                  accessibilityLabel="Mark slips as I recite"
                />
              }
            />
          </Group>

          <Group label="Listening">
            <Row
              first
              title="Runs on this phone"
              sub="No account and no internet needed. Your voice is not uploaded."
              right={<ShieldCheckIcon />}
            />
            <Row
              title="Microphone"
              sub={micSub}
              onPress={onMicPress}
              right={
                <Text style={styles.value}>
                  {mic === "granted" ? "On" : "Off"}
                </Text>
              }
            />
            <Row
              title="Check listening"
              sub="Play a short test clip to the listener on this phone."
              onPress={() => router.push("/listening-check")}
              right={<ChevronRightIcon size={15} color={colors.faint} />}
            />
          </Group>

          <Group label="Help">
            <Row
              first
              title="Send a recite log"
              sub="Share the last session's log when something looked wrong."
              onPress={() => void sendLog()}
              right={<ShareIcon />}
            />
            <Row
              title="Replay the intro"
              onPress={replayIntro}
              right={<ChevronRightIcon size={15} color={colors.faint} />}
            />
          </Group>

          <Group label="Credits">
            <Row
              first
              title="Listening model"
              sub="Tilawa (spliced-clean) by yazinsai, licensed CC BY 4.0. Built on tlog by Tarteel and Quranic Universal Ayahs by QUD Technologies, both CC-BY."
              onPress={() => void Linking.openURL("https://github.com/yazinsai/tilawa")}
              right={<ChevronRightIcon size={15} color={colors.faint} />}
            />
            <Row
              title="Runs on ONNX Runtime"
              sub="By Microsoft, MIT licence."
            />
          </Group>

          <Group>
            <Row
              first
              title="Mutoon"
              sub={version ? `Version ${version}` : undefined}
            />
          </Group>
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, direction: "ltr" },
  scroll: { paddingTop: 6 },
  group: { marginHorizontal: 20, marginBottom: 14 },
  groupLabel: {
    marginHorizontal: 4,
    marginBottom: 7,
    fontFamily: fonts.uiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  card: {
    paddingHorizontal: 16,
    paddingVertical: 2,
    borderRadius: 20,
    backgroundColor: colors.card,
    ...shadowCard,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingVertical: 9,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  rowPressed: { opacity: 0.55 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 14.5,
    lineHeight: 19,
    color: colors.ink,
  },
  rowSub: {
    fontFamily: fonts.ui,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.textMuted,
  },
  value: { fontFamily: fonts.uiMedium, fontSize: 13.5, color: colors.textMuted },
  seg: {
    flexDirection: "row",
    padding: 3,
    gap: 3,
    borderRadius: 12,
    backgroundColor: tint(5, colors.ink),
  },
  segBtn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segBtnOn: {
    backgroundColor: colors.card,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 1,
  },
  segText: {
    fontFamily: fonts.uiBold,
    fontSize: 12.5,
    color: colors.textMuted,
  },
  segTextOn: { color: colors.ink },
});
