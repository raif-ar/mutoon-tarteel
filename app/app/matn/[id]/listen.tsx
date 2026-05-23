import { useLocalSearchParams } from "expo-router";
import * as Speech from "expo-speech";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { LineCard } from "../../../src/components/LineCard";
import { flattenLines, getLineRange, getMatn } from "../../../src/lib/content/loader";
import { colors } from "../../../src/theme/colors";

export default function ListenScreen() {
  const { id, start, end } = useLocalSearchParams<{
    id: string;
    start?: string;
    end?: string;
  }>();
  const matn = getMatn(id);
  const startIdx = Number(start ?? 0);
  const endIdx = Number(end ?? Math.min(9, flattenLines(matn).length - 1));
  const sessionLines = useMemo(
    () => getLineRange(matn, startIdx, endIdx),
    [matn, startIdx, endIdx]
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const listRef = useRef<FlatList>(null);

  const speakLine = (index: number) => {
    const ref = sessionLines[index];
    if (!ref) return;
    setPlaying(true);
    setActiveIndex(index);
    listRef.current?.scrollToIndex({ index, animated: true });
    Speech.speak(ref.line.text_ar, {
      language: "ar",
      onDone: () => setPlaying(false),
      onStopped: () => setPlaying(false),
      onError: () => setPlaying(false),
    });
  };

  useEffect(() => {
    return () => {
      Speech.stop();
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>
        Listen mode uses on-device TTS (expo-speech). Replace with teacher audio per line
        when recordings are available.
      </Text>

      <View style={styles.controls}>
        <Pressable
          style={styles.primaryBtn}
          onPress={() => speakLine(activeIndex)}
          disabled={playing}
        >
          <Text style={styles.primaryBtnText}>
            {playing ? "Playing…" : "Play current line"}
          </Text>
        </Pressable>
        <Pressable
          style={styles.secondaryBtn}
          onPress={() => {
            Speech.stop();
            setPlaying(false);
            if (activeIndex < sessionLines.length - 1) {
              speakLine(activeIndex + 1);
            }
          }}
        >
          <Text style={styles.secondaryBtnText}>Next</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={sessionLines}
        keyExtractor={(r) => r.line.id}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => speakLine(index)}>
            <View
              style={[
                styles.lineWrap,
                index === activeIndex && styles.lineActive,
              ]}
            >
              <LineCard line={item.line} />
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  hint: { color: colors.textMuted, fontSize: 13, marginBottom: 12 },
  controls: { flexDirection: "row", gap: 10, marginBottom: 16 },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  primaryBtnText: { color: "#ffffff", fontWeight: "700" },
  secondaryBtn: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
  },
  secondaryBtnText: { color: colors.text },
  lineWrap: { opacity: 0.7 },
  lineActive: { opacity: 1, borderLeftWidth: 3, borderLeftColor: colors.accent },
});
