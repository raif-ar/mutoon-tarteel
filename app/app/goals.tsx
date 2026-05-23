import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { listMatns } from "../src/lib/content/loader";
import {
  completeGoal,
  createGoal,
  listGoals,
  type GoalRow,
} from "../src/lib/db/database";
import { colors } from "../src/theme/colors";

export default function GoalsScreen() {
  const matns = listMatns();
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [title, setTitle] = useState("");
  const [matnId, setMatnId] = useState(matns[0]?.id ?? "tuhfat_al_atfal");

  const refresh = useCallback(() => {
    void listGoals().then(setGoals);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addGoal = async () => {
    if (!title.trim()) return;
    await createGoal({
      matn_id: matnId,
      title: title.trim(),
      start_line_index: 0,
      end_line_index: 19,
      target_date: null,
    });
    setTitle("");
    refresh();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Memorization goals</Text>
      <TextInput
        style={styles.input}
        placeholder="Goal title"
        placeholderTextColor={colors.textMuted}
        value={title}
        onChangeText={setTitle}
      />
      <Pressable style={styles.primaryBtn} onPress={() => void addGoal()}>
        <Text style={styles.primaryBtnText}>Add goal (lines 1–20)</Text>
      </Pressable>

      <FlatList
        data={goals}
        keyExtractor={(g) => String(g.id)}
        contentContainerStyle={{ paddingTop: 16 }}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.meta}>
              {item.matn_id} · lines {item.start_line_index + 1}–
              {item.end_line_index + 1}
            </Text>
            {item.completed ? (
              <Text style={styles.done}>Completed</Text>
            ) : (
              <Pressable onPress={() => void completeGoal(item.id).then(refresh)}>
                <Text style={styles.link}>Mark done</Text>
              </Pressable>
            )}
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.meta}>No goals yet. Add one above.</Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  heading: { color: colors.text, fontSize: 18, fontWeight: "600", marginBottom: 12 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 12,
    color: colors.text,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  primaryBtnText: { color: "#ffffff", fontWeight: "700" },
  card: {
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { color: colors.text, fontSize: 16 },
  meta: { color: colors.textMuted, marginTop: 4, fontSize: 13 },
  done: { color: colors.success, marginTop: 8 },
  link: { color: colors.accent, marginTop: 8 },
});
