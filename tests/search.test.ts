import { describe, expect, it } from "bun:test";

import {
  checkSearchFields,
  rankedSearch,
  regulationSearchFields,
  tokenize,
  type SearchField,
} from "../src/search.ts";
import type { Check, Regulation } from "../src/schema.ts";

// ── rankedSearch — the one ranking definition every adapter shares ─────────────
//
// The old JSON.stringify substring scan matched keys and URIs (query
// "regulation" hit 100% of records) and dumped the whole corpus on "".
// These tests pin the replacement contract.

const check = (id: string, name: string, expectation: string, evidence: string[] = []): Check => ({
  id: id as Check["id"],
  name,
  derived_from: [],
  expectation,
  expected_evidence: evidence,
  last_updated: "2026-01-01",
});

const regulation = (id: string, citation: string, text: string): Regulation => ({
  id: id as Regulation["id"],
  framework: "crr",
  document_id: "crr",
  document_version: "2024-01-09",
  citation,
  text,
  commentary: [],
  children: [],
});

describe("tokenize", () => {
  it("lowercases, splits on non-alphanumerics, and drops empties", () => {
    expect(tokenize("Long-Run  Average (LRA)!")).toEqual(["long", "run", "average", "lra"]);
    expect(tokenize("regulation://crr/180/1/a")).toEqual(["regulation", "crr", "180", "1", "a"]);
    expect(tokenize("   ")).toEqual([]);
    expect(tokenize("")).toEqual([]);
  });
});

