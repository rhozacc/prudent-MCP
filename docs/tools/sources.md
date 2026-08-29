# Sources tools

Two tools for the sources surface. Defined in `src/tools/sources.ts`.

Sources are the registry of documents the corpus derives from — which EU regulation, EBA guideline, or ECB guide each `document_id` refers to, whether it is current, pending, or superseded, when its currency was last verified against the publisher, and what regulatory milestones approach. The registry is small and list-shaped, so unlike the content surfaces it exposes `list_sources` (optionally filtered by status) rather than a full-text search.

---

## `list_sources`

The full registry — the "is my regulatory context current?" answer.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `status` | `"current" \| "pending" \| "superseded"` | Optional — omit for the whole registry |

**Returns:** `{ sources: [...] }` — one summary per source: `id`, `title`, `doc_type`, `status`, `verified`, `effective_from`, `superseded_by`, and `next_milestone` (the first entry of the chronologically ordered milestones array).

**Example:**
```ts
list_sources({ status: "pending" })
→ { sources: [{ id: "source://eba/cp-2025-14", title: "EBA-CP-2025-14 Consultation on amending the PD/LGD estimation guidelines (CRR3 alignment)", status: "pending", verified: "2026-08-23", next_milestone: { date: "2026-10-19", event: "Consultation closes" }, ... }] }
```

Call `get_source` for the full record, or `search_regulation` for the corpus content under a document.

---

## `get_source`

Fetch a source document record by ID.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `SourceId` | e.g. `source://eba/gl-2017-16` |

**Returns:** `Source` — unknown ids are an `isError` result pointing at `list_sources`.

```ts
type Source = {
  id: SourceId;
  title: string;
  framework: string;               // matches Regulation.framework
  document_id: string;             // joins to Regulation.document_id
  doc_type: "regulation" | "guideline" | "guide" | "consultation" | "statement" | "report" | "other";
  status: "current" | "pending" | "superseded";
  published?: string;
  effective_from?: string;
  verified: string;                // last date currency was confirmed against the publisher
  superseded_by?: SourceId;        // set iff status is "superseded"
  milestones: { date: string; event: string }[];   // chronological; dates are display strings, never parsed
  url?: string;
  notes?: string;
}
```

**On `document_id`:**

The join to the content surfaces. A source and the regulation records derived from it share a `document_id` — there is no URI reference in either direction, so a source can exist before any content does (a pending consultation is exactly that). Sources never appear in `Regulation.children` or `get_referrers`.

**Example:**
```ts
get_source("source://eba/cp-2016-21")
→ {
    title: "EBA-CP-2016-21 Consultation on PD/LGD estimation guidelines",
    doc_type: "consultation",
    status: "superseded",
    superseded_by: "source://eba/gl-2017-16",
    verified: "2026-07-12",
    notes: "Consultation that produced EBA-GL-2017-16; kept for provenance."
  }
```

### Source URI format

Sources use a two-segment URI: `source://{framework}/{document-id}`

Examples:
- `source://eba/gl-2017-16`
- `source://crr/575-2013`
- `source://ecb/guide-internal-models`

Sources are latest-only: supersession is `status: "superseded"` plus a `superseded_by` pointer to the successor record, never version history (versioning lives on `Regulation` alone). Keeping the registry current is a maintenance-session job — `/maintain-context`, gated by `bun run validate` — so the server stays read-only.
