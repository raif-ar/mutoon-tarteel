/** Sage Minimal theme — matches design prototype (mutoon-reader.jsx). */
export const colors = {
  bg: "#F5F7FA",
  paper: "#FFFFFF",
  paperLine: "rgba(26, 31, 46, 0.06)",
  surface: "#FFFFFF",
  surfaceAlt: "rgba(26, 31, 46, 0.05)",
  surfaceMuted: "rgba(26, 31, 46, 0.04)",
  text: "#1A1F2E",
  textMuted: "#8891A5",
  accent: "#0C8C7E",
  accentSoft: "rgba(12, 140, 126, 0.05)",
  accentMid: "rgba(12, 140, 126, 0.10)",
  accentBorder: "rgba(12, 140, 126, 0.4)",
  accentBright: "#0C8C7E",
  accentDim: "#0A7A6E",
  error: "#D94545",
  warning: "#C4861A",
  success: "#0C8C7E",
  currentWordBg: "rgba(12, 140, 126, 0.10)",
  recitedGlow: "rgba(12, 140, 126, 0.05)",
  border: "rgba(26, 31, 46, 0.08)",
  divider: "rgba(26, 31, 46, 0.06)",
  verseNum: "#B8C2D0",
  progressBg: "rgba(12, 140, 126, 0.10)",
  progressFill: "#0C8C7E",
  bottomBar: "rgba(245, 247, 250, 0.92)",
  overlay: "rgba(0, 0, 0, 0.06)",
  category: {
    tajweed: "#0C8C7E",
    aqeedah: "#3B6FD4",
    hadith: "#C4861A",
  },
  // Redesign additions — streak/flame accent, faint text, capsule surfaces.
  amber: "#E0912A",
  faint: "#A9B4AF",
  ink: "#16211E",
  card: "#FFFFFF",
  capsule: "rgba(255,255,255,0.88)",
  capsuleBorder: "rgba(255,255,255,0.7)",
};

/**
 * A color at pct% opacity (accent by default) — the RN stand-in for the
 * prototype's `color-mix(in srgb, accent pct%, transparent)` tint helper.
 */
export function tint(pct: number, color = colors.accent): string {
  const a = Math.max(0, Math.min(100, pct)) / 100;
  return `${color}${Math.round(a * 255)
    .toString(16)
    .padStart(2, "0")}`;
}
