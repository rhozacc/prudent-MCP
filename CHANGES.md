# Changes

## Presentation, licensing, and a release that publishes itself

Nothing in the server changed — this is the layer around it: how the project reads to someone arriving from outside, and how a build reaches them.

- **Licence settled as AGPL-3.0-only** — `LICENSE` had carried the AGPL text since May while `package.json` still declared the Apache-2.0 the project was initialised with, so the repo asserted two licences at once. AGPL wins on the merits, not on which file was older: the server ships only a stdio transport, so every hosted deployment is necessarily a modified work, and §13 reaches the transport/auth/metering layer a rival would have to add — the one part of this project that is real engineering rather than published specification. It reaches nothing else that matters; a corpus is data read at runtime, so no code licence protects a proprietary one or encumbers a user's own. `LICENSE`, `package.json`, `manifest.json` (which declared no licence at all), `README.md` and the docs landing now agree, and a commercial licence is offered alongside for embedding, OEM and on-prem.
- **`CONTRIBUTING.md`** — the CLA check had been gating pull requests with nothing in the repo saying what it is. It now explains that copyright unification is what keeps the dual-licence option alive, alongside the check suite, the schema-regeneration rule, the smoke-test tripwire, and the two non-negotiable boundaries (no corpus content, no write path).
- **`THIRD-PARTY-NOTICES.md`** — the packed `.mcpb` statically links `@modelcontextprotocol/sdk` and `zod`, both MIT, and shipped none of their notices (`grep -c Copyright` on the bundle returned 0). Notices reproduced and packed alongside `LICENSE`; the bundle went from three files to five. `legalComments: "eof"` is set on the esbuild step too, though neither dependency currently carries a banner comment for it to preserve.
- **Mobile docs layout** — two bugs below 768px. The mobile block padded `.container`, `.content-container` and `.content` on top of the gutter VitePress already gives `.VPDoc`, stacking four of them (24+20+20+20) and leaving a 222px prose column on a 390px phone. Separately, `display: table` (set for full-width tables on desktop) had dropped VitePress's own `display:block` + `overflow-x:auto`, so a nowrap URI column pushed the landing page 194px sideways. Rows now stack at that width: scrolling hid the prose column behind tall empty bands, and wrapping in place shredded `regulation://{framework}/{article}` into five fragments.
- **The README hero screenshot is gone** — `docs-hero.yml`, `scripts/screenshot-hero.ts` and the committed PNG are deleted. It was a workflow that screenshotted the docs site, opened a rolling PR to update an image, and could not push to a protected `main` — machinery whose whole output was a picture of a page one link away. Text says it faster. The README rewrite also fixes a real error: it told readers to install `dist/prudent-mcp.mcpb`, which `build:mcpb` has never produced (it writes `mcpb.mcpb` at the repo root).
- **Releases publish on merge** — `release.yml` no longer waits for a tag to be pushed by hand. Every push to `main` compares the `package.json` version against existing releases and, if there is no release for it, runs typecheck and tests, builds the `.mcpb` and publishes it, creating the tag. Bumping the version in a PR and merging it ships a release; merging anything else is a no-op. `workflow_dispatch` still accepts an explicit tag.

## Correctness fixes + MCP 1.29 surface (annotations, structured output, search rework)

Three verified bugs fixed at the adapter layer, and the tool layer brought up to what SDK 1.29 actually supports. The wire contract changed for MCP clients (payload shapes below); the library import surface (`prudent-mcp/validate`, `prudent-mcp/schema`, `prudent-mcp/file-adapter`) is strictly additive — nothing the dashboard imports was removed or re-signatured.

