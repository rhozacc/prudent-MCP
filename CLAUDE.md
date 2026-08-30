# Claude Code: prudent-mcp v0.5

This file is the working brief when extending the codebase. For human onboarding read `README.md` and `docs/corpus/index.md` first.

## What this is

An MCP server that exposes a structured knowledge base for IRB credit-risk model validation. Five parallel surfaces — `regulation`, `tests`, `checks`, `playbooks`, `sources` — each with its own URI scheme, plus cross-cutting tools, a review-area taxonomy, and prompt scaffolds. The `sources` surface is the regulatory-context registry: which documents the corpus derives from and whether that context is current.

The server is the **read-only knowledge layer**. No execution, no writes, no orchestration. That boundary is load-bearing.

## What's already here

```
src/
├── server.ts              MCP server + explicit registration of every module
├── schema.ts              zod schemas + template literal URI types
├── adapters.ts            interfaces per surface + empty defaults + handles
├── file-adapter.ts        file-based adapters loaded from a corpus JSON file (incl. regulation_history + resolveCitationIn)
├── mcpb-entry.ts          MCPB entry point (wires file-adapter or empty defaults; startup integrity gate)
├── referrers.ts           computeReferrers — the ONE reverse index every adapter delegates to
├── search.ts              rankedSearch + per-surface field sets — the ONE ranking definition
├── resources.ts           URI templates mirroring the schemes (completions; misses are -32002)
├── tools/                 meta (incl. traversal tools) + one file per surface + shared.ts (envelopes, annotations, leniency)
└── prompts/               three prompt scaffolds

manifest.json              MCPB manifest v0.4
examples/inmemory-demo.ts  seeded in-memory server, runnable end-to-end
scripts/generate-schemas.ts  zod → JSON Schema export (chained to also write the schema reference page)
scripts/schema-registry.ts   shared named-schema list (generator, schema-docs, drift test)
scripts/generate-schema-docs.ts  regenerates docs/corpus/schemas.md (rendered schema reference)
scripts/list-all.ts          prints full corpus overview to stdout
scripts/validate-corpus.ts   integrity linter (mirror invariant, dangling refs, cycles, source supersession; warns on stale sources); CI-able
scripts/generate-graph.ts    regenerates docs/corpus/graph.md (Mermaid corpus map)
scripts/build-mcpb.ts        bundle src/mcpb-entry.ts + pack .mcpb
docs/                      architecture, corpus structure, schema reference, corpus graph
tests/smoke.test.ts        construction + traversal smoke tests
tests/schema.test.ts       schema validation + generative URI tests
tests/schema-drift.test.ts golden test: committed JSON Schemas match the zod defs
tests/validate.test.ts     validator rules (source supersession, staleness warnings)
```

Every tool, resource, and prompt has a description, a zod input schema, and a handler. In the open-source distribution the default adapters return empty results. The in-memory demo reassigns adapter handles to seed real content for development and inspection.

## Stack

