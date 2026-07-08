import { Platform } from "react-native";

/** Soft card shadow — matches the redesign's `shadowCard`. */
export const shadowCard = Platform.select({
  ios: {
    shadowColor: "#141E1A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
  },
  default: { elevation: 2 },
});

/** Floating capsule shadow (tab bar, toolbar) — matches `shadowFloat`. */
export const shadowFloat = Platform.select({
  ios: {
    shadowColor: "#141E1A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
  },
  default: { elevation: 8 },
});
