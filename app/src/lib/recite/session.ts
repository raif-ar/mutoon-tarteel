/**
 * What a Recite session covers, how it is described in route params, and how
 * it is saved at the end.
 */
import type { MatnDocument, FlatLineRef } from "../../types/content";
import { flattenLines, flattenSessionWords, getLineRange, getLinesByIndex } from "../content/loader";
import { logSession, saveSlips, type SlipInput } from "../db/database";
import type { ReciteEngineState, Slip, SlipKind } from "./types";

/** `recite`: a run of consecutive lines. `practice`: only the lines that had a slip. */
export type ReciteMode = "recite" | "practice";

// A type alias (not an interface) so it is assignable to expo-router's params record.
export type ReciteRouteParams = {
  id: string;
  /** First and last line (matn-wide index, inclusive) of a `recite` session. */
  start?: string;
  end?: string;
  /** Comma-separated matn-wide line indices of a `practice` session. */
  lines?: string;
};

export interface ReciteSessionPlan {
  mode: ReciteMode;
  lines: FlatLineRef[];
}

export function planFromParams(matn: MatnDocument, params: ReciteRouteParams): ReciteSessionPlan {
  const all = flattenLines(matn);
  if (params.lines) {
    const indices = params.lines
      .split(",")
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n >= 0 && n < all.length);
    if (indices.length > 0) return { mode: "practice", lines: getLinesByIndex(matn, indices) };
  }
  const last = Math.max(0, all.length - 1);
  const start = clampIndex(params.start, 0, last);
  const end = Math.max(start, clampIndex(params.end, last, last));
  return { mode: "recite", lines: getLineRange(matn, start, end) };
}

function clampIndex(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw);
  if (raw == null || raw === "" || !Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(n)));
}

/** Route params for reciting lines `start`..`end` (matn-wide indices, inclusive). */
export function reciteParams(matnId: string, start: number, end: number): ReciteRouteParams {
  return { id: matnId, start: String(start), end: String(end) };
}

/** Route params for a practice session over these matn-wide line indices. */
export function practiceParams(matnId: string, lineIndices: number[]): ReciteRouteParams {
  const unique = [...new Set(lineIndices)].sort((a, b) => a - b);
  return { id: matnId, lines: unique.join(",") };
}

/** One slip of the session just finished, for the summary screen. */
export interface SessionSlip {
  kind: SlipKind;
  /** Matn-wide line index and its 1-based number as shown to the user. */
  lineIndex: number;
  lineNumber: number;
  lineId: string;
  wordIndex: number;
  expectedWord: string;
  heard: string;
}

export interface SessionResult {
  matnId: string;
  mode: ReciteMode;
  /** Lines recited to their last word. */
  linesPassed: number;
  seconds: number;
  /** 0-100 over the words recited. */
  accuracy: number;
  slips: SessionSlip[];
  /** A practice session that left no slip behind. */
  cleared: boolean;
}

function toSessionSlip(slip: Slip, lines: FlatLineRef[]): SessionSlip {
  const ref = lines[slip.lineIndex];
  return {
    kind: slip.kind,
    lineIndex: ref.globalIndex,
    lineNumber: ref.globalIndex + 1,
    lineId: ref.line.id,
    wordIndex: slip.wordIndex,
    expectedWord: slip.expectedWord,
    heard: slip.heard,
  };
}

/** Pure summary of a finished session (no I/O). */
export function summarizeSession(
  matnId: string,
  plan: ReciteSessionPlan,
  finalState: ReciteEngineState,
  listenedSec: number
): SessionResult & { passedLineIds: string[] } {
  const words = flattenSessionWords(plan.lines);
  const cursor = Math.min(finalState.wordCursor, words.length);
  let linesPassed = 0;
  const passedLineIds: string[] = [];
  let seen = 0;
  for (const l of plan.lines) {
    seen += l.line.words.length;
    if (seen > cursor) break;
    linesPassed++;
    passedLineIds.push(l.line.id);
  }
  // A slip can sit on the word at the cursor (a wrong attempt the reciter stopped on).
  const slips = finalState.mistakes.filter((m) => m.globalWordIndex <= cursor && m.globalWordIndex < words.length).map((m) => toSessionSlip(m, plan.lines));
  const accuracy = cursor > 0 ? Math.max(0, Math.min(100, ((cursor - slips.length) / cursor) * 100)) : 100;
  return {
    matnId,
    mode: plan.mode,
    linesPassed,
    seconds: Math.max(0, Math.round(listenedSec)),
    accuracy,
    slips,
    cleared: plan.mode === "practice" && slips.length === 0 && linesPassed > 0,
    passedLineIds,
  };
}

/**
 * Save a finished session: one `sessions` row (time, range, slip count) and the
 * review list (new slips in, cleanly recited lines out).
 */
export async function saveSession(
  matnId: string,
  plan: ReciteSessionPlan,
  finalState: ReciteEngineState,
  listenedSec: number
): Promise<SessionResult> {
  const { passedLineIds, ...result } = summarizeSession(matnId, plan, finalState, listenedSec);
  if (plan.lines.length === 0) return result;
  const start = plan.lines[0].globalIndex;
  // A practice session covers scattered lines: it is logged with an empty range
  // so it counts for time and streak but not for progress.
  const end = plan.mode === "recite" ? start + result.linesPassed - 1 : start - 1;
  const slipLineIds = new Set(result.slips.map((s) => s.lineId));
  const slipInputs: SlipInput[] = result.slips.map((s) => ({
    line_id: s.lineId,
    word_index: s.wordIndex,
    line_index: s.lineIndex,
    kind: s.kind,
    expected_word: s.expectedWord,
    said_word: s.kind === "skipped" || !s.heard ? null : s.heard,
  }));
  await logSession({
    matn_id: matnId,
    start_line_index: start,
    end_line_index: end,
    duration_sec: result.seconds,
    mistake_count: result.slips.length,
  });
  await saveSlips(matnId, slipInputs, passedLineIds.filter((id) => !slipLineIds.has(id)));
  return result;
}

let lastResult: SessionResult | null = null;
/** Hand the finished session to the summary screen (too rich for route params). */
export function setLastSessionResult(result: SessionResult | null): void {
  lastResult = result;
}
export function getLastSessionResult(): SessionResult | null {
  return lastResult;
}
