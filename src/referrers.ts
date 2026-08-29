/**
 * The ONE computed reverse index over cross-surface references.
 *
 * Every adapter's `meta.referrers` must delegate here so "what points at this
 * ID" has exactly one definition. Pure over the supplied arrays — callers pass
 * whatever their backend holds (a corpus file's arrays, Object.values of seed
 * maps, ...).
 *
 * A referrer is any record that names `id` through a typed reference:
 *   - regulation: `parent` or `children`
 *   - test:       `regulatory_basis` or `parent`
 *   - check:      `derived_from` or `parent`
 *   - playbook:   `regulatory_scope` or any `phases[].references` entry
 *
 * The mirror invariant (CLAUDE.md) makes the `children` scan mostly redundant
 * with the child-side scans for well-formed corpora, but scanning both sides
 * keeps the index truthful on corpora the linter hasn't blessed.
 */
import type {
  AnyId,
  Check,
  Playbook,
  Referrers,
  Regulation,
  RegulationChildId,
  RegulationId,
  Test,
} from "./schema.ts";

export interface ReferrersInput {
  regulation: Regulation[];
  tests: Test[];
  checks: Check[];
  playbooks: Playbook[];
}

export function computeReferrers(input: ReferrersInput, id: string): Referrers {
  // The scans below compare against typed arrays; a plain string that is not a
  // well-formed URI simply never matches, so the casts are safe.
  const asRegulation = id as RegulationId;
  const asChild = id as RegulationChildId;
  const asAny = id as AnyId;

  return {
    regulation: input.regulation
      .filter((r) => r.parent === asRegulation || r.children.includes(asChild))
      .map((r) => r.id),
    tests: input.tests
      .filter((t) => t.regulatory_basis.includes(asRegulation) || t.parent === asRegulation)
      .map((t) => t.id),
    checks: input.checks
      .filter((c) => c.derived_from.includes(asRegulation) || c.parent === asRegulation)
      .map((c) => c.id),
    playbooks: input.playbooks
      .filter(
        (p) =>
          p.regulatory_scope.includes(asRegulation) ||
          p.phases.some((ph) => ph.references.includes(asAny)),
      )
      .map((p) => p.id),
  };
}
