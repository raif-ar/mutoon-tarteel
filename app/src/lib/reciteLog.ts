/**
 * Structured recite / ASR logs for Metro and Xcode consoles.
 * Filter with: MutoonRecite
 *
 * When file logging is enabled, the same lines are written under
 * <Documents>/recite-logs/*.log (see beginFileSession / getActiveLogFileUri).
 */

import {
  appendReciteFileLine,
  beginReciteFileSession,
  endReciteFileSession,
  flushReciteFileLog,
  getActiveReciteLogUri,
  getReciteLogDirectoryUri,
  type ReciteFileSessionMeta,
} from "./reciteLogFile";

const PREFIX = "[MutoonRecite]";

/** Set true to log in release builds when debugging on device. */
export const RECITE_LOG_FORCE = false;

/** Mirror logs to a session file under app Documents (on by default in __DEV__). */
export const RECITE_LOG_TO_FILE =
  RECITE_LOG_FORCE || (typeof __DEV__ !== "undefined" && __DEV__);

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
   * session.screen when RECITE_LOG_TO_FILE is enabled.
   */
  async beginFileSession(meta: ReciteFileSessionMeta): Promise<void> {
    if (!fileEnabled()) return;
    seq = 0;
    const uri = await beginReciteFileSession(meta);
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

  getLogDirectoryUri(): string | null {
    return getReciteLogDirectoryUri();
  },
};
