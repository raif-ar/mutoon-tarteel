import * as SQLite from "expo-sqlite";

export interface MistakeRow {
  id: number;
  matn_id: string;
  line_id: string;
  kind: string;
  expected_word: string | null;
  recognized_word: string | null;
  created_at: string;
}

export interface GoalRow {
  id: number;
  matn_id: string;
  title: string;
  start_line_index: number;
  end_line_index: number;
  target_date: string | null;
  completed: number;
  created_at: string;
}

export interface SessionRow {
  id: number;
  matn_id: string;
  start_line_index: number;
  end_line_index: number;
  duration_sec: number;
  mistake_count: number;
  created_at: string;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("mutoon.db");
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS mistakes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          matn_id TEXT NOT NULL,
          line_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          expected_word TEXT,
          recognized_word TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS goals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          matn_id TEXT NOT NULL,
          title TEXT NOT NULL,
          start_line_index INTEGER NOT NULL,
          end_line_index INTEGER NOT NULL,
          target_date TEXT,
          completed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          matn_id TEXT NOT NULL,
          start_line_index INTEGER NOT NULL,
          end_line_index INTEGER NOT NULL,
          duration_sec INTEGER NOT NULL DEFAULT 0,
          mistake_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS slips (
          matn_id TEXT NOT NULL,
          line_id TEXT NOT NULL,
          word_index INTEGER NOT NULL,
          line_index INTEGER NOT NULL,
          kind TEXT NOT NULL,
          expected_word TEXT NOT NULL,
          said_word TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (matn_id, line_id, word_index)
        );
      `);
      return db;
    })().catch((e) => {
      // Don't cache a failed open: the next call retries.
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

export async function logMistakes(
  matnId: string,
  lineId: string,
  items: Array<{
    kind: string;
    expectedWord: string | null;
    recognizedWord: string | null;
  }>
): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  for (const m of items) {
    await db.runAsync(
      `INSERT INTO mistakes (matn_id, line_id, kind, expected_word, recognized_word) VALUES (?, ?, ?, ?, ?)`,
      [matnId, lineId, m.kind, m.expectedWord, m.recognizedWord]
    );
  }
}

export async function getWeakLines(matnId: string, limit = 20): Promise<
  Array<{ line_id: string; count: number }>
> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT line_id, COUNT(*) as count FROM mistakes WHERE matn_id = ? GROUP BY line_id ORDER BY count DESC LIMIT ?`,
    [matnId, limit]
  );
}

export async function getRecentMistakes(limit = 50): Promise<MistakeRow[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT * FROM mistakes ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

export async function createGoal(input: Omit<GoalRow, "id" | "created_at" | "completed">): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO goals (matn_id, title, start_line_index, end_line_index, target_date) VALUES (?, ?, ?, ?, ?)`,
    [input.matn_id, input.title, input.start_line_index, input.end_line_index, input.target_date]
  );
  return result.lastInsertRowId;
}

export async function listGoals(): Promise<GoalRow[]> {
  const db = await getDb();
  return db.getAllAsync(`SELECT * FROM goals ORDER BY completed ASC, target_date ASC`);
}

export async function completeGoal(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE goals SET completed = 1 WHERE id = ?`, [id]);
}

export type SessionInput = Omit<SessionRow, "id" | "created_at">;

/**
 * Log one recitation. It is usually one row; a session with a left-out line is
 * several line ranges, stored as rows that share one timestamp.
 */
