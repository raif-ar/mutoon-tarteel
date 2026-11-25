/**
 * What a Recite session covers, how it is described in route params, and how
 * it is saved at the end.
 */
import type { MatnDocument, FlatLineRef } from "../../types/content";
import { flattenLines, flattenSessionWords, getLineRange, getLinesByIndex } from "../content/loader";
import { logSessionRows, saveSlips, type SessionInput, type SlipInput } from "../db/database";
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

/** Words too short for the aligner to flag on their own (one consonant), so a left-out line never shows them as slips. */
function isShortWord(word: string): boolean {
  const consonants = word.replace(/[\u064B-\u0652\u0670\u0640]/g, "").replace(/[اوىي]/g, "");
  return consonants.length <= 1;
}

export interface SessionSummary extends SessionResult {
  /** Matn-wide indices of the lines actually recited (passed and not left out), in order. */
  recitedLineIndices: number[];
  /** Line ids recited with no slip at all: these leave the review list. */
  cleanLineIds: string[];
}

/** Pure summary of a finished session (no I/O). */
export function summarizeSession(
  matnId: string,
  plan: ReciteSessionPlan,
  finalState: ReciteEngineState,
  listenedSec: number
): SessionSummary {
  const words = flattenSessionWords(plan.lines);
  const cursor = Math.min(finalState.wordCursor, words.length);
  // A slip can sit on the word at the cursor (a wrong attempt the reciter stopped on).
  const kept = finalState.mistakes.filter((m) => m.globalWordIndex <= cursor && m.globalWordIndex < words.length);
  const judged = cursor + (kept.some((m) => m.globalWordIndex === cursor) ? 1 : 0);
  const slips = kept.map((m) => toSessionSlip(m, plan.lines));
  const accuracy = judged > 0 ? Math.max(0, Math.min(100, ((judged - slips.length) / judged) * 100)) : 100;

  const recitedLineIndices: number[] = [];
  const cleanLineIds: string[] = [];
  let seen = 0;
  for (let li = 0; li < plan.lines.length; li++) {
    const line = plan.lines[li];
    seen += line.line.words.length;
    if (seen > cursor) break;
    const lineSlips = kept.filter((m) => m.lineIndex === li);
    // The cursor moves past a line the reciter left out (its words come back as skipped):
    // that line was not recited.
    const skipped = lineSlips.filter((m) => m.kind === "skipped").length;
    const flaggable = line.line.words.filter((w) => !isShortWord(w)).length;
    const leftOut = skipped >= 2 && skipped >= flaggable;
    if (leftOut) continue;
    recitedLineIndices.push(line.globalIndex);
    if (lineSlips.length === 0) cleanLineIds.push(line.line.id);
  }
  return {
    matnId,
    mode: plan.mode,
    linesPassed: recitedLineIndices.length,
    seconds: Math.max(0, Math.round(listenedSec)),
    accuracy,
    slips,
    cleared: plan.mode === "practice" && slips.length === 0 && recitedLineIndices.length > 0,
    recitedLineIndices,
    cleanLineIds,
  };
}

/** Consecutive runs of line indices, as inclusive [start, end] ranges. */
function contiguousRuns(indices: number[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (const i of indices) {
    const last = runs[runs.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else runs.push([i, i]);
  }
  return runs;
}

/**
 * Save a finished session: its `sessions` rows (time, recited ranges, slip count) and the
 * review list (new slips in, cleanly recited lines out).
 */
export async function saveSession(
  matnId: string,
  plan: ReciteSessionPlan,
  finalState: ReciteEngineState,
  listenedSec: number
): Promise<SessionResult> {
  const { recitedLineIndices, cleanLineIds, ...result } = summarizeSession(matnId, plan, finalState, listenedSec);
  if (plan.lines.length === 0) return result;
  const start = plan.lines[0].globalIndex;
  // A practice session covers scattered lines: it is logged with an empty range so it counts
  // for time and streak but not for progress. A session that finished no line is the same.
  const runs = plan.mode === "recite" ? contiguousRuns(recitedLineIndices) : [];
  const recited = new Set(recitedLineIndices);
  // Only slips inside the logged ranges, so stored slips and stored lines describe the same words.
  const countedSlips = plan.mode === "recite" ? result.slips.filter((s) => recited.has(s.lineIndex)).length : result.slips.length;
  const rows: SessionInput[] =
    runs.length === 0
      ? [{ matn_id: matnId, start_line_index: start, end_line_index: start - 1, duration_sec: result.seconds, mistake_count: countedSlips }]
      : runs.map(([from, to], i) => ({
          matn_id: matnId,
          start_line_index: from,
          end_line_index: to,
          // A left-out line splits the session into runs: the first row carries the totals.
          duration_sec: i === 0 ? result.seconds : 0,
          mistake_count: i === 0 ? countedSlips : 0,
        }));
  const slipInputs: SlipInput[] = result.slips.map((s) => ({
    line_id: s.lineId,
    word_index: s.wordIndex,
    line_index: s.lineIndex,
    kind: s.kind,
    expected_word: s.expectedWord,
    said_word: s.kind === "skipped" || !s.heard ? null : s.heard,
  }));
  await logSessionRows(rows);
  await saveSlips(matnId, slipInputs, cleanLineIds);
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
