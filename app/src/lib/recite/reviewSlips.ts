/**
 * Slips that can still be reviewed: the matn is in the app, the line still
 * exists, and the word is still where it was (the text may have been corrected
 * since the slip was saved). The Library card and the Review list both count
 * from this, so they always agree.
 */
import type { FlatLineRef } from "../../types/content";
import { flattenLines, getMatn } from "../content/loader";
import type { SlipRow } from "../db/database";

export interface LiveSlip {
  slip: SlipRow;
  /** The line the slip sits on, resolved against the current text. */
  line: FlatLineRef;
}

export function liveSlips(slips: SlipRow[]): LiveSlip[] {
  const cache = new Map<string, Map<string, FlatLineRef> | null>();
  const out: LiveSlip[] = [];
  for (const slip of slips) {
    let lines = cache.get(slip.matn_id);
    if (lines === undefined) {
      try {
        lines = new Map(flattenLines(getMatn(slip.matn_id)).map((ref) => [ref.line.id, ref] as const));
      } catch {
        // A slip saved against a matn that has since left the app.
        lines = null;
      }
      cache.set(slip.matn_id, lines);
    }
    const line = lines?.get(slip.line_id);
    if (line && line.line.words[slip.word_index] === slip.expected_word) out.push({ slip, line });
  }
  return out;
}
