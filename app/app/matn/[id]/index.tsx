import { Link, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { ArabicText } from "../../../src/components/ArabicText";
import { LineCard } from "../../../src/components/LineCard";
import { flattenLines, getMatn } from "../../../src/lib/content/loader";
import { colors } from "../../../src/theme/colors";

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matn = getMatn(id);
  const lines = useMemo(() => flattenLines(matn), [matn]);
  const [hideText, setHideText] = useState(false);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(Math.max(0, lines.length - 1));

  const visible = lines.slice(rangeStart, rangeEnd + 1);

  return (
    <View style={styles.container}>
      <Text style={styles.edition}>{matn.edition}</Text>

      <View style={styles.controls}>
        <Text style={styles.label}>Hide text (memorization)</Text>
        <Switch value={hideText} onValueChange={setHideText} />
      </View>

      <View style={styles.rangeRow}>
        <Text style={styles.label}>
          Range: lines {rangeStart + 1}–{rangeEnd + 1} of {lines.length}
        </Text>
        <View style={styles.rangeBtns}>
          <Pressable
            style={styles.smallBtn}
            onPress={() => {
              setRangeStart(Math.max(0, rangeStart - 5));
              setRangeEnd(Math.max(rangeStart, rangeEnd - 5));
            }}
          >
            <Text style={styles.smallBtnText}>−5</Text>
          </Pressable>
          <Pressable
            style={styles.smallBtn}
            onPress={() => {
              const ns = Math.min(lines.length - 1, rangeStart + 5);
              setRangeStart(ns);
              setRangeEnd(Math.min(lines.length - 1, rangeEnd + 5));
            }}
          >
            <Text style={styles.smallBtnText}>+5</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.actions}>
        <Link
          href={{
            pathname: "/matn/[id]/recite",
            params: { id, start: String(rangeStart), end: String(rangeEnd) },
          }}
          asChild
        >
          <Pressable style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>Recite</Text>
          </Pressable>
        </Link>
        <Link
          href={{
            pathname: "/matn/[id]/listen",
            params: { id, start: String(rangeStart), end: String(rangeEnd) },
          }}
          asChild
        >
          <Pressable style={styles.secondaryBtn}>
            <Text style={styles.secondaryBtnText}>Listen</Text>
          </Pressable>
        </Link>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(r) => r.line.id}
        renderItem={({ item }) => (
          <View>
            {item.globalIndex === rangeStart ||
            lines[item.globalIndex - 1]?.sectionId !== item.sectionId ? (
              <ArabicText size="body" style={styles.section}>
                {item.sectionTitle}
              </ArabicText>
            ) : null}
            <LineCard line={item.line} hidden={hideText} />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  edition: { color: colors.textMuted, fontSize: 12, marginBottom: 12 },
  controls: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  label: { color: colors.text, fontSize: 14 },
  rangeRow: { marginBottom: 12 },
  rangeBtns: { flexDirection: "row", gap: 8, marginTop: 8 },
  smallBtn: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  smallBtnText: { color: colors.text },
  actions: { flexDirection: "row", gap: 10, marginBottom: 16 },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.accent,
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  primaryBtnText: { color: "#ffffff", fontWeight: "700" },
  secondaryBtn: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  secondaryBtnText: { color: colors.text, fontWeight: "600" },
  section: {
    color: colors.accent,
    marginBottom: 6,
  },
});
