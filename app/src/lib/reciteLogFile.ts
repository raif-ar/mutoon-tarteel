/**
 * Persists MutoonRecite console lines to the app documents directory for
 * post-session analysis (simulator path in Metro, Files app on device when
 * UIFileSharingEnabled is set).
 */

const LOG_DIR = "recite-logs";
const FLUSH_EVERY_LINES = 12;

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

function scheduleFlush(): void {
  if (!fileUri || !fs) return;
  flushChain = flushChain
    .then(async () => {
      if (!fileUri || !fs) return;
      await fs.writeAsStringAsync(fileUri, lines.join("\n") + "\n");
    })
    .catch(() => {
      /* ignore write races / transient FS errors */
    });
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

export async function beginReciteFileSession(
  meta: ReciteFileSessionMeta
): Promise<string | null> {
  if (!fs) fs = loadFs();
  const root = fs?.documentDirectory;
  if (!root) return null;

  await endReciteFileSession();

  const dirUri = `${root}${LOG_DIR}/`;
  await fs!.makeDirectoryAsync(dirUri, { intermediates: true });

  sessionMeta = meta;
  fileUri = `${dirUri}${sessionFileName(meta)}`;
  lines = [
    "# Mutoon Tarteel — recite log",
    `# started: ${new Date().toISOString()}`,
    `# file: ${fileUri}`,
    `# meta: ${JSON.stringify(meta)}`,
    "",
  ];

  scheduleFlush();
  return fileUri;
}

export async function endReciteFileSession(): Promise<string | null> {
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
  await flushChain;

  fileUri = null;
  sessionMeta = null;
  lines = [];
  return endedUri;
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