Bun. TypeScript strict. `@modelcontextprotocol/sdk` (TS-first). zod for runtime validation, template literal types (`type RegulationId = `regulation://${string}``) for compile-time URI segregation.

`bun run typecheck`, `bun test`, `bun run inspect:demo`, `bun run schemas`, `bun run validate`, `bun run graph`, `bun run build:mcpb`. No `tsc` build step for local dev.

## What to do when extending

1. Read `src/schema.ts` and `docs/corpus/index.md` together — schema decisions all map to a use case.
2. `bun install && bun run typecheck && bun test`.
3. `bun run inspect:demo` — exercise the surface end-to-end.
4. Make your change. Strict mode catches things; trust the type errors.
5. If you change schemas, run `bun run schemas` and commit the regenerated JSON Schemas under `docs/schemas/`.

## Schema decisions worth understanding before extending

- **Template literal URI types** — `Check.derived_from: RegulationId[]` rejects a `TestId` at compile time. Don't widen to `string[]`.
- **`Regulation.children` is mixed but typed** — `RegulationChildId = RegulationId | TestId | CheckId`. A record nests sub-regulations *and* the checks/tests that operationalize it; a `PlaybookId` is rejected at compile time. It stays the denormalized inverse of `parent`, which now also lives on `Check`/`Test`. **Mirror invariant:** a check/test listed as a child must also name that regulation in `derived_from`/`regulatory_basis` (and point back via `parent`), so `get_referrers` remains the single computed reverse index — don't add a second scan over `children`.
- `Check.derived_from` + `Check.expectation` + `Check.expected_evidence` — traceability from supervisor expectations back to law, plus the concrete artifacts a reviewer must gather. Without `derived_from`, a Check is opinion. Without `expected_evidence`, it's underspecified.
- **Check URI shape** — `check://{area}/{topic}[/{specific}]` (e.g. `check://calibration/pd/lra-derived`). Hierarchical, consistent with `regulation://`. Don't flatten back to `check://slug`.
- **`Source` is a currency registry, not referenced content** — `source://{framework}/{document-id}`, latest-only (supersession = `status` + `superseded_by`, linter-enforced: the two imply each other, pointers resolve, chains are acyclic). It stays out of `children`, `get_referrers`, `AnyId`, and the mirror invariant; the join to regulation is `framework` + `document_id` string equality, computed where needed. `verified` drives the 30-day staleness surfaced by `get_corpus_info.stale_sources` and `bun run validate` warnings; `milestones` are chronological display strings (never parsed) and `milestones[0]` is served as `next_milestone`. Maintenance = `/maintain-context` session edits gated by the linter, never write tools.
- **`list()` vs `search()` on every content adapter** — `list()` returns ALL records and is the enumeration/traversal contract (cross-cutting tools, scripts, validators, completions). `search(query)` is ranked, field-scoped relevance search via `src/search.ts` (`rankedSearch`, per-surface field sets, 20-match default cap); an empty/whitespace query returns `[]`. Never lean on `search("")` to enumerate — that undocumented contract is gone, and the tool layer rejects sub-2-char queries anyway. The one-call corpus dump mattered: the corpus is the paid product.
- **`regulation_history` + the `as_of` rule** — the corpus file's optional `regulation_history` key (`{ id, effective_from, record }` entries) powers `get(id, asOf)`: no history for the id → current record (corpora without history behave exactly as before); history present → last entry with `effective_from <= asOf`; asOf predating every entry → `null`, never current text served as historical. The current version is asOf-selectable only via a current-boundary entry. `RegulationHistoryEntrySchema` is exported but deliberately NOT in `scripts/schema-registry.ts` (it's file-format plumbing, not a surface schema).
- `Test.family` + `Test.aliases` + `Test.acceptance_criteria` — equivalence reasoning across bank-specific test variants.
- `Regulation.commentary` — interpretive material (Q&A, supervisor letters), source-attributed.
- `Playbook.phases` — structured walkthrough with mixed-surface references in each phase.
- `ReviewArea` — canonical taxonomy. The map from "what an analyst is doing" to "what's in the corpus."

## Design constraints

- Read-only. No write tools.
- No execution. The server describes; computation lives elsewhere.
- Versioning only on `Regulation`. Other surfaces always serve latest; source supersession is a `status` + pointer, not history.
- URI schemes match surface names.
- Cross-surface references are typed.
- Strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Keep both on.
- **Licensing is settled — don't drift it.** The server code is AGPL-3.0-only
  (`LICENSE`, `package.json`, `manifest.json`, `README.md` and `docs/index.md` must
  all agree). The corpus is proprietary, licensed separately, and never enters this
  repo. Embedding/OEM/on-prem is offered under a commercial licence instead. The
  copyleft is deliberate: the server ships only a stdio transport, so any hosted
  deployment is a modified work and §13 reaches its transport, auth and metering
  layer — that is the asset being protected, not the corpus, which no code licence
  can reach. Anything bundled into the `.mcpb` needs its notice in
  `THIRD-PARTY-NOTICES.md`.

## Don't add (yet)

- Authentication, rate limiting, telemetry.
- More reference adapters under `examples/`. The in-memory demo is the template; backend-specific adapters belong outside this repo.
- More prompts beyond the existing three scaffolds.

## Surface area

```
Tools:       19   9 cross-cutting + (search + get) × 4 surfaces + (list + get) × 1 registry
                  cross-cutting: get_corpus_info · get_referrers · resolve_citation
                                 list_review_areas · expand_playbook · get_area_overview
                                 expand_regulation · get_regulation_tree · get_coverage_gaps
Templates:    5   one per URI scheme
Prompts:      3   validate_review_area · review_calibration · assess_findings
Schemas:     11   Regulation · Test · Check · Playbook · Source · CorpusInfo
                  · Referrers · Commentary · Phase · Milestone · ReviewArea
```
