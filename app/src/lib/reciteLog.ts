/**
 * Structured recite / ASR logs for Metro and Xcode consoles.
 * Filter with: MutoonRecite
 *
 * The same lines are written under <Documents>/recite-logs/*.log in every
 * build (see beginFileSession / getLatestLogFileUri), so a tester can send the
 * log of a session that looked wrong. Console output stays dev-only.
 */

import {
  appendReciteFileLine,
  beginReciteFileSession,
  endReciteFileSession,
  flushReciteFileLog,
  getActiveReciteLogUri,
  getLatestReciteLogUri,
  getReciteLogDirectoryUri,
  type ReciteFileSessionMeta,
} from "./reciteLogFile";

const PREFIX = "[MutoonRecite]";

/** Set true to also log to the console in release builds when debugging on device. */
export const RECITE_LOG_FORCE = false;

/**
 * Mirror logs to a session file under app Documents. On in release too: the
 * log is the only record of what the listener heard once a build is on a
 * tester's phone. Only the newest few files are kept.
 */
export const RECITE_LOG_TO_FILE: boolean = true;

const consoleEnabled = () =>
  RECITE_LOG_FORCE || (typeof __DEV__ !== "undefined" && __DEV__);

const fileEnabled = () => RECITE_LOG_TO_FILE;

let seq = 0;

function nextId(): number {
  seq += 1;
  return seq;
}

function previewWords(words: string[], max = 10): string {
  if (words.length === 0) return "(none)";
  if (words.length <= max) return words.join(" · ");
  return `${words.slice(0, max).join(" · ")} … (+${words.length - max} more)`;
}

function formatLine(
  level: "log" | "warn" | "error",
  event: string,
  data?: Record<string, unknown>
): string {
  const id = nextId();
  const payload = data ? ` ${JSON.stringify(data)}` : "";
  const tag = level === "warn" ? " WARN" : level === "error" ? " ERROR" : "";
  return `${PREFIX} #${id}${tag} ${event}${payload}`;
}

function write(
  level: "log" | "warn" | "error",
  event: string,
  data?: Record<string, unknown>
): void {
  const line = formatLine(level, event, data);
  const toConsole = consoleEnabled();
  const toFile = fileEnabled();

  if (!toConsole && !toFile) return;

  if (toConsole) {
    if (level === "warn") console.warn(line);
    else if (level === "error") console.error(line);
    else console.log(line);
  }
  if (toFile) {
    appendReciteFileLine(line);
  }
}

export const reciteLog = {
  session(event: string, data?: Record<string, unknown>): void {
    write("log", `session.${event}`, data);
  },

  listen(event: string, data?: Record<string, unknown>): void {
    write("log", `listen.${event}`, data);
  },

  asr(event: string, data?: Record<string, unknown>): void {
    write("log", `asr.${event}`, data);
  },

  align(event: string, data?: Record<string, unknown>): void {
    write("log", `align.${event}`, data);
  },

  cursor(event: string, data?: Record<string, unknown>): void {
    write("log", `cursor.${event}`, data);
  },

  mistake(data: Record<string, unknown>): void {
    write("warn", "mistake", data);
  },

  warn(event: string, data?: Record<string, unknown>): void {
    write("warn", event, data);
  },

  error(event: string, data?: Record<string, unknown>): void {
    write("error", event, data);
  },

  previewWords,

  /**
   * Start (or replace) the on-disk session log. Called automatically on
   * session.screen when RECITE_LOG_TO_FILE is enabled. Never rejects: the
   * Recite screen awaits it before creating the engine.
   */
  async beginFileSession(meta: ReciteFileSessionMeta): Promise<void> {
    if (!fileEnabled()) return;
    seq = 0;
    let uri: string | null = null;
    try {
      uri = await beginReciteFileSession(meta);
    } catch {
      uri = null;
    }
    if (!uri) return;
    const dir = getReciteLogDirectoryUri();
    if (consoleEnabled()) {
      console.log(`${PREFIX} fileLog.begin ${JSON.stringify({ file: uri, dir })}`);
    }
    appendReciteFileLine(
      `${PREFIX} fileLog.begin ${JSON.stringify({ file: uri, dir })}`
    );
  },

  /** Flush and close the active session log (call on screen unmount). */
  async endFileSession(): Promise<void> {
    if (!fileEnabled()) return;
    const uri = await endReciteFileSession();
    if (!uri) return;
    if (consoleEnabled()) {
      console.log(`${PREFIX} fileLog.end ${JSON.stringify({ file: uri })}`);
    }
  },

  /** Force buffered log lines to disk (call before sharing the file). */
  async flushFileLog(): Promise<void> {
    if (!fileEnabled()) return;
    await flushReciteFileLog();
  },

  getActiveLogFileUri(): string | null {
    return getActiveReciteLogUri();
  },

  /**
   * The newest log on the phone (the running session, else the last finished
   * one), or null when nothing has been recited yet. Flush first when sharing.
   */
  async getLatestLogFileUri(): Promise<string | null> {
    if (!fileEnabled()) return null;
    try {
      return await getLatestReciteLogUri();
    } catch {
      return null;
    }
  },

  getLogDirectoryUri(): string | null {
    return getReciteLogDirectoryUri();
  },
};
