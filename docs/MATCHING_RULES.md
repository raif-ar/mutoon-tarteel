# Transcript matching rules (Mutoon Tarteel)

## Dynamic programming (removed)

**DP** here means Dynamic Programming alignment (Needleman–Wunsch style): it scores all paths between heard tokens and expected words. That approach caused distant false matches and unnecessary complexity. Production matching now uses a **greedy prefix scanner** plus validation, with backward relocalize only under strict rules.

## Core rules

| ID | Rule |
|----|------|
| R1 | Align only against the **expected matn** (session `words[]`), not free-form ASR text. |
| R2 | Progress is a **contiguous prefix** from the current cursor — no skipping ahead via a fuzzy hit far down the line. |
| R3 | At most **one missed expected word** per heard token (single-word skip / lookahead). |
| R4 | **Fuzzy / prefix** match requires at least **3** normalized characters on both sides (see `wordMatch`). |
| R5 | **No distant match**: from the current expected index, do not match more than **3** words ahead without consuming intermediate misses. |
| R6 | **Local window ±3**: primary match uses expected words from `cursor` forward, with lookahead capped at 3. |
| R7 | **Partial** transcripts: low advance cap (**4** words per event). |
| R8 | **Final** transcripts: higher advance cap (**8** words per segment). |
| R9 | **No forward jump** in the matn: cursor never moves past `anchor + matchedThrough` from a single alignment; caps enforce this on fast bursts. |
| R10 | **Monotonic partials** within a segment: `matchedThrough` does not decrease until a final resets the segment anchor. |
| R11 | **Mistakes** (wrong / skipped miss) are recorded only when the **cursor actually advances** on that event. |
| R12 | **Extras** in ASR are ignored for cursor movement (not stored as line mistakes). |
| R13 | **Warmup** (~400 ms after listen start): ignore non-final partials to drop stale iOS cumulative noise. |
| R14 | **ASR tail**: mic alignment uses only the **recent phrase** (provider `getAlignmentTranscript`), not the full session transcript on partials. |
| R15 | **Token deltas**: append only **new** tokens to session-heard history when the provider exposes deltas (avoids re-processing stale cumulative text). |
| R16 | **Never stuck while recording**: user can always recover by repeating; backward relocalize and continued listening are allowed — recording is not blocked. |
| R17 | **Backward relocalize (option B)**: cursor may move **back** only if the heard phrase (≥3 words) **fuzzy-matches** the contiguous suffix `expected[cursor−L : cursor]` of words already passed (`0..cursor`). No arbitrary earlier word hit. |
| R18 | **No forward jump via relocalize**: relocalize only decreases or holds cursor; it never skips ahead in the matn. |

## Fast speech handling

| Situation | Behavior |
|-----------|----------|
| Rapid partial updates | Compare **token deltas** vs last tail; align on recent tokens only. |
| Large final segment | Advance capped at **8** words; excess matches wait for next final. |
| Bulk “missed” words | **Not** applied in one step — prefix scanner advances word-by-word with at most one skip per token. |
| Stale cumulative ASR | **Dedupe** tail; partial alignment text is **short**; warmup skips early partials. |
| User repeats last phrase | **Option B** relocalize: suffix of passed words → cursor `cursor − L`. |
| Fuzzy hit far ahead | **Rejected** (no distant match / no DP skip chain). |

## Implementation map

- `app/src/lib/asr/align.ts` — `scanPrefixMatch`, `relocalizeBackward`, `wordMatch`
- `app/src/lib/asr/reciteEngine.ts` — session heard sequence, local window, caps, stuck hint
- `app/src/lib/asr/providers/expoSpeechProvider.ts` — alignment transcript + deltas
