/**
 * Structured recite / ASR logs for Metro and Xcode consoles.
 * Filter with: MutoonRecite
 */

const PREFIX = "[MutoonRecite]";

/** Set true to log in release builds when debugging on device. */
export const RECITE_LOG_FORCE = false;

const enabled = () => RECITE_LOG_FORCE || (typeof __DEV__ !== "undefined" && __DEV__);

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

function write(
  level: "log" | "warn" | "error",
  event: string,
  data?: Record<string, unknown>
): void {
  if (!enabled()) return;
  const id = nextId();
  const payload = data ? ` ${JSON.stringify(data)}` : "";
  const line = `${PREFIX} #${id} ${event}${payload}`;
  if (level === "warn") console.warn(line);
  else if (level === "error") console.error(line);
  else console.log(line);
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
};