- **Bug: `as_of` served current text as historical** — the file adapter's `get(id, asOf)` ignored `asOf` entirely. Now the corpus file's optional `regulation_history` key (`{ id, effective_from, record }` entries, sorted per id at load) drives real selection: the last entry with `effective_from <= asOf` wins, boundary dates inclusive; an `asOf` predating every entry is `null` — never current text masquerading; an id without history serves the only version the corpus knows, so history-less corpora behave exactly as before. The demo and `get_regulation`/`expand_regulation`/`get_regulation_tree` follow the same rule, and the miss message explains it. `RegulationHistoryEntrySchema` is exported from `file-adapter` (deliberately not in the schema registry — file-format plumbing, not a surface schema).
- **Bug: `get_referrers` missed playbook phase references** — the file adapter never scanned `phases[].references`, and the demo hardcoded `regulation: []` and `tests: []` — with the smoke test asserting the buggy `tests: []` as the expected value, cementing the bug. There is now ONE reverse index, `computeReferrers` in `src/referrers.ts` (parent/children, `derived_from`, `regulatory_basis`, `regulatory_scope`, and every phase's references), that both adapters delegate to; the smoke test asserts the correct full answer (for `crr/180/1/a`: the parent article, all three calibration tests, the check, and the playbook that refers via a phase).
- **Bug: `resolve_citation` couldn't resolve its own example** — the naive substring matcher returned `null` for "Art. 178(1)(a)", the tool description's first example. Replaced by `resolveCitationIn` (exported from `file-adapter`, also used by the demo now): exact normalized-citation equality (abbreviations expanded: art→article, para→paragraph, gl→guidelines), then containment either direction (a citation naming a missing node resolves to the closest recorded relative — "CRR Article 178" → `crr/178/1/a` when no `crr/178` record exists), then article/paragraph/point segments against id paths. The description's examples are pinned by tests. Result shape is now `{ match: Regulation | null }` with a fallback hint on null.
- **Search rework — no more one-call corpus dump** — `search` was a `JSON.stringify` substring scan: it matched keys and URIs (query "regulation" hit 100% of records), and `search("")` dumped the whole corpus — an undocumented contract the meta tools depended on, and a real exposure since the corpus is the paid product. Now: `rankedSearch` in `src/search.ts` (tokenized, field-scoped, weighted; whole-word beats substring; deterministic tie-break; 20-match default cap; per-surface field sets exported for backend parity), and every content adapter gains an explicit `list()` for the enumeration contract — empty queries return `[]`, the tool layer requires 2+ characters, and internal callers (coverage gaps, area overview, completions, scripts) use `list()`. For regulation, ids join the field set only for URI-like queries.
- **Search envelope + concise projections** — the four `search_*` tools return `{ results, total_matches, offset, truncated }` with `limit` (default 20, max 100)/`offset` paging and a truncation hint block. Concise by default: `{ id, citation, matched_excerpt, document_id, parent }` for regulation (the CLAUDE.md "no excerpt rendering" deferral is deliberately closed), `{ id, name, family, purpose_first_sentence }` for tests, `{ id, name, expectation_first_sentence, derived_from }` for checks, `{ id, area, subarea, phase_count }` for playbooks; `detail: "full"` serves complete records. Caveat: the built-in adapters cap ranked matches at 20, so `total_matches` tops out there — raising the cap or threading a limit through the adapter contract is an owner decision.
- **Annotations, titles, output schemas, structured content** — every tool declares `readOnlyHint`/`idempotentHint: true`, `openWorldHint: false`, and a human title; tools with output schemas return `structuredContent` plus the spec-required JSON text fallback. Traversal tools (`expand_playbook`, `expand_regulation`, `get_area_overview`, `get_regulation_tree`) are concise by default — `{ type, id, label }` reference stubs, `detail: "full"` for embedded records — and the tree walk gains a 200-node hard cap alongside depth and the cycle guard.
- **Error semantics** — `get_*`/traversal misses are `isError` results with a next-step pointer (previously the literal text `"null"`); resource template misses throw JSON-RPC `-32002` (previously an empty-string body served as `application/json`). Breaking payload shapes for MCP clients: `list_review_areas` → `{ areas: [...] }`, `list_sources` → `{ sources: [...] }`, `resolve_citation` → `{ match: ... }`.
- **Completions + leniency + instructions** — resource templates and prompt arguments complete against what the connected adapters actually hold; id/slug params tolerate wrapping quotes/brackets/punctuation (`z.preprocess`, invisible in the published JSON schema); the server ships instructions describing the entry path, envelopes, miss conventions, and the `as_of` rule. Prompt args tightened: `review_calibration.component` is a lowercase enum, `assess_findings.severity` rejects unknown values.
- **Startup integrity gate** — `src/mcpb-entry.ts` now refuses to serve an unsound corpus: after the zod parse (failures print per-path issues readably), `validateCorpusFile` violations abort with exit 1; `corpusWarnings` staleness prints to stderr without blocking.
- **Tests** — suite green at 129: corrected referrers expectations (the cemented `tests: []` gone), `search("")` → `list()` throughout (one mirror-invariant test had been passing vacuously over `[]`), new `tests/search.test.ts` (ranking, weights, whole-word vs substring, caps, URI-vs-prose id behavior, excerpt shape), `file-adapter` coverage for `as_of` (boundaries, predating-all, no-history), `resolveCitationIn` (all description examples), phase-reference referrers, and a wire-level block driving the demo server over `InMemoryTransport` (annotations on the wire, envelope + `structuredContent`, `isError` misses, `-32002`, completions).
- **Docs** — `docs/tools/*` (envelopes, `detail`, caps, corrected examples — the referrers example now shows the full answer; the unresolvable "para 83" citation example replaced), `docs/corpus/index.md` (`regulation_history` file shape + the `as_of` resolution rule), `docs/adapters/index.md` (`list()` vs `search()` contract, ranking semantics), `CLAUDE.md` (new modules, the list/search decision, excerpt deferral closed; auth/rate-limiting/telemetry stay deferred). Tool count unchanged at 19.

## Regulatory-context layer (sources)

The corpus can now answer the currency question: which source documents it derives from, whether each is current, pending, or superseded, when currency was last verified against the publisher, and what regulatory milestones approach. A fifth surface — one schema, two tools, linter rules, and a maintenance workflow — with the server staying strictly read-only.

- **`Source` schema + `source://` scheme** — `source://{framework}/{document-id}` template-literal type and zod schema: `doc_type`, `status` (current | pending | superseded), `published`/`effective_from`/`verified` dates, `superseded_by`, display-string `milestones`. Latest-only: supersession is a status + pointer, never version history (that stays on `Regulation`). Deliberately outside the reference graph — no `AnyId`/`RegulationChildId` widening, no `Referrers` key; the join to content is `framework` + `document_id`, computed where needed.
- **Two tools (17 → 19)** — `list_sources` (optional status filter; returns the registry with `next_milestone` = first entry of the chronologically ordered milestones) and `get_source`. `list_sources` deliberately breaks the `search_*` naming convention: the registry is small and status-filterable, so enumerating beats matching. Fifth resource template `source://{+path}` (4 → 5).
- **`get_corpus_info`** now returns `counts.source` and `stale_sources` — current sources whose `verified` is older than 30 days, computed at serve time in every `MetaAdapter.info()` (overlaying any stored `corpus_info` block) via `staleSourceIds()`/`STALE_AFTER_DAYS` from `src/validate.ts`.
- **Linter + a first warnings channel** — `validateCorpus` gains source rules: unique ids (the only surface with the rule — supersession pointers make duplicate ids uniquely dangerous), superseded status ⇔ `superseded_by` pointer, pointers resolve, supersession chains acyclic, `verified` never in the future. New `corpusWarnings` export for staleness; `bun run validate` prints `⚠` warnings but exits 0 — only errors fail. Both take an injectable `now`; `CorpusInput.sources` is optional so existing `prudent-mcp/validate` callers are unaffected.
- **`/maintain-context`** — new command (`.claude/commands/maintain-context.md`): the maintenance run that keeps the server read-only. Verify each current/pending source against its publisher, edit the corpus JSON (never delete — supersede), keep milestones chronological and pruned, and `bun run validate` gates the result.
- **Schemas 9 → 11** — `Source` (surface) and `Milestone` (supporting) join the registry; every named schema in `src/schema.ts` is registered (the `Commentary`/`Phase` precedent). Caveat for a future zod-4 migration: enum-keyed records become runtime-exhaustive there, so legacy corpus files would then need a `counts.source` key.
- **Demo seeds** — five sources tied to the existing demo regulations: CRR, a deliberately stale EBA GL 2017/16 (exercises `stale_sources` and the validate warning — seed `verified` dates are relative to today so exactly one source stays stale), a superseded consultation pointing at the GL, a pending consultation with milestones, and an ECB guide with no content records (the soft join at work).
- **Tests** — new `tests/validate.test.ts` (first coverage of `src/validate.ts`: every source rule, both supersession-cycle shapes, the 30-day boundary, injected clock throughout), sources smoke coverage, `SourceSchema` cases plus a CorpusInfo back-compat case (stored 4-key `counts` still parse). Tool-count tripwire updated 17 → 19, resource templates 4 → 5.
- **Version drift fixed** — `src/server.ts` reported `0.4.0` against `package.json` `0.5.0`; the server version is now imported from `package.json`.
- **Docs** — new `docs/tools/sources.md`; `docs/corpus/index.md` (five surfaces, a `## Source` section, cross-reference rows), `docs/tools/index.md`, `docs/tools/meta.md`, `docs/guide/{index,concepts,architecture,faq}.md`, `docs/adapters/index.md`, `README.md`, `docs/index.md`, VitePress sidebar, `manifest.json` description, `CLAUDE.md`. `bun run list` prints a SOURCES block; the corpus graph deliberately stays content-only (sources have no reference edges to draw).

## Mermaid rendering

- VitePress shipped no Mermaid plugin, so every `mermaid` block (the corpus graph, the architecture class diagram, the concepts flow) rendered as raw source. Added `vitepress-plugin-mermaid` + `mermaid` and wrapped the config in `withMermaid` — diagrams now render.
- Decluttered now that they're visible: the generated corpus graph groups nodes into per-surface subgraphs; the architecture class diagram drops the two unconnected computed types (`CorpusInfo`, `Referrers`, documented in the Schema reference) and gains the missing `Phase → Playbook` edge; the concepts page drops the Mermaid flow that duplicated the SVG beside it.

## Documentation pass

- **Syntax highlighting** — every `call → result` example in the tool docs and the examples page used bare code fences (no language) and rendered unstyled; all now tagged `ts` for consistent coloring.
- **Schema reference** — new generated page `docs/corpus/schemas.md` (`bun run schema-docs`, chained off `bun run schemas`) renders each surface's JSON Schema, collapsible and highlighted, linked in the nav. The machine-contract companion to the prose field tables in Corpus structure.
- **Trimmed domain content** — cut the FAQ "Domain" section (long-run / PIT-TTC / MoC) and condensed the concepts page's eight-concept regulatory deep-dive to a short orienting list. The docs describe the tool; they don't teach the domain.
- **Examples marked illustrative** — a callout clarifies the walkthroughs reflect the full proprietary corpus, not the open-source demo (most reference URIs the demo doesn't carry).
- **Fixes** — corrected the quickstart clone URL (`econlabsi` → `rhozacc`); condensed duplicated client-config blocks; surfaced the new traversal/coverage tools in the quickstart and on the landing page.
- **CI** — the `docs-hero` workflow pushed the regenerated screenshot directly to `main`, which branch protection now rejects; it opens a rolling PR instead and is marked `continue-on-error` so it can't fail a run.

## Traversal, coverage, and corpus tooling

Built on the children change: three new cross-cutting tools (14 → 17), a corpus linter, a corpus graph, and stronger tests.

- **`expand_regulation`** — fetch a regulation with its children resolved one level inline (the reverse-direction companion to `expand_playbook`).
- **`get_regulation_tree`** — recursive dossier: a branch of law with the checks/tests operationalizing each node attached as leaves. Bounded by `depth` (default 5) and a cycle guard; cut-off nodes flagged `truncated: true`.
- **`get_coverage_gaps`** — audits the corpus for regulations no check/test points at (the aggregate inverse of `get_referrers`); `is_leaf` distinguishes real gaps from sections that inherit coverage.
- The three tools factor exported, directly-testable helpers in `src/tools/meta.ts`.
- `scripts/validate-corpus.ts` (`bun run validate`) — integrity linter: mirror invariant, parent/children bidirectionality, dangling references, parent-chain cycles. Exits non-zero on violations; honours `CORPUS_FILE`. CI-able.
- `scripts/generate-graph.ts` (`bun run graph`) — writes `docs/corpus/graph.md`, a Mermaid map of the corpus (node shape per surface, solid = children, dotted = playbook references). Derived from data so it can't drift.
- `scripts/schema-registry.ts` — shared named-schema list, imported by both the generator and the new drift test so they can't disagree.
- Tests — `tests/schema.test.ts` (schema validation + generative URI property tests), `tests/schema-drift.test.ts` (golden test: committed `docs/schemas/*.json` match the zod defs), plus smoke coverage for the three new tools. Tool-count tripwire updated 14 → 17.
- Docs — `docs/tools/meta.md`, `docs/tools/index.md`, `docs/corpus/index.md`, `docs/corpus/graph.md`, `docs/guide/index.md`, VitePress sidebar, `CLAUDE.md`.

## Regulation children: checks and tests

`Regulation.children` widened from `RegulationId[]` to `RegulationChildId[]` (`RegulationId | TestId | CheckId`). A regulation record can now attach the checks and tests that operationalize it, alongside its sub-regulations — still typed, so a `PlaybookId` is rejected at compile time.

- `src/schema.ts` — new `RegulationChildId` type + `regulationChildIdSchema`; `Regulation.children` uses it. Added `parent?: RegulationId` to `Check` and `Test` (the inverse of `children`).
- **Mirror invariant** — a check/test listed in `Regulation.children` must also name that regulation in its `derived_from` / `regulatory_basis`, and point back via `parent`. Keeps `derived_from` / `regulatory_basis` the single authoritative up-link, so `get_referrers` is unchanged.
- `examples/inmemory-demo.ts` — seeded the relationship: `crr/180/1/a` attaches `check://calibration/pd/lra-derived`; `crr/180` mixes a sub-paragraph with `check://calibration/pd/segment-tested`; `eba/gl-2017-16/78` attaches the three calibration tests. Each carries the mirroring `parent`.
- `scripts/list-all.ts` — prints regulation `children` and check/test `parent`.
- `docs/schemas/{Regulation,Check,Test}.schema.json` — regenerated via `bun run schemas`.
- Docs — `docs/corpus/index.md`, `docs/tools/regulation.md`, `docs/guide/architecture.md`, `README.md`, `CLAUDE.md`.
- `tests/smoke.test.ts` — added coverage for checks/tests as children plus the mirror invariant.

## MCPB distribution

Added zero-dependency distribution as a `.mcpb` bundle for Claude Desktop.

- `src/file-adapter.ts` — in-memory adapters loaded from a corpus JSON file. All five surfaces (regulation, test, check, playbook, meta) backed by maps parsed from the file. Zod-validated at load time; malformed records error on startup rather than at query time.
- `src/mcpb-entry.ts` — MCPB entry point. Reads `CORPUS_FILE` env var; if set, wires up file adapters. Falls back to empty defaults.
- `manifest.json` — MCPB manifest v0.4. User-configurable `corpusFile` (optional string); demo mode (empty corpus) when not set. Targets Node 18+, all three platforms.
- `scripts/build-mcpb.ts` — bundles `src/mcpb-entry.ts` via esbuild (ESM, `--bundle --platform=node`) into `dist/mcpb/server/index.mjs`, copies manifest and icon, then invokes `@anthropic-ai/mcpb pack`.
- `esbuild ^0.24` added to `devDependencies`.
- `build:mcpb` script added to `package.json`.

Corpus JSON format: `{ regulation[], tests[], checks[], playbooks[], taxonomy[] }` — all surfaces optional.

## Tool description improvements

- `search_regulation`: Added return shape (Regulation array with id/citation/text/commentary), pointer to `get_referrers` as next step, and clarified latest-only constraint with `as_of` fallback — was a single sentence with no return shape and no next-step guidance.
- `get_regulation`: Added return shape (citation, verbatim text, commentary), `as_of` use-case example, and pointer to `get_referrers` — was only the `as_of` hint with no context on when to call it or what comes back.
- `search_tests`: Added return shape (id/name/family/aliases/purpose/acceptance_criteria), note that aliases match bank-specific names, and pointer to `get_test` — was one bare sentence.
- `get_test`: Added return shape including `family` (equivalence group), note on how to use family for bank-variant reasoning, and pointer to `get_referrers` — was missing return shape and next-step guidance.
- `search_checks`: Added return shape (id/name/derived_from/expectation), pointer to `get_check`, and pointer to `get_regulation` on `derived_from` ids — was one bare sentence.
- `get_check`: Added return shape including `derived_from` (RegulationId[]) and pointer to `get_regulation` for the underlying law — was "Fetch a check by ID." with no further content.
- `search_playbooks`: Added return shape (id/area/subarea) and pointer to `get_playbook` for phases — was one bare sentence.
- `get_playbook`: Added return shape (phases with mixed-surface references array) and pointer to `get_regulation`/`get_test`/`get_check` for resolving references — was missing return shape and next-step guidance.

## Demo data fix

- `regulation://crr/180` text: Removed "long-run averages" phrasing (that detail lives in 180/1/a). The old text caused `search_regulation "long-run average"` to return CRR 180 *and* CRR 180/1/a instead of the CRR 180/1/a + EBA GL para 78 the README table specifies.
- `regulation://eba/gl-2017-16/78` text: Added "long-run average default rate" phrasing so the search correctly hits this entry, matching the README table contract.

## Demo comment fix

- `examples/inmemory-demo.ts` header comment: Changed `pnpm install` / `pnpm run demo` to `bun install` / `bun run demo` — the project uses Bun, not pnpm.

## Tests

- Added test: registers expected surface area (14 tools, 4 resource templates, 3 prompts) — tripwire against accidental registration drift.
- Added test: `get_referrers("regulation://crr/180/1/a")` with in-memory adapters returns `checks: ["check://lra-pd-derived"]`, `playbooks: ["playbook://calibration/pd"]`, and empty regulation/tests arrays — exercises cross-reference logic end-to-end.

## NOT FIXED

- `regulation://crr/180` is a parent-article stub without version history; the `as_of` code path for it is untested. Out of scope — no table entry exercises it and adding history would expand the demo beyond the brief.
