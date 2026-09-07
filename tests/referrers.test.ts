import { describe, expect, it } from "bun:test";

import { computeReferrers } from "../src/referrers.ts";
import { CheckSchema, RegulationSchema } from "../src/schema.ts";
import type { Check, Regulation } from "../src/schema.ts";

// The reverse index is only as discriminating as the edges it scans. On a real
// corpus `derived_from` names a whole section — a median of 23 ids — so the flat
// lists answer "roughly where does this come from" and cannot answer "which
// provision is this". `primary_basis` is the field that closes the gap, and this
// pins both halves: that the flat lists are still complete, and that `primary`
// actually discriminates.

const reg = (id: string): Regulation =>
  RegulationSchema.parse({
    id,
    framework: "eba",
    document_id: "eba-gl-2017-16",
    document_version: "2017-11-20",
    citation: id,
    text: "…",
  });

const chk = (id: string, derived: string[], primary?: string[]): Check =>
  CheckSchema.parse({
    id,
    name: id,
    expectation: "…",
    last_updated: "2026-08-20",
    derived_from: derived,
    ...(primary !== undefined ? { primary_basis: primary } : {}),
  });

const SECTION_SPAN = ["regulation://d/s4", "regulation://d/78", "regulation://d/79"];

const input = {
  regulation: [reg("regulation://d/s4"), reg("regulation://d/78"), reg("regulation://d/79")],
  tests: [],
  playbooks: [],
  checks: [
    // Both traced to the whole section; each restating one paragraph of it.
    chk("check://d/a", SECTION_SPAN, ["regulation://d/78"]),
    chk("check://d/b", SECTION_SPAN, ["regulation://d/79"]),
  ],
};

describe("computeReferrers — traced span vs primary basis", () => {
  it("returns an identical traced set for every article in a section", () => {
    // Not a bug in the scan — it is what `derived_from` says. It is also why
    // the flat lists alone cannot answer "what rests on THIS provision".
    expect(computeReferrers(input, "regulation://d/78").checks).toEqual([
      "check://d/a",
      "check://d/b",
    ]);
    expect(computeReferrers(input, "regulation://d/79").checks).toEqual([
      "check://d/a",
      "check://d/b",
    ]);
  });

  it("discriminates on primary_basis, which is what that field exists for", () => {
    expect(computeReferrers(input, "regulation://d/78").primary.checks).toEqual(["check://d/a"]);
    expect(computeReferrers(input, "regulation://d/79").primary.checks).toEqual(["check://d/b"]);
    // The section itself is nobody's primary basis: it is the span, not the rule.
    expect(computeReferrers(input, "regulation://d/s4").primary.checks).toEqual([]);
  });

  it("is empty rather than wrong on a corpus carrying no primary_basis", () => {
    const legacy = { ...input, checks: [chk("check://d/c", ["regulation://d/78"])] };
    const r = computeReferrers(legacy, "regulation://d/78");
    expect(r.checks).toEqual(["check://d/c"]);
    expect(r.primary.checks).toEqual([]);
  });
});
