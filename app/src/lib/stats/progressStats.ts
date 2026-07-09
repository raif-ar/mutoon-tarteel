import { getLineRange, getMatn, listMatns } from "../content/loader";
import { toMatnListItem, type MatnListItem } from "../content/matnMeta";
import {
  getBestStreak,
  getDailyActivity,
  getMatnProgressMap,
  getPracticeStreak,
  getSessionTotals,
  listRecentSessions,
} from "../db/database";

export interface MatnProgress {
  matn: MatnListItem;
  linesDone: number;
  pct: number;
}

export interface ProgressStats {
  streak: number;
  bestStreak: number;
  /** Sessions per day, last 7 days, oldest first (index 6 = today). */
  week: number[];
  /** Sessions per day, last `heatmapWeeks * 7` days, oldest first. */
  heatmap: number[];
  heatmapWeeks: number;
  linesMemorized: number;
  minutesRecited: number;
  /** 0–100, or null before any recitation. */
  avgAccuracyPct: number | null;
  inProgress: MatnProgress[];
}

const HEATMAP_WEEKS = 14;

function wordsInRange(matnId: string, start: number, end: number): number {
  try {
    const lines = getLineRange(getMatn(matnId), start, end);
    return lines.reduce((n, l) => n + l.line.words.length, 0);
  } catch {
    // Session logged against a matn no longer bundled.
    return 0;
  }
}

/**
 * Word-accurate average accuracy: total mistakes over total expected words
 * across all logged sessions. The sessions table stores line ranges, not word
 * counts, so ranges are joined back to the bundled content here.
 */
async function computeAvgAccuracy(): Promise<number | null> {
  const sessions = await listRecentSessions(500);
  let words = 0;
  let mistakes = 0;
  for (const s of sessions) {
    words += wordsInRange(s.matn_id, s.start_line_index, s.end_line_index);
    mistakes += s.mistake_count;
  }
  if (words === 0) return null;
  return Math.max(0, Math.min(100, ((words - mistakes) / words) * 100));
}

export async function loadProgressStats(): Promise<ProgressStats> {
  const [streak, bestStreak, week, heatmap, totals, progressMap, avgAccuracyPct] =
    await Promise.all([
      getPracticeStreak(),
      getBestStreak(),
      getDailyActivity(7),
      getDailyActivity(HEATMAP_WEEKS * 7),
      getSessionTotals(),
      getMatnProgressMap(),
      computeAvgAccuracy(),
    ]);

  const inProgress: MatnProgress[] = listMatns()
    .map(toMatnListItem)
    .map((matn) => {
      const linesDone = Math.min(progressMap[matn.id] ?? 0, matn.totalLines);
      return {
        matn,
        linesDone,
        pct: matn.totalLines > 0 ? (linesDone / matn.totalLines) * 100 : 0,
      };
    })
    .filter((p) => p.linesDone > 0);

  return {
    streak,
    bestStreak,
    week,
    heatmap,
    heatmapWeeks: HEATMAP_WEEKS,
    linesMemorized: Object.entries(progressMap).reduce(
      (sum, [id, lines]) => {
        const total = inProgress.find((p) => p.matn.id === id)?.matn.totalLines;
        return sum + Math.min(lines, total ?? lines);
      },
      0
    ),
    minutesRecited: Math.round(totals.totalDurationSec / 60),
    avgAccuracyPct,
    inProgress,
  };
}
