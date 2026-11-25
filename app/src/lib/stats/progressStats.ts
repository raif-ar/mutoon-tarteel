import {
  flattenLines,
  getLineRange,
  getMatn,
  getSectionRanges,
  listMatns,
  type SectionRange,
} from "../content/loader";
import { toMatnListItem, type MatnListItem } from "../content/matnMeta";
import {
  getBestStreak,
  getDailyActivity,
  getMatnProgressMap,
  getPracticeStreak,
  getSecondsRecitedToday,
  getSessionRanges,
  getSessionTotals,
  getSetting,
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
  /** Seconds recited today and the daily pace in minutes. */
  secondsToday: number;
  dailyGoalMin: number;
}

export const DEFAULT_DAILY_GOAL_MIN = 10;

export interface DailyPace {
  secondsToday: number;
  goalMin: number;
  /** Whole minutes recited today. */
  minutesToday: number;
  /** 0..1 */
  fraction: number;
}

export async function loadDailyPace(): Promise<DailyPace> {
  const [secondsToday, goal] = await Promise.all([getSecondsRecitedToday(), getSetting("dailyGoalMin")]);
  const goalMin = Number(goal) > 0 ? Number(goal) : DEFAULT_DAILY_GOAL_MIN;
  return {
    secondsToday,
    goalMin,
    minutesToday: Math.floor(secondsToday / 60),
    fraction: Math.min(1, secondsToday / (goalMin * 60)),
  };
}

/** Which lines of a matn have been recited, from the union of session ranges. */
export function coveredLines(total: number, ranges: Array<{ s: number; e: number }>): boolean[] {
  const covered = new Array<boolean>(total).fill(false);
  for (const r of ranges) {
    for (let i = Math.max(0, r.s); i <= Math.min(total - 1, r.e); i++) covered[i] = true;
  }
  return covered;
}

export interface MatnCoverage {
  covered: boolean[];
  linesDone: number;
  totalLines: number;
  /** First line not yet recited; equals totalLines when the matn is complete. */
  nextLine: number;
  sections: Array<SectionRange & { total: number; done: number }>;
}

export async function loadMatnCoverage(matnId: string): Promise<MatnCoverage> {
  const matn = getMatn(matnId);
  const totalLines = flattenLines(matn).length;
  const covered = coveredLines(totalLines, await getSessionRanges(matnId));
  const firstGap = covered.indexOf(false);
  return {
    covered,
    linesDone: covered.filter(Boolean).length,
    totalLines,
    nextLine: firstGap === -1 ? totalLines : firstGap,
    sections: getSectionRanges(matn).map((sec) => {
      let done = 0;
      for (let i = sec.from; i <= sec.to; i++) if (covered[i]) done++;
      return { ...sec, total: sec.to - sec.from + 1, done };
    }),
  };
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
    // Practice sessions (scattered lines) are logged with an empty range.
    if (s.end_line_index < s.start_line_index) continue;
    words += wordsInRange(s.matn_id, s.start_line_index, s.end_line_index);
    mistakes += s.mistake_count;
  }
  if (words === 0) return null;
  return Math.max(0, Math.min(100, ((words - mistakes) / words) * 100));
}

export async function loadProgressStats(): Promise<ProgressStats> {
  const [streak, bestStreak, week, heatmap, totals, progressMap, avgAccuracyPct, pace] =
    await Promise.all([
      getPracticeStreak(),
      getBestStreak(),
      getDailyActivity(7),
      getDailyActivity(HEATMAP_WEEKS * 7),
      getSessionTotals(),
      getMatnProgressMap(),
      computeAvgAccuracy(),
      loadDailyPace(),
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
    secondsToday: pace.secondsToday,
    dailyGoalMin: pace.goalMin,
  };
}
