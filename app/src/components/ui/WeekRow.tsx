import { StyleSheet, Text, View } from "react-native";
import { colors, tint } from "../../theme/colors";
import { fonts } from "../../theme/fonts";
import { CheckIcon } from "../MutoonIcons";

interface WeekRowProps {
  /** Sessions per day for the last 7 days, oldest first; the last entry is today. */
  week: number[];
  /** Diameter of each day dot. */
  dotSize?: number;
}

const WEEK_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

interface WeekDay {
  label: string;
  done: boolean;
  isToday: boolean;
}

/** Labels each of the last 7 days by its real weekday, ending today. */
function lastSevenDays(week: number[]): WeekDay[] {
  // Today is always the last entry, so a short list (still loading) is padded
  // at the start and the row keeps its seven dots.
  const recent = week.slice(-7);
  const offset = 7 - recent.length;
  const today = new Date();
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    const weekday = (d.getDay() + 6) % 7; // 0 = Monday
    const count = i >= offset ? recent[i - offset] : 0;
    days.push({
      label: WEEK_LABELS[weekday],
      done: count > 0,
      isToday: i === 6,
    });
  }
  return days;
}

/** Seven day dots for the practice streak: a check on each day with a session. */
export function WeekRow({ week, dotSize = 28 }: WeekRowProps) {
  const days = lastSevenDays(week);
  const doneCount = days.filter((d) => d.done).length;
  const dot = { width: dotSize, height: dotSize, borderRadius: dotSize / 2 };
  const checkSize = Math.round(dotSize * 0.43);

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`Practiced ${doneCount} of the last 7 days`}
    >
      {days.map((d, i) => (
        <View key={i} style={styles.day}>
          <View
            style={[
              styles.dot,
              dot,
              d.done && (d.isToday ? styles.dotToday : styles.dotDone),
            ]}
          >
            {d.done ? (
              <CheckIcon
                size={checkSize}
                color={d.isToday ? "#fff" : colors.accent}
              />
            ) : null}
          </View>
          <Text style={[styles.label, d.isToday && styles.labelToday]}>
            {d.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignSelf: "stretch",
    flexDirection: "row",
    direction: "ltr",
    justifyContent: "space-between",
  },
  day: {
    alignItems: "center",
    gap: 5,
  },
  dot: {
    backgroundColor: "rgba(22,33,30,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  dotDone: {
    backgroundColor: tint(12),
  },
  dotToday: {
    backgroundColor: colors.amber,
    shadowColor: colors.amber,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 3,
  },
  label: {
    fontFamily: fonts.uiBold,
    fontSize: 10.5,
    color: colors.faint,
  },
  labelToday: {
    color: colors.ink,
  },
});
