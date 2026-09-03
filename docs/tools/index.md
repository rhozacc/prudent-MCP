# Tools overview

19 tools across six files. Every tool has a title, a description, read-only annotations, a zod input schema, and a handler that delegates to the adapter layer.

## All tools

| Tool | Surface | Description |
|---|---|---|
| `get_corpus_info` | meta | What's loaded — counts, coverage, stale sources |
| `get_referrers` | meta | Everything that references a given ID |
| `resolve_citation` | meta | Loose prose citation → structured Regulation |
| `list_review_areas` | meta | Taxonomy of review areas — authored, or derived from the playbooks |
| `expand_playbook` | meta | Playbook with all Phase.references resolved inline |
| `get_area_overview` | meta | One-shot entry point: area node + expanded playbooks + deduplicated IDs |
| `expand_regulation` | meta | Regulation with its children (sub-regs + checks/tests) resolved inline |
| `get_regulation_tree` | meta | Recursive dossier: a branch of law with operationalizing checks/tests |
| `get_coverage_gaps` | meta | Regulations with no check/test coverage — the aggregate inverse of get_referrers |
| `search_regulation` | regulation | Ranked search over citation, text, and commentary |
| `get_regulation` | regulation | Fetch a regulation paragraph by URI, with optional `as_of` |
| `search_tests` | tests | Ranked search over test name, aliases, family, purpose, criteria |
| `get_test` | tests | Fetch a test by ID |
| `search_checks` | checks | Ranked search over check name, expectation, expected evidence |
| `get_check` | checks | Fetch a check by ID |
| `search_playbooks` | playbooks | Ranked search over area, subarea, phase names and descriptions |
| `get_playbook` | playbooks | Fetch a playbook by ID (`detail: "steps"` drops the reference lists) |
| `list_sources` | sources | The source-document registry with currency status, optionally filtered |
| `get_source` | sources | Fetch a source document record by ID |

`list_sources` is deliberately a list, not a search: the registry is small and status-filterable, so enumerating beats matching.

## Conventions every tool follows

- **Annotations** — every tool declares `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false`. The whole server reads a local knowledge base and nothing else.
- **Structured output** — tools with an output schema return `structuredContent` plus a JSON text fallback (the spec requires text alongside structured content).
- **Misses are `isError`** — an unknown id or slug comes back as an `isError` result with a pointer to the right search/list tool, never the literal string `"null"`. Resource reads miss with JSON-RPC error `-32002`.
- **The search envelope** — the four `search_*` tools share `{ results, total_matches, offset, truncated }` with `limit` (default 20, max 100) and `offset` paging, and a text hint when truncated. Queries are ranked and field-scoped, minimum 2 characters — search never enumerates the corpus; that's what `list_*` tools and traversal are for. Note the built-in adapters cap ranked matches at 20, so `total_matches` tops out there.
- **Ranking is coverage-first** — results are ordered by how many of the query's distinct tokens a record matches, and only then by weighted score. A multi-word query is otherwise an OR: a record matching just the commonest token can outrank one matching every token, because score is a sum. Single-token queries are unaffected (coverage is 1 everywhere, so score alone decides). Practical consequence: **more words narrow the result set** rather than widening it, so prefer `"downturn LGD calibration"` over `"LGD"`.
- **`detail: "concise" | "full"`** — search and traversal tools are concise by default (per-surface projections, `{ type, id, label }` reference stubs); pass `detail: "full"` for complete records.
- **Lenient ids** — id parameters tolerate surrounding whitespace, quotes, brackets, and trailing punctuation.

## URI scheme quick-reference

```
regulation://{framework}/{article}[/{paragraph}[/{point}]]
  e.g.  regulation://crr/178/1/a
        regulation://eba/gl-2017-16/78

test://[{family}/]{test-id}
  e.g.  test://jeffreys
        test://gl-2019-03/downturn-lgd-vs-reference-value-comparison

check://{area}/{topic}[/{specific}]
  e.g.  check://calibration/pd/lra-derived
        check://default-definition/utp

playbook://{area}[/{subarea}]
  e.g.  playbook://calibration/pd
        playbook://default-definition

source://{framework}/{document-id}
  e.g.  source://eba/gl-2017-16
        source://crr/575-2013
```

## Workflow patterns

**Starting a review area:** `list_review_areas` → `get_area_overview` (takes the slug or the area name) → work through expanded phases.

**Resolving a bank citation:** `resolve_citation("Art. 178(1)(a)")` → `get_regulation` → `get_referrers` → checks + playbooks.

**Checking test equivalence:** `search_tests("chi-squared decile")` → compare `family` field → read `acceptance_criteria`.

**Historical regulation lookup:** `get_regulation("regulation://crr/178/1/b", as_of: "2014-06-01")` → see what was in force when the model was built.

## Which tool, when?

Start from what you already have:

| You have | Start with | Then |
|---|---|---|
| A review task | `list_review_areas` | `get_area_overview` |
| A prose citation | `resolve_citation` | `get_regulation` → `get_referrers` |
| A bank's test name | `search_tests` | `get_test` (compare `family`) |
| A finding | `search_checks` | `resolve_citation` |

Most chains stop after one or two more calls — `get_referrers` after a regulation, `get_test` after a search hit, `expand_playbook` after `get_area_overview` if you skipped the overview.
