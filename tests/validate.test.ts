import { describe, expect, it } from "bun:test";

import { SourceSchema } from "../src/schema.ts";
import type { Source } from "../src/schema.ts";
import {
  STALE_AFTER_DAYS,
  corpusWarnings,
  staleSourceIds,
  validateCorpus,
} from "../src/validate.ts";

// Every date-dependent rule gets a fixed clock — validator behavior must not
// depend on when the suite runs. With NOW below, the staleness cutoff is
// 2026-07-27 and "today" is 2026-08-26.
const NOW = new Date("2026-08-26T12:00:00Z");

const empty = { regulation: [], tests: [], checks: [], playbooks: [] };

// Build fixtures through the schema itself so defaults apply and the fixture
// is provably a valid Source before the rule under test sees it.
function source(overrides: Partial<Source> & Pick<Source, "id">): Source {
  return SourceSchema.parse({
    title: "Some document",
    framework: "eba",
    document_id: "some-doc",
    doc_type: "guideline",
    status: "current",
    verified: "2026-08-20",
    ...overrides,
  });
}

describe("validateCorpus — source registry rules", () => {
  it("a corpus without sources behaves exactly as before", () => {
    expect(validateCorpus(empty, NOW)).toEqual([]);
  });

  it("accepts a coherent registry (current, pending, superseded → current)", () => {
    const errors = validateCorpus(
      {
        ...empty,
        sources: [
          source({ id: "source://eba/gl-2017-16" }),
          source({ id: "source://eba/cp-2025-14", status: "pending" }),
          source({
            id: "source://eba/cp-2016-21",
            status: "superseded",
            superseded_by: "source://eba/gl-2017-16",
          }),
        ],
      },
      NOW,
    );
    expect(errors).toEqual([]);
  });

  it("rejects duplicate source ids", () => {
    const errors = validateCorpus(
      { ...empty, sources: [source({ id: "source://eba/x" }), source({ id: "source://eba/x" })] },
      NOW,
    );
    expect(errors).toContain("duplicate source id source://eba/x");
  });

  it("rejects superseded status without a superseded_by pointer", () => {
    const errors = validateCorpus(
      { ...empty, sources: [source({ id: "source://eba/old", status: "superseded" })] },
      NOW,
    );
    expect(errors).toContain(
      "source://eba/old: status superseded but superseded_by missing (supersession invariant)",
    );
  });

  it("rejects a superseded_by pointer on a non-superseded source", () => {
    const errors = validateCorpus(
      {
        ...empty,
        sources: [
          source({ id: "source://eba/new" }),
          source({ id: "source://eba/odd", superseded_by: "source://eba/new" }),
        ],
      },
      NOW,
    );
    expect(errors).toContain(
      "source://eba/odd: superseded_by set but status is current (supersession invariant)",
    );
  });

  it("rejects a dangling superseded_by pointer", () => {
    const errors = validateCorpus(
      {
        ...empty,
        sources: [
          source({ id: "source://eba/old", status: "superseded", superseded_by: "source://eba/ghost" }),
        ],
      },
      NOW,
    );
    expect(errors).toContain("source://eba/old: superseded_by source://eba/ghost does not resolve");
  });

  it("rejects a verified date in the future", () => {
    const errors = validateCorpus(
      { ...empty, sources: [source({ id: "source://eba/x", verified: "2026-08-27" })] },
      NOW,
    );
    expect(errors).toContain("source://eba/x: verified 2026-08-27 is in the future");
  });

  it("rejects a self-referencing supersession (1-cycle)", () => {
    const errors = validateCorpus(
      {
        ...empty,
        sources: [
          source({ id: "source://eba/loop", status: "superseded", superseded_by: "source://eba/loop" }),
        ],
      },
      NOW,
    );
    expect(errors.some((e) => e.startsWith("supersession cycle reachable from source://eba/loop"))).toBe(true);
  });

  it("rejects a mutual supersession (2-cycle)", () => {
    const errors = validateCorpus(
      {
        ...empty,
        sources: [
          source({ id: "source://eba/a", status: "superseded", superseded_by: "source://eba/b" }),
          source({ id: "source://eba/b", status: "superseded", superseded_by: "source://eba/a" }),
        ],
      },
      NOW,
    );
    expect(errors.some((e) => e.includes("supersession cycle reachable from"))).toBe(true);
  });

  it("does not treat staleness as an error", () => {
    const errors = validateCorpus(
      { ...empty, sources: [source({ id: "source://eba/stale", verified: "2026-01-01" })] },
      NOW,
    );
    expect(errors).toEqual([]);
  });
});

describe("staleSourceIds", () => {
  it("flags only current sources older than the cutoff", () => {
    const sources = [
      source({ id: "source://eba/stale", verified: "2026-07-26" }),          // 31 days — stale
      source({ id: "source://eba/on-cutoff", verified: "2026-07-27" }),      // exactly 30 days — not stale
      source({ id: "source://eba/fresh", verified: "2026-08-20" }),
      source({ id: "source://eba/old-pending", status: "pending", verified: "2026-01-01" }),
      source({
        id: "source://eba/old-superseded",
        status: "superseded",
        superseded_by: "source://eba/fresh",
        verified: "2026-01-01",
      }),
    ];
    expect(staleSourceIds(sources, NOW)).toEqual(["source://eba/stale"]);
  });
});

describe("corpusWarnings", () => {
  it("warns on stale current sources and stays quiet otherwise", () => {
    const warnings = corpusWarnings(
      {
        ...empty,
        sources: [
          source({ id: "source://eba/stale", verified: "2026-06-01" }),
          source({ id: "source://eba/fresh", verified: "2026-08-20" }),
          source({ id: "source://eba/old-pending", status: "pending", verified: "2026-01-01" }),
        ],
      },
      NOW,
    );
    expect(warnings).toEqual([
      `source://eba/stale: verified 2026-06-01 is older than ${STALE_AFTER_DAYS} days (stale)`,
    ]);
  });

  it("returns nothing for a corpus without sources", () => {
    expect(corpusWarnings(empty, NOW)).toEqual([]);
  });
});
