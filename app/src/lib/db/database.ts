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
      `);
      return db;
    })();
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

export async function logSession(input: Omit<SessionRow, "id" | "created_at">): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO sessions (matn_id, start_line_index, end_line_index, duration_sec, mistake_count) VALUES (?, ?, ?, ?, ?)`,
    [input.matn_id, input.start_line_index, input.end_line_index, input.duration_sec, input.mistake_count]
  );
}

/** Highest line index reached per matn (from past sessions). */
export async function getMatnProgressMap(): Promise<Record<string, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ matn_id: string; max_end: number }>(
    `SELECT matn_id, MAX(end_line_index) + 1 as max_end FROM sessions GROUP BY matn_id`
  );
  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row.matn_id] = row.max_end;
  }
  return out;
}

export async function getPracticeStreak(): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ day: string }>(
    `SELECT DISTINCT date(created_at) as day FROM sessions ORDER BY day DESC LIMIT 60`
  );
  if (rows.length === 0) return 0;
  let streak = 1;
  for (let i = 1; i < rows.length; i++) {
    const prev = new Date(rows[i - 1].day);
    const curr = new Date(rows[i].day);
    const diff = (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24);
    if (diff === 1) streak += 1;
    else break;
  }
  return streak;
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
