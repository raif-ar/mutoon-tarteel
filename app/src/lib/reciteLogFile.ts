/**
 * Persists MutoonRecite log lines to the app documents directory for
 * post-session analysis (simulator path in Metro, Files app on device when
 * UIFileSharingEnabled is set, or shared from Settings).
 *
 * Nothing here throws: a file-system failure only means that session has no
 * log, it must never stop a recite session from starting.
 */

import {
  RECITE_BUILD_TAG,
  getReciteBuildFingerprint,
} from "./reciteBuildStamp";

const LOG_DIR = "recite-logs";
const FLUSH_EVERY_LINES = 12;
/** Logs kept on the phone, counting the session being written. */
const MAX_LOG_FILES = 5;

export interface ReciteFileSessionMeta {
  matnId?: string;
  asrMode?: string;
  startIdx?: number;
  endIdx?: number;
  totalWords?: number;
  lineCount?: number;
  provider?: string;
}

interface FsModule {
  documentDirectory: string | null;
  makeDirectoryAsync: (
    uri: string,
    options?: { intermediates?: boolean }
  ) => Promise<void>;
  writeAsStringAsync: (uri: string, contents: string) => Promise<void>;
  // Optional: without them old logs are not pruned or found, but writing still works.
  readDirectoryAsync?: (uri: string) => Promise<string[]>;
  deleteAsync?: (
    uri: string,
    options?: { idempotent?: boolean }
  ) => Promise<void>;
}

function loadFs(): FsModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("expo-file-system/legacy") as Partial<FsModule>;
    return mod?.documentDirectory != null &&
      typeof mod.makeDirectoryAsync === "function" &&
      typeof mod.writeAsStringAsync === "function"
      ? (mod as FsModule)
      : null;
  } catch {
    return null;
  }
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 48);
}

function sessionFileName(meta: ReciteFileSessionMeta): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const matn = sanitizeSegment(meta.matnId ?? "session");
  const mode = sanitizeSegment(meta.asrMode ?? "asr");
  return `${ts}_${matn}_${mode}.log`;
}

let fs: FsModule | null = null;
let fileUri: string | null = null;
let lines: string[] = [];
let flushChain: Promise<void> = Promise.resolve();
let sessionMeta: ReciteFileSessionMeta | null = null;
/** The last session that ended, so its log can be shared after Recite has closed. */
let lastFinishedUri: string | null = null;
/** Bumped by every begin and end, so a begin that was overtaken can tell and stop. */
let generation = 0;

function scheduleFlush(): void {
  const io = fs;
  const target = fileUri;
  if (!target || !io) return;
  // Snapshot now: the session may have ended (and a new one begun) by the time
  // the queued write runs.
  const contents = lines.join("\n") + "\n";
  flushChain = flushChain
    .then(() => io.writeAsStringAsync(target, contents))
    .catch(() => {
      /* ignore transient FS errors */
    });
}

/** Log file names in the directory, newest first. */
async function listLogNames(io: FsModule, dirUri: string): Promise<string[]> {
  if (!io.readDirectoryAsync) return [];
  try {
    const names = await io.readDirectoryAsync(dirUri);
    // Names start with a fixed-width ISO timestamp, so name order is time order.
    return names
      .filter((name) => name.endsWith(".log"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Delete all but the `keep` newest logs. */
async function pruneLogs(
  io: FsModule,
  dirUri: string,
  keep: number
): Promise<void> {
  if (!io.deleteAsync) return;
  const names = await listLogNames(io, dirUri);
  for (const name of names.slice(keep)) {
    try {
      await io.deleteAsync(`${dirUri}${name}`, { idempotent: true });
    } catch {
      /* a log that cannot be deleted is tried again next session */
    }
  }
}

/** Write the closing lines of the active session and forget it. */
async function finishActiveSession(): Promise<string | null> {
  const endedUri = fileUri;
  if (!endedUri || !fs) {
    fileUri = null;
    sessionMeta = null;
    lines = [];
    return null;
  }

  lines.push(
    "",
    `# ended: ${new Date().toISOString()}`,
    `# meta: ${JSON.stringify(sessionMeta ?? {})}`
  );
  scheduleFlush();

  // Cleared before the write is awaited, so a session that begins meanwhile
  // starts from a clean state instead of having it wiped under it.
  fileUri = null;
  sessionMeta = null;
  lines = [];
  lastFinishedUri = endedUri;

  await flushChain;
  return endedUri;
}

export function isReciteFileLogAvailable(): boolean {
  if (!fs) fs = loadFs();
  return fs?.documentDirectory != null;
}

export function getReciteLogDirectoryUri(): string | null {
  if (!fs) fs = loadFs();
  if (!fs?.documentDirectory) return null;
  return `${fs.documentDirectory}${LOG_DIR}/`;
}

export function getActiveReciteLogUri(): string | null {
  return fileUri;
}

/**
 * The newest log on the phone: the session being written, else the last one
 * that ended, else (after an app restart) the newest file in the directory.
 */
export async function getLatestReciteLogUri(): Promise<string | null> {
  if (fileUri) return fileUri;
  if (lastFinishedUri) return lastFinishedUri;
  if (!fs) fs = loadFs();
  const dirUri = getReciteLogDirectoryUri();
  if (!fs || !dirUri) return null;
  const [newest] = await listLogNames(fs, dirUri);
  return newest ? `${dirUri}${newest}` : null;
}

export async function beginReciteFileSession(
  meta: ReciteFileSessionMeta
): Promise<string | null> {
  if (!fs) fs = loadFs();
  const io = fs;
  const root = io?.documentDirectory;
  if (!io || !root) return null;

  generation += 1;
  const mine = generation;

  await finishActiveSession();

  const dirUri = `${root}${LOG_DIR}/`;
  try {
    await io.makeDirectoryAsync(dirUri, { intermediates: true });
  } catch {
    return null;
  }
  await pruneLogs(io, dirUri, MAX_LOG_FILES - 1);

  // The session was ended, or another one begun, while the directory was being
  // prepared: do not open a file nobody will close.
  if (mine !== generation) return null;

  sessionMeta = meta;
  fileUri = `${dirUri}${sessionFileName(meta)}`;
  const build = getReciteBuildFingerprint();
  lines = [
    "# Mutoon Tarteel — recite log",
    `# ${RECITE_BUILD_TAG}`,
    `# build: ${JSON.stringify(build)}`,
    `# started: ${new Date().toISOString()}`,
    `# file: ${fileUri}`,
    `# meta: ${JSON.stringify(meta)}`,
    "",
    `[MutoonRecite] BUILD_STAMP ${JSON.stringify(build)}`,
    "",
  ];

  scheduleFlush();
  return fileUri;
}

export async function endReciteFileSession(): Promise<string | null> {
  generation += 1;
  return finishActiveSession();
}

/** Append one console line (including the [MutoonRecite] prefix). */
export function appendReciteFileLine(line: string): void {
  if (!fileUri) return;
  lines.push(line);
  if (lines.length % FLUSH_EVERY_LINES === 0) {
    scheduleFlush();
  }
}

/** Force buffered lines to disk and wait for the write (e.g. before sharing). */
export async function flushReciteFileLog(): Promise<void> {
  scheduleFlush();
  await flushChain;
}
