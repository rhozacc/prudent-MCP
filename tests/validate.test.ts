import { describe, expect, it } from "bun:test";

import { CheckSchema, RegulationSchema, SourceSchema, TestSchema } from "../src/schema.ts";
import type { Check, Regulation, Source, Test } from "../src/schema.ts";
import {
  STALE_AFTER_DAYS,
  corpusWarnings,
  findMarkup,
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

// Same approach for the content surfaces the verbatim invariant covers: parse
// through the schema, then override only the field under test. Every fixture is
// standalone (no parent/children), so no other rule fires.
function regulation(overrides: Partial<Regulation> & Pick<Regulation, "id">): Regulation {
  return RegulationSchema.parse({
    framework: "crr",
    document_id: "crr",
    document_version: "2024-01-09",
    citation: "CRR Article 181(1)(a)",
    text: "Institutions shall use LGD estimates that are appropriate for an economic downturn.",
    ...overrides,
  });
}

function check(overrides: Partial<Check> & Pick<Check, "id">): Check {
  return CheckSchema.parse({
    name: "Downturn LGD appropriateness",
    expectation: "The institution demonstrates that its downturn LGD is appropriate for the portfolio.",
    last_updated: "2026-08-20",
    ...overrides,
  });
}

function testRecord(overrides: Partial<Test> & Pick<Test, "id">): Test {
  return TestSchema.parse({
    name: "Downturn LGD comparison",
    purpose: "Compare realised downturn LGD against the estimate.",
    acceptance_criteria: "Estimated LGD is at least the realised downturn LGD.",
    last_updated: "2026-08-20",
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

describe("validateCorpus — verbatim invariant", () => {
  it("rejects markup in Regulation.text", () => {
    const errors = validateCorpus(
      {
        ...empty,
        regulation: [
          regulation({
            id: "regulation://crr/181/1/a",
            text: "LGD<sub>in-default</sub> shall reflect current economic circumstances.",
          }),
        ],
      },
      NOW,
    );
    expect(errors).toContain(
      "regulation://crr/181/1/a: text contains HTML markup <sub> (verbatim invariant)",
    );
  });

  it("rejects markup in Regulation.citation", () => {
    const errors = validateCorpus(
      {
        ...empty,
        regulation: [
          regulation({ id: "regulation://crr/181/1/a", citation: "CRR Article <em>181(1)(a)</em>" }),
        ],
      },
      NOW,
    );
    expect(errors).toContain(
      "regulation://crr/181/1/a: citation contains HTML markup <em> (verbatim invariant)",
    );
  });

  it("rejects markup in commentary, naming the entry", () => {
    const errors = validateCorpus(
      {
        ...empty,
        regulation: [
          regulation({
            id: "regulation://crr/181/1/a",
            commentary: [
              { source: "EBA Q&A 2017_3453", text: "Alignment is permitted." },
              {
                source: "EBA Q&A 2018_3804",
                text: 'Downturn LGD must be <span class="x">demonstrated</span>, not asserted.',
              },
            ],
          }),
        ],
      },
      NOW,
    );
    expect(errors).toContain(
      'regulation://crr/181/1/a: commentary[1].text contains HTML markup <span class="x"> (verbatim invariant)',
    );
  });

  it("rejects markup in a commentary attribution", () => {
    const errors = validateCorpus(
      {
        ...empty,
        regulation: [
          regulation({
            id: "regulation://crr/181/1/a",
            commentary: [{ source: "<b>EBA Q&A 2018_3804</b>", text: "Must be demonstrated." }],
          }),
        ],
      },
      NOW,
    );
    expect(errors).toContain(
      "regulation://crr/181/1/a: commentary[0].source contains HTML markup <b> (verbatim invariant)",
    );
  });

  it("rejects markup in Check.expectation", () => {
    const errors = validateCorpus(
      {
        ...empty,
        checks: [
          check({
            id: "check://calibration/lgd/downturn",
            expectation: "The downturn LGD is <strong>demonstrated</strong> against realised data.",
          }),
        ],
      },
      NOW,
    );
    expect(errors).toContain(
      "check://calibration/lgd/downturn: expectation contains HTML markup <strong> (verbatim invariant)",
    );
  });

  it("rejects markup in Test.acceptance_criteria", () => {
    const errors = validateCorpus(
      {
        ...empty,
        tests: [
          testRecord({
            id: "test://calibration/lgd-downturn",
            acceptance_criteria: "Estimated LGD >= realised downturn LGD.<br/>",
          }),
        ],
      },
      NOW,
    );
    expect(errors).toContain(
      "test://calibration/lgd-downturn: acceptance_criteria contains HTML markup <br/> (verbatim invariant)",
    );
  });

  // The false positive that would make this rule unusable: regulation and
  // acceptance criteria are full of comparators, and a bare "<" test would
  // reject real law.
  it("does not reject mathematical comparators", () => {
    const errors = validateCorpus(
      {
        ...empty,
        regulation: [
          regulation({
            id: "regulation://crr/178/1",
            citation: "CRR Article 178(1) (PD < 0.03)",
            text:
              "A default shall be considered to have occurred where PD < 0.03 and LGD > 0, " +
              "provided that 90 <= days past due and the threshold x <= y is met.",
          }),
        ],
        checks: [
          check({ id: "check://calibration/pd/lra", expectation: "Observed default rate > estimated PD." }),
        ],
        tests: [
          testRecord({
            id: "test://calibration/binomial",
            acceptance_criteria: "p-value > α (typically 0.05 one-sided) indicates calibration is not rejected.",
          }),
        ],
      },
      NOW,
    );
    expect(errors).toEqual([]);
  });

  it("passes a clean corpus across every covered field", () => {
    const errors = validateCorpus(
      {
        ...empty,
        regulation: [
          regulation({
            id: "regulation://crr/181/1/a",
            commentary: [{ source: "EBA Q&A 2018_3804", text: "Must be demonstrated, not asserted." }],
          }),
        ],
        checks: [check({ id: "check://calibration/lgd/downturn" })],
        tests: [testRecord({ id: "test://calibration/lgd-downturn" })],
        sources: [source({ id: "source://eba/gl-2017-16" })],
      },
      NOW,
    );
    expect(errors).toEqual([]);
  });
});

describe("findMarkup", () => {
  it("finds the first tag, in every tag shape", () => {
    expect(findMarkup("LGD<sub>in-default</sub>")).toBe("<sub>");
    expect(findMarkup("closing only: </sub>")).toBe("</sub>");
    expect(findMarkup("line<br />break")).toBe("<br />");
    expect(findMarkup('<a href="https://eba.europa.eu">GL</a>')).toBe('<a href="https://eba.europa.eu">');
    expect(findMarkup("<span class='x'>y</span>")).toBe("<span class='x'>");
    expect(findMarkup("<td colspan=2>")).toBe("<td colspan=2>");
  });

  it("ignores comparators and other legitimate angle brackets", () => {
    for (const value of [
      "PD < 0.03",
      "where LGD > 0",
      "p-value > α (typically 0.05)",
      "x <= y and y >= z",
      "5<10",
      "if x<y and z>0 then the estimate is rejected",
      "a < b > c",
      "no brackets at all",
      "",
    ]) {
      expect(findMarkup(value)).toBeUndefined();
    }
  });
});
