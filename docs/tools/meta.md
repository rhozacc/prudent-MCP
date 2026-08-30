# Meta tools

Nine cross-cutting tools that operate across all five surfaces. Defined in `src/tools/meta.ts`.

---

## `get_corpus_info`

What's loaded right now. Tells Claude what's actually queryable before it starts fetching things that don't exist.

**Inputs:** none

**Returns:**

```ts
{
  last_updated: string;       // ISO datetime
  counts: {
    regulation: number;
    test: number;
    check: number;
    playbook: number;
    source: number;
  };
  coverage: string[];         // e.g. ["CRR", "EBA-GL-2017-16"]
  stale_sources: SourceId[];  // current sources whose verified date is >30 days old — computed, never stored
}
```

**Example:**
```ts
get_corpus_info()
→ { last_updated: "2024-10-01T00:00:00Z", counts: { regulation: 12, test: 3, check: 4, playbook: 2, source: 5 }, coverage: ["CRR", "EBA-GL-2017-16"], stale_sources: ["source://eba/gl-2017-16"] }
```

A non-empty `stale_sources` means the registry needs a maintenance run — follow up with `list_sources`.

---

## `get_referrers`

Find everything in the corpus that references a given ID. Works on any content surface — regulation, test, check, or playbook. (Sources sit outside the reference graph; they join via `document_id` instead.)

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `string` | Any surface ID — `regulation://`, `test://`, `check://`, or `playbook://` |

**Returns:**

```ts
{
  regulation: RegulationId[];
  tests: TestId[];
  checks: CheckId[];
  playbooks: PlaybookId[];
}
```

The scan covers every typed reference: `parent`/`children` (regulation), `derived_from`/`parent` (checks), `regulatory_basis`/`parent` (tests), and `regulatory_scope` **plus every phase's `references`** (playbooks). A `source://` id is an `isError` explaining that sources join via `document_id`, not by URI.

**Example:**
```ts
get_referrers("regulation://crr/180/1/a")
→ {
    regulation: ["regulation://crr/180"],                    // the parent article lists it in children
    tests:      ["test://jeffreys", "test://binomial", "test://hosmer-lemeshow"],  // regulatory_basis
    checks:     ["check://calibration/pd/lra-derived"],      // derived_from + parent
    playbooks:  ["playbook://calibration/pd"]                // a phase reference
  }
```

---

## `resolve_citation`

Loose, human-prose citation string → structured Regulation record. Deterministic matching in three passes: exact normalized-citation equality (lowercased, punctuation stripped, abbreviations expanded — `art` → `article`, `para` → `paragraph`, `gl` → `guidelines`), then normalized-citation containment in either direction (a citation naming a missing node resolves to the closest recorded relative), then article/paragraph/point segment extraction against id paths, filtered by a framework token when the query names one.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `text` | `string` | A loose citation in analyst prose |

**Returns:** `{ match: Regulation | null }` — on `null`, the result carries a hint to fall back to `search_regulation` with the citation's key words.

**Example:**
```ts
resolve_citation("Art. 178(1)(a)")
→ { match: <regulation://crr/178/1/a> }

resolve_citation("CRR Article 180")
→ { match: <regulation://crr/180> }

resolve_citation("EBA GL 2017/16 para 78")
→ { match: <regulation://eba/gl-2017-16/78> }

// Containment: no crr/178 record exists, so the closest recorded relative wins.
resolve_citation("CRR Article 178")
→ { match: <regulation://crr/178/1/a> }
```

---

## `list_review_areas`

The canonical taxonomy of review areas. Use this to map a real-world analyst task onto the corpus's structure before fetching playbooks or checks.

**Inputs:** none

**Returns:** `{ areas: ReviewArea[] }`

```ts
type ReviewArea = {
  id: string;          // dotted slug, e.g. "calibration.pd"
  name: string;
  parent?: string;
  children: string[];
}
```

**Example:**
```ts
list_review_areas()
→ { areas: [
    { id: "calibration",     name: "Calibration",     children: ["calibration.pd", "calibration.lgd"] },
    { id: "calibration.pd",  name: "PD Calibration",  parent: "calibration", children: [] },
    ...
  ]}
```

---

## `expand_playbook`

Fetch a playbook with all `Phase.references` resolved inline. Avoids N+1 fetches when an LLM needs to reason about all phases at once.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `PlaybookId` | e.g. `playbook://calibration/pd` |
| `detail` | `"concise" \| "full"` | Optional, default `"concise"` |

**Returns:** `ExpandedPlaybook` — unknown ids are an `isError` result pointing at `search_playbooks`.

By default each reference in `phases[*].references` becomes a `{ type, id, label }` stub (label = citation for regulation, name for tests/checks, area/subarea for playbooks; `null` when unresolved). With `detail: "full"` each becomes `{ type, id, record }` with the complete Regulation / Test / Check / Playbook object embedded.

**Example:**
```ts
expand_playbook("playbook://calibration/pd")
→ {
    id: "playbook://calibration/pd",
    phases: [
      {
        name: "Validate LRA derivation",
        references: [
          { type: "regulation", id: "regulation://crr/180/1/a", label: "CRR Article 180(1)(a)" },
          { type: "check",      id: "check://calibration/pd/lra-derived", label: "PD long-run average derived from sufficient history" }
        ]
      },
      ...
    ]
  }
```