export async function logSessionRows(rows: SessionInput[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  const now = await db.getFirstAsync<{ t: string }>(`SELECT datetime('now') AS t`);
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      await db.runAsync(
        `INSERT INTO sessions (matn_id, start_line_index, end_line_index, duration_sec, mistake_count, created_at)
         VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
        [r.matn_id, r.start_line_index, r.end_line_index, r.duration_sec, r.mistake_count, now?.t ?? null]
      );
    }
  });
}

export interface SessionRange {
  matn_id: string;
  /** First and last fully recited line (matn-wide indices, inclusive). */
  s: number;
  e: number;
}

/**
 * Line ranges covered by past sessions. A session that covered no full line,
 * and every practice session (scattered lines), is logged with
 * `end_line_index = start_line_index - 1` and is excluded here.
 */
export async function getSessionRanges(matnId?: string): Promise<SessionRange[]> {
  const db = await getDb();
  if (matnId) {
    return db.getAllAsync<SessionRange>(
      `SELECT DISTINCT matn_id, start_line_index AS s, end_line_index AS e
       FROM sessions WHERE end_line_index >= start_line_index AND matn_id = ? ORDER BY s`,
      [matnId]
    );
  }
  return db.getAllAsync<SessionRange>(
    `SELECT DISTINCT matn_id, start_line_index AS s, end_line_index AS e
     FROM sessions WHERE end_line_index >= start_line_index ORDER BY matn_id, s`
  );
}

/** Lines recited at least once per matn (the union of all session ranges). */
export async function getMatnProgressMap(): Promise<Record<string, number>> {
  const ranges = await getSessionRanges();
  const out: Record<string, number> = {};
  let matn = "";
  let reach = -1; // last line already counted for the current matn
  for (const r of ranges) {
    if (r.matn_id !== matn) {
      matn = r.matn_id;
      reach = -1;
      out[matn] = 0;
    }
    const from = Math.max(r.s, reach + 1);
    if (r.e >= from) {
      out[matn] += r.e - from + 1;
      reach = r.e;
    }
  }
  return out;
}

/** Seconds spent reciting today (local day), for the daily pace. */
export async function getSecondsRecitedToday(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ sec: number }>(
    `SELECT COALESCE(SUM(duration_sec), 0) AS sec FROM sessions
     WHERE date(created_at, 'localtime') = date('now', 'localtime')`
  );
  return row?.sec ?? 0;
}

const DAY_MS = 1000 * 60 * 60 * 24;

/** Consecutive practice days ending today or yesterday (local days). */
export async function getPracticeStreak(): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ day: string }>(
    `SELECT DISTINCT date(created_at, 'localtime') as day FROM sessions ORDER BY day DESC LIMIT 400`
  );
  if (rows.length === 0) return 0;
  if (rows[0].day !== localDay(0) && rows[0].day !== localDay(1)) return 0;
  let streak = 1;
  for (let i = 1; i < rows.length; i++) {
    const prev = new Date(rows[i - 1].day);
    const curr = new Date(rows[i].day);
    if (Math.round((prev.getTime() - curr.getTime()) / DAY_MS) === 1) streak += 1;
    else break;
  }
  return streak;
}
/** Longest run of consecutive practice days on record. */
export async function getBestStreak(): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ day: string }>(
    `SELECT DISTINCT date(created_at, 'localtime') as day FROM sessions ORDER BY day ASC`
  );
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const row of rows) {
    const curr = new Date(row.day);
    const diff = prev ? Math.round((curr.getTime() - prev.getTime()) / DAY_MS) : NaN;
    run = diff === 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = curr;
  }
  return best;
}

/** Local YYYY-MM-DD for "today - offset days". */
function localDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Practice activity for the last `days` days as sessions-per-day, oldest
 * first and ending today. Index `days - 1` is today.
 */
export async function getDailyActivity(days: number): Promise<number[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ day: string; count: number }>(
    `SELECT date(created_at, 'localtime') as day, COUNT(DISTINCT created_at) as count
     FROM sessions
     WHERE date(created_at, 'localtime') >= date('now', 'localtime', ?)
     GROUP BY day`,
    [`-${days - 1} days`]
  );
  const byDay = new Map(rows.map((r) => [r.day, r.count]));
  const out: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(byDay.get(localDay(i)) ?? 0);
  }
  return out;
}

export interface SessionTotals {
  sessionCount: number;
  totalDurationSec: number;
  totalMistakes: number;
  /** Sum over sessions of lines covered (end - start + 1). */
  totalLines: number;
}

export async function getSessionTotals(): Promise<SessionTotals> {
  const db = await getDb();
  const row = await db.getFirstAsync<{
    n: number;
    dur: number | null;
    mistakes: number | null;
    lines: number | null;
  }>(
    `SELECT COUNT(DISTINCT created_at) as n,
            SUM(duration_sec) as dur,
            SUM(mistake_count) as mistakes,
            SUM(MAX(0, end_line_index - start_line_index + 1)) as lines
     FROM sessions`
  );
  return {
    sessionCount: row?.n ?? 0,
    totalDurationSec: row?.dur ?? 0,
    totalMistakes: row?.mistakes ?? 0,
    totalLines: row?.lines ?? 0,
  };
}

export async function listRecentSessions(limit = 50): Promise<SessionRow[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM settings WHERE key = ?`,
    [key]
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

/** Stored settings and their defaults. */
export const SETTING_DEFAULTS = {
  onboarded: "0",
  dailyGoalMin: "10",
  /** Recite starts with the text hidden. */
  hideTextDefault: "1",
  /** Slips turn red while reciting (off: they wait for the summary). */
  markSlipsLive: "1",
} as const;
export type SettingKey = keyof typeof SETTING_DEFAULTS;

/** All settings in one read: stored values over defaults. */
export async function getSettings(): Promise<Record<SettingKey, string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  const out: Record<string, string> = { ...SETTING_DEFAULTS };
  for (const r of rows) if (r.key in SETTING_DEFAULTS) out[r.key] = r.value;
  return out as Record<SettingKey, string>;
}

export type SlipKind = "wrong" | "skipped";

/** A word still to review: slipped in a session and not yet recited cleanly since. */
export interface SlipRow {
  matn_id: string;
  line_id: string;
  word_index: number;
  /** Matn-wide line index when the slip was saved. */
  line_index: number;
  kind: SlipKind;
  expected_word: string;
  /** Approximation of what was heard; null when the word was skipped. */
  said_word: string | null;
  created_at: string;
}
export type SlipInput = Omit<SlipRow, "matn_id" | "created_at">;

/**
 * End of a session: lines recited cleanly leave the review list, and this
 * session's slips join it (one row per matn + line + word).
 */
export async function saveSlips(matnId: string, slips: SlipInput[], cleanLineIds: string[]): Promise<void> {
  if (slips.length === 0 && cleanLineIds.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    if (cleanLineIds.length > 0) {
      await db.runAsync(
        `DELETE FROM slips WHERE matn_id = ? AND line_id IN (${cleanLineIds.map(() => "?").join(", ")})`,
        [matnId, ...cleanLineIds]
      );
    }
    for (const sl of slips) {
      await db.runAsync(
        `INSERT INTO slips (matn_id, line_id, word_index, line_index, kind, expected_word, said_word)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(matn_id, line_id, word_index) DO UPDATE SET
           line_index = excluded.line_index, kind = excluded.kind,
           expected_word = excluded.expected_word, said_word = excluded.said_word,
           created_at = datetime('now')`,
        [matnId, sl.line_id, sl.word_index, sl.line_index, sl.kind, sl.expected_word, sl.said_word]
      );
    }
  });
}

/** Words to review, newest first. */
export async function listSlips(matnId?: string): Promise<SlipRow[]> {
  const db = await getDb();
  if (matnId) {
    return db.getAllAsync<SlipRow>(`SELECT * FROM slips WHERE matn_id = ? ORDER BY created_at DESC, rowid DESC`, [matnId]);
  }
  return db.getAllAsync<SlipRow>(`SELECT * FROM slips ORDER BY created_at DESC, rowid DESC`);
}
