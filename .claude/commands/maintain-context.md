Run a maintenance pass over the regulatory-context registry: verify every source document against its publisher, update the corpus JSON, and leave the linter green. Do this carefully and summarize what changed.

## What to do

### 1. Load the registry

- `CORPUS_FILE` must point at the corpus JSON you maintain. If it is unset, stop and ask for the path — the bundled demo corpus is code, not maintainable data.
- Read the file and list every record under `sources`, grouped by `status` (current / pending / superseded), with each record's `verified` date and upcoming `milestones`.
- Run `CORPUS_FILE=... bun run validate` once before touching anything, so you know the baseline errors and warnings.

### 2. Check each publisher

For every **current** and **pending** source (superseded records are closed — skip them):
- Open the publisher's page for the document — the record's `url` if set, otherwise search the publisher's site (EBA, ECB, EUR-Lex, ...).
- Look for: amendments or consolidated versions, a final report replacing a consultation, a repeal or replacement (supersession), and new dates — consultation deadlines, expected finals, application dates.
- Note what you actually confirmed. "The page still shows the same version" is a confirmation; "I couldn't reach the page" is not.

### 3. Update the corpus JSON

- Set `verified` to today **only** for documents you actually confirmed against the publisher. Never bump `verified` blind.
- A document replaced by a newer one: set its `status` to `"superseded"`, point `superseded_by` at the successor, and add a new source record for the successor if the registry doesn't have one yet. Never delete a record — supersede it.
- A consultation that produced a final follows the same pattern: the consultation becomes superseded, the final becomes a new current (or pending) record.
- Newly relevant documents (fresh consultations, new guides) get new records with status `"pending"` or `"current"`.
- Milestones: add newly announced dates, drop dates that have passed, and keep the array in chronological order — the first entry is served as `next_milestone`. Dates are display strings (`"2026-10-19"`, `"Q4 2026"`); never reformat them into something that needs parsing.

### 4. Lint

- `CORPUS_FILE=... bun run validate` must pass with zero errors before you finish.
- Warnings are stale-currency findings: resolve each one by verifying the document (step 2), or state explicitly why it stays (e.g. publisher site unreachable — retry next run).

### 5. Summarize

Report, in this order: documents verified (with their new `verified` date), statuses flipped (with the supersession chain), milestones added or pruned, new source records, and anything needing a human decision — an ambiguous replacement, a paywalled document, a consultation whose outcome you can't determine.

## Rules

- Read before you edit. Never guess at a document's status — verify from the publisher.
- Never delete a source record. Supersession is a status + pointer; the history stays.
- Never invent documents or milestone dates. No source, no record.
- Changes to regulation *content* (article text, new paragraphs, commentary) are out of scope here — flag them for a corpus content update instead.
- Keep the diff to the `sources` array (plus `corpus_info` if the file carries one). The other surfaces have their own workflows.