describe("rankedSearch", () => {
  it("returns [] for an empty or whitespace-only query — enumeration is list()'s job", () => {
    const items = [check("check://a/b", "Anything", "Anything at all.")];
    expect(rankedSearch(items, "", checkSearchFields)).toEqual([]);
    expect(rankedSearch(items, "   \t ", checkSearchFields)).toEqual([]);
    expect(rankedSearch(items, "()[]", checkSearchFields)).toEqual([]); // punctuation-only tokenizes to nothing
  });

  it("field weights order results: a name match outranks an expected_evidence match", () => {
    const evidenceOnly = check("check://a/evidence", "Unrelated title", "Unrelated bar.", [
      "calibration workbook per grade",
    ]);
    const nameHit = check("check://a/name", "Calibration tested per grade", "Unrelated bar.");
    // Input order deliberately puts the weaker match first.
    const results = rankedSearch([evidenceOnly, nameHit], "calibration", checkSearchFields);
    expect(results.map((m) => m.record.id)).toEqual(["check://a/name", "check://a/evidence"]);
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it("a whole-word occurrence outranks a substring-only occurrence at equal weight", () => {
    const wholeWord = check("check://w/whole", "The calibration check", "x.");
    const substringOnly = check("check://w/sub", "The recalibrations check", "x.");
    const results = rankedSearch([substringOnly, wholeWord], "calibration", checkSearchFields);
    expect(results.map((m) => m.record.id)).toEqual(["check://w/whole", "check://w/sub"]);
    expect(results[0]!.score).toBe(2 * results[1]!.score); // substring counts half
  });

  it("ties break by input order, so ranking is fully deterministic", () => {
    const a = check("check://t/a", "Calibration one", "x.");
    const b = check("check://t/b", "Calibration two", "x.");
    expect(rankedSearch([a, b], "calibration", checkSearchFields).map((m) => m.record.id)).toEqual([
      "check://t/a",
      "check://t/b",
    ]);
    expect(rankedSearch([b, a], "calibration", checkSearchFields).map((m) => m.record.id)).toEqual([
      "check://t/b",
      "check://t/a",
    ]);
  });

  it("caps at 20 results by default and honours an explicit limit", () => {
    const many = Array.from({ length: 25 }, (_, i) => check(`check://cap/${i}`, "Calibration", "x."));
    expect(rankedSearch(many, "calibration", checkSearchFields)).toHaveLength(20);
    expect(rankedSearch(many, "calibration", checkSearchFields, 3)).toHaveLength(3);
  });

  it("non-matching queries return [] — no key/URI leakage from the old stringify scan", () => {
    const items = [check("check://a/b", "Calibration", "Bar.")];
    // "expectation" and "last" are field NAMES, not values — must not match.
    expect(rankedSearch(items, "expectation", checkSearchFields)).toEqual([]);
    expect(rankedSearch(items, "zzz-no-such-token", checkSearchFields)).toEqual([]);
  });

  it("each match carries the best-scoring field name and an excerpt", () => {
    const short = check("check://e/short", "Calibration", "Short text.");
    const [m] = rankedSearch([short], "calibration", checkSearchFields);
    expect(m!.matched.field).toBe("name");
    expect(m!.matched.excerpt).toBe("Calibration"); // short values excerpt whole

    const longText = `${"Padding sentence. ".repeat(20)}The calibration target sits here.${" More padding.".repeat(20)}`;
    const long = check("check://e/long", "Unrelated", longText);
    const [ml] = rankedSearch([long], "calibration", checkSearchFields);
    expect(ml!.matched.field).toBe("expectation");
    expect(ml!.matched.excerpt).toContain("calibration");
    expect(ml!.matched.excerpt.length).toBeLessThanOrEqual(122); // ~120-char window + ellipses
    expect(ml!.matched.excerpt.startsWith("…")).toBe(true);
  });
});

// ── regulationSearchFields — the id field is query-shape dependent ─────────────

describe("coverage — how many of the query's tokens a record matched", () => {
  // The defect: score is a SUM over tokens, so a record matching only the
  // commonest token could outrank one matching every token. On the real corpus
  // "long run average default rate" matched 707 of 1,365 regulation records and
  // "margin of conservatism data quality" matched 984 of 1,107 checks, because
  // everything says "data" somewhere — and search_playbooks("PD model
  // lifecycle") put the one playbook actually about the lifecycle FOURTH.

  it("reports coverage and the query's token count on every match", () => {
    const hits = rankedSearch(
      [check("check://a", "downturn calibration", "")],
      "downturn calibration",
      checkSearchFields,
    );
    expect(hits[0]!.coverage).toBe(2);
    expect(hits[0]!.query_tokens).toBe(2);
  });

  it("ranks a record matching every token above one matching fewer at a HIGHER score", () => {
    // `narrow` matches both tokens once. `broad` matches only "model", but
    // eight times, so the old sum put it first.
    const narrow = check("check://narrow", "model lifecycle", "");
    const broad = check("check://broad", "model model model model model model model model", "");
    const hits = rankedSearch([broad, narrow], "model lifecycle", checkSearchFields);

    expect(hits[0]!.record.id).toBe("check://narrow");
    expect(hits[0]!.coverage).toBe(2);
    // Pinning that this is coverage doing the work, not score: the loser
    // genuinely scores higher.
    expect(hits[1]!.score).toBeGreaterThan(hits[0]!.score);
  });

  it("falls back to score within one coverage tier", () => {
    const strong = check("check://strong", "downturn downturn calibration", "");
    const weak = check("check://weak", "downturn calibration", "");
    const hits = rankedSearch([weak, strong], "downturn calibration", checkSearchFields);
    expect(hits.map((h) => h.coverage)).toEqual([2, 2]);
    expect(hits[0]!.record.id).toBe("check://strong");
  });

  it("counts a token once per record however many fields carry it", () => {
    // Coverage is "did this record match the token at all", not a tally.
    const hits = rankedSearch(
      [check("check://both", "downturn", "downturn", ["downturn"])],
      "downturn calibration",
      checkSearchFields,
    );
    expect(hits[0]!.coverage).toBe(1);
    expect(hits[0]!.query_tokens).toBe(2);
  });

  it("counts a token matched in a DIFFERENT field from its neighbour", () => {
    // "downturn" in the name and "calibration" only in the evidence is still
    // full coverage — the record is about both.
    const hits = rankedSearch(
      [check("check://split", "downturn", "", ["calibration evidence"])],
      "downturn calibration",
      checkSearchFields,
    );
    expect(hits[0]!.coverage).toBe(2);
  });

  it("leaves single-token queries exactly as they were", () => {
    // Coverage is 1 for every match, so ordering falls straight through to
    // score. This is what makes the change safe for the common case.
    const items = [
      check("check://one", "downturn", ""),
      check("check://three", "downturn downturn downturn", ""),
      check("check://two", "downturn downturn", ""),
    ];
    const hits = rankedSearch(items, "downturn", checkSearchFields);
    expect(hits.map((h) => h.coverage)).toEqual([1, 1, 1]);
    expect(hits.map((h) => h.record.id)).toEqual([
      "check://three",
      "check://two",
      "check://one",
    ]);
    // And score is still strictly decreasing — coverage did not reorder it.
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(hits[1]!.score).toBeGreaterThan(hits[2]!.score);
  });

  it("still drops records matching no token at all", () => {
    const hits = rankedSearch(
      [check("check://a", "downturn", "")],
      "unrelated words entirely",
      checkSearchFields,
    );
    expect(hits).toEqual([]);
  });

  it("keeps ties deterministic by input order at equal coverage and score", () => {
    const items = [
      check("check://first", "downturn calibration", ""),
      check("check://second", "downturn calibration", ""),
    ];
    expect(rankedSearch(items, "downturn calibration", checkSearchFields).map((h) => h.record.id))
      .toEqual(["check://first", "check://second"]);
  });
});

describe("regulationSearchFields", () => {
  const regs = [
    regulation("regulation://crr/180", "CRR Article 180", "PD estimation requirements."),
    regulation("regulation://crr/178/1/a", "CRR Article 178(1)(a)", "Unlikeliness to pay."),
  ];

  it("URI-ish queries match on id", () => {
    const hits = rankedSearch(regs, "crr/180", regulationSearchFields("crr/180"));
    expect(hits.map((m) => m.record.id)).toContain("regulation://crr/180");
    const full = rankedSearch(regs, "regulation://crr/178/1/a", regulationSearchFields("regulation://crr/178/1/a"));
    expect(full[0]!.record.id).toBe("regulation://crr/178/1/a");
  });

  it("prose queries never match through the URI scheme — 'regulation' no longer hits 100% of records", () => {
    // Every id contains "regulation", but no citation/text/commentary does.
    expect(rankedSearch(regs, "regulation", regulationSearchFields("regulation"))).toEqual([]);
  });

  it("prose queries still match citation ahead of text", () => {
    const hits = rankedSearch(regs, "article 178", regulationSearchFields("article 178"));
    expect(hits[0]!.record.id).toBe("regulation://crr/178/1/a");
    expect(hits[0]!.matched.field).toBe("citation");
  });
});

// ── array-valued fields ─────────────────────────────────────────────────────────

describe("array-valued search fields", () => {
  it("scans every value and anchors the excerpt on the first matching one", () => {
    const fields: SearchField<{ tags: string[] }>[] = [
      { name: "tags", weight: 1, get: (r) => r.tags },
    ];
    const [m] = rankedSearch([{ tags: ["nothing here", "jeffreys prior", "jeffreys again"] }], "jeffreys", fields);
    expect(m!.score).toBe(2); // one whole-word occurrence per value
    expect(m!.matched.excerpt).toBe("jeffreys prior");
  });
});