---

## `get_area_overview`

One-shot entry point for a review area. Combines `list_review_areas` + all matching playbooks + `expand_playbook` + deduplication into a single call.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `area` | `string` | Canonical area slug — use `list_review_areas` first to confirm |
| `detail` | `"concise" \| "full"` | Optional, default `"concise"` — reference stubs vs. embedded records in the expanded playbooks |

**Returns:** `AreaOverview` — unknown slugs are an `isError` result pointing at `list_review_areas`.

```ts
type AreaOverview = {
  area: ReviewArea;
  playbooks: ExpandedPlaybook[];    // reference stubs by default; detail: "full" embeds records
  regulation_ids: RegulationId[];   // deduplicated across all phases
  check_ids: CheckId[];
  test_ids: TestId[];
}
```

**Example:**
```ts
get_area_overview("calibration.pd")
→ {
    area: { id: "calibration.pd", name: "PD Calibration", ... },
    playbooks: [ ... expanded playbook ... ],
    regulation_ids: ["regulation://crr/180/1/a", "regulation://eba/gl-2017-16/78"],
    check_ids:      ["check://calibration/pd/lra-derived", "check://calibration/pd/segment-tested"],
    test_ids:       ["test://jeffreys", "test://binomial", "test://hosmer-lemeshow"]
  }
```

---

## `expand_regulation`

Fetch a regulation with its children resolved inline — sub-regulations plus the checks/tests that operationalize it. The reverse-direction companion to `expand_playbook`: avoids N+1 fetches when you want an article *and everything hanging off it* in one call.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `RegulationId` | e.g. `regulation://crr/180/1/a` |
| `as_of` | `string` (ISO date) | Optional — resolve the regulation as of this date (same rule as `get_regulation`) |
| `detail` | `"concise" \| "full"` | Optional, default `"concise"` |

**Returns:** `ExpandedRegulation` — unknown ids are an `isError` result pointing at `search_regulation`.

```ts
type ExpandedRegulation = {
  id: RegulationId;
  citation: string;
  framework: string;
  document_version: string;
  text: string;
  parent: RegulationId | null;
  children: { type, id, label }[];   // stubs by default; detail: "full" embeds the complete records
}
```

**Example:**
```ts
expand_regulation("regulation://crr/180/1/a")
→ {
    id: "regulation://crr/180/1/a",
    citation: "CRR Article 180(1)(a)",
    children: [
      { type: "check", id: "check://calibration/pd/lra-derived", label: "PD long-run average derived from sufficient history" }
    ]
  }
```

---

## `get_regulation_tree`

Walk a regulation's children recursively into a dossier: the branch of law (section → paragraphs) with the checks/tests that operationalize each node attached as leaves.

**Inputs:**

| Parameter | Type | Notes |
|---|---|---|
| `id` | `RegulationId` | Root of the tree, e.g. `regulation://crr/180` |
| `depth` | `number` | Optional — max regulation recursion depth (default 5, max 10) |
| `as_of` | `string` (ISO date) | Optional — resolve regulations as of this date |
| `detail` | `"concise" \| "full"` | Optional, default `"concise"` |

**Returns:** `RegulationTreeNode` — unknown roots are an `isError` result pointing at `search_regulation`.

Regulation children recurse; checks/tests are resolved leaves. The walk is bounded three ways — `depth`, a cycle guard, and a hard cap of **200 total nodes** — and any node cut off by a bound is flagged `truncated: true`. Concise (default) keeps `{ type, id, citation }` per regulation node and `{ type, id, label }` per leaf; `detail: "full"` embeds each node's complete record.

```ts
type RegulationTreeNode = {
  type: "regulation";
  id: RegulationId;
  citation: string;
  record?: Regulation | null;        // detail: "full" only
  children: (RegulationTreeNode | { type: "test" | "check"; id; label })[];
  truncated?: boolean;
}
```

**Example:**
```ts
get_regulation_tree("regulation://crr/180")
→ {
    type: "regulation", id: "regulation://crr/180", citation: "CRR Article 180",
    children: [
      { type: "regulation", id: "regulation://crr/180/1/a", citation: "CRR Article 180(1)(a)", children: [
        { type: "check", id: "check://calibration/pd/lra-derived", label: "PD long-run average derived from sufficient history" }
      ]},
      { type: "check", id: "check://calibration/pd/segment-tested", label: "PD calibration tested per grade or pool" }
    ]
  }
```

---

## `get_coverage_gaps`

Audit the corpus for regulatory requirements with no validation coverage — regulations that no check (`derived_from`) or test (`regulatory_basis`) points at. The aggregate inverse of `get_referrers`: "show me the law we have no check or test for."

**Inputs:** none

**Returns:** `CoverageReport`

```ts
type CoverageReport = {
  total_regulations: number;
  covered: number;
  uncovered: { id: RegulationId; citation: string; is_leaf: boolean }[];
}
```

`is_leaf` distinguishes a real gap (a leaf paragraph with no coverage) from a section that may inherit coverage from its children.

**Example:**
```ts
get_coverage_gaps()
→ {
    total_regulations: 6, covered: 5,
    uncovered: [
      { id: "regulation://eba/gl-2017-16/s4", citation: "EBA GL 2017/16 Section 4 …", is_leaf: false }
    ]
  }
```
