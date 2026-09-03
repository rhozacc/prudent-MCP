/**
 * The ONE definition of a review-area key.
 *
 * Playbooks carry `area` and optional `subarea` as free-form prose — "PD
 * Estimation", "Credit Risk" / "IRB Approach Governance, Validation and
 * Lifecycle Management" — because that is what the extraction produced. The
 * ReviewArea taxonomy addresses the same nodes by slug ("pd-estimation"). Two
 * spellings of one thing is exactly the drift that breaks a join silently, so
 * both the taxonomy and every lookup over it go through this module, the way
 * referrers go through referrers.ts and ranking through search.ts.
 *
 * WHY THIS EXISTS. `get_area_overview` used to filter `p.area === area` — a
 * slug compared against prose — and `list_review_areas` served whatever the
 * corpus put in `taxonomy`, which on the shipped corpus was `[]`. So two of
 * nineteen tools were inert, including the entry point the server's own
 * instructions name first: an agent asked for the areas, got an empty list,
 * and could not have guessed a slug that did not exist. It fell back to
 * search_playbooks and read thirteen of sixteen playbooks to answer one
 * question.
 *
 * A DERIVED taxonomy is a fallback, not the goal. An editorial taxonomy says
 * what an analyst's task maps onto, including areas the corpus does not cover
 * yet; a derived one can only report what is already there. So an explicit
 * `taxonomy` in the corpus always wins, and this fills in when there is none —
 * which keeps the entry path working for every backend rather than only for
 * corpora that remembered to author one.
 */
import type { Playbook, ReviewArea } from "./schema.ts";

/**
 * One prose label → one path segment. Lowercase, runs of anything that is not
 * a letter or digit collapsed to a single hyphen, ends trimmed.
 *
 * "IRB Approach Governance, Validation and Lifecycle Management"
 *   → "irb-approach-governance-validation-and-lifecycle-management"
 */
export function areaSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The canonical id for an area, or for a subarea beneath one. Dotted, matching
 * the shape the ReviewArea schema documents ("calibration.lgd").
 */
export function areaKey(area: string, subarea?: string): string {
  const top = areaSlug(area);
  if (subarea === undefined || subarea.trim() === "") return top;
  return `${top}.${areaSlug(subarea)}`;
}

/** The key a playbook sits at — its subarea node when it has one. */
export function playbookAreaKey(p: Playbook): string {
  return areaKey(p.area, p.subarea);
}

/**
 * Derive the taxonomy from the playbooks present.
 *
 * Areas come out in first-seen order so the list is stable across reads, and a
 * top-level node is emitted even when every playbook under it sits in a
 * subarea — otherwise `parent` would point at something the caller was never
 * told about.
 */
export function deriveTaxonomy(playbooks: readonly Playbook[]): ReviewArea[] {
  const nodes = new Map<string, ReviewArea>();

  const upsert = (id: string, name: string, parent?: string): ReviewArea => {
    const existing = nodes.get(id);
    if (existing !== undefined) return existing;
    const node: ReviewArea = parent === undefined
      ? { id, name, children: [] }
      : { id, name, parent, children: [] };
    nodes.set(id, node);
    return node;
  };

  for (const p of playbooks) {
    const top = upsert(areaSlug(p.area), p.area);
    if (p.subarea === undefined || p.subarea.trim() === "") continue;
    const childId = areaKey(p.area, p.subarea);
    upsert(childId, p.subarea, top.id);
    if (!top.children.includes(childId)) top.children.push(childId);
  }

  return [...nodes.values()];
}

/**
 * Resolve whatever a caller passed as an area onto a taxonomy node.
 *
 * Deliberately forgiving about spelling, because the two things an agent has
 * to hand are a slug it read from `list_review_areas` and the prose it read
 * off a playbook record — and being told "unknown review area 'PD Estimation'"
 * after reading exactly that string off a playbook is the kind of dead end
 * that sends a model back to full-text search. Accepted, in order:
 *
 *   1. the id verbatim                        "credit-risk.irb-approach-…"
 *   2. the id after slugging                  "Credit Risk.IRB Approach …"
 *   3. a node's name, slugged                 "PD Estimation"
 *
 * Returns undefined when nothing matches, so the caller can still miss loudly.
 */
export function resolveArea(
  areas: readonly ReviewArea[],
  wanted: string,
): ReviewArea | undefined {
  const raw = wanted.trim();
  if (raw === "") return undefined;

  const byId = areas.find((a) => a.id === raw);
  if (byId !== undefined) return byId;

  // Slug each dotted segment independently, so a prose "Credit Risk.IRB
  // Approach Governance" lands on the same id as the slug form.
  const slugged = raw.split(".").map(areaSlug).filter((s) => s !== "").join(".");
  const bySlug = areas.find((a) => a.id === slugged);
  if (bySlug !== undefined) return bySlug;

  return areas.find((a) => areaSlug(a.name) === slugged);
}

/**
 * Does this playbook belong to `node`?
 *
 * True for the node's own playbooks and — when the node is a top-level area —
 * for everything in its subareas, so asking for "credit-risk" returns the
 * whole area rather than only the playbooks that happen to have no subarea.
 */
export function playbookInArea(p: Playbook, node: ReviewArea): boolean {
  const key = playbookAreaKey(p);
  return key === node.id || key.startsWith(`${node.id}.`);
}
