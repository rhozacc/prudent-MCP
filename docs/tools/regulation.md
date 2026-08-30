# Regulation tools

Two tools for the regulation surface. Defined in `src/tools/regulation.ts`.

Regulation is the only versioned surface — records carry a `document_version`, and `get_regulation` accepts `as_of` for historical lookups.

---

## `search_regulation`

Ranked, field-scoped search across all loaded regulatory frameworks: citation (weight 3), text (2), commentary (1). Record ids join the field set only when the query itself looks URI-like — a prose query never matches through the `regulation://` scheme.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `query` | `string` | Minimum 2 characters — search never enumerates the corpus |
| `limit` | `number` | Optional page size, default 20, max 100 |
| `offset` | `number` | Optional — skip this many ranked matches |
| `detail` | `"concise" \| "full"` | Optional, default `"concise"` |

**Returns:** the shared envelope `{ results, total_matches, offset, truncated }` — latest versions only. Concise results are `{ id, citation, matched_excerpt, document_id, parent }`, where `matched_excerpt` is a ~120-char window around the best match; `detail: "full"` serves complete records.

**Example:**
```ts
search_regulation("long-run average")
→ {
    results: [
      { id: "regulation://crr/180/1/a",       citation: "CRR Article 180(1)(a)", matched_excerpt: "…from long-run averages of one-year default rates…", ... },
      { id: "regulation://eba/gl-2017-16/78", citation: "EBA GL 2017/16 paragraph 78", ... }
    ],
    total_matches: 2, offset: 0, truncated: false
  }
```

Use `get_referrers` on any returned id to find the checks and playbooks that operationalise it. Use `get_regulation` with `as_of` for historical versions.

---

## `get_regulation`

Fetch a regulation paragraph by URI.

**Inputs:**

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `id` | `RegulationId` | yes | e.g. `regulation://crr/178/1/a` |
| `as_of` | `string` (ISO date) | no | Returns the version in force on this date |

**Returns:** `Regulation` — unknown ids are an `isError` result pointing at `search_regulation`.

The `as_of` rule (see [Corpus structure → Versioning](../corpus/#versioning)): with no history for the id, the backend serves the only version it knows — the current one; with history, the version in force on the date is returned, and an `as_of` predating every recorded version is a miss explaining the rule — never current text masquerading as historical.

```ts
type Regulation = {
  id: RegulationId;
  framework: string;
  document_id: string;
  document_version: string;       // e.g. "2024-01-09"
  citation: string;
  text: string;
  commentary: Commentary[];
  parent?: RegulationId;          // the regulation record this one nests under (a section, or the parent article)
  children: RegulationChildId[];  // sub-regulations + the checks/tests that operationalize this record
}

// RegulationChildId = RegulationId | TestId | CheckId
```

`children` mixes structure and operationalization: a section lists its paragraphs, and any record can list the `check://`/`test://` URIs that hang off it. A child check/test must also name this regulation in its own `derived_from` / `regulatory_basis` (the mirror invariant), so `get_referrers` stays the single computed reverse index. A `PlaybookId` is rejected here at compile time — playbooks reference regulation, never the other way around.

**Example — latest:**
```ts
get_regulation("regulation://crr/178/1/b")
→ { document_version: "2024-01-09", text: "...materiality assessed against thresholds set in the relevant Commission Delegated Regulation..." }
```

**Example — historical:**
```ts
get_regulation("regulation://crr/178/1/b", as_of: "2014-06-01")
→ { document_version: "2013-06-26", text: "...Materiality is left to national competent authority discretion." }
```

The `as_of` parameter is what makes cross-vintage model reviews tractable — you can see exactly what the regulation said when the model was built, not just what it says now.
