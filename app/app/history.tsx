import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { getRecentMistakes, getWeakLines, type MistakeRow } from "../src/lib/db/database";
import { colors } from "../src/theme/colors";

export default function HistoryScreen() {
  const [mistakes, setMistakes] = useState<MistakeRow[]>([]);
  const [weak, setWeak] = useState<Array<{ line_id: string; count: number }>>([]);

  useEffect(() => {
    void getRecentMistakes().then(setMistakes);
    void getWeakLines("tuhfat_al_atfal").then(setWeak);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Weak lines (Tuhfat)</Text>
      {weak.map((w) => (
        <Text key={w.line_id} style={styles.weak}>
          {w.line_id}: {w.count} mistake(s)
        </Text>
      ))}

      <Text style={[styles.heading, { marginTop: 20 }]}>Recent mistakes</Text>
      <FlatList
        data={mistakes}
        keyExtractor={(m) => String(m.id)}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.kind}>{item.kind}</Text>
            <Text style={styles.row}>
              {item.expected_word ?? "?"} → {item.recognized_word ?? "—"}
            </Text>
            <Text style={styles.meta}>
              {item.matn_id} / {item.line_id}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.meta}>Recite with the mic to log mistakes here.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  heading: { color: colors.text, fontWeight: "600", marginBottom: 8 },
  weak: { color: colors.warning, marginBottom: 4 },
  card: {
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
  },
  kind: { color: colors.error, fontWeight: "700" },
  row: { color: colors.text, marginTop: 4 },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
});
