import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZodError } from "zod";

import { createFileAdapters, loadCorpusFile } from "../src/file-adapter.ts";

// The load path deserves a real file: loadCorpusFile is readFileSync + JSON +
// zod, and everything downstream (MCPB entry, CORPUS_FILE validation runs)
// goes through it. Fixtures are written to a per-run temp dir.
const dir = mkdtempSync(join(tmpdir(), "prudent-corpus-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function writeCorpus(name: string, corpus: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(corpus, null, 2));
  return path;
}

// A small but fully populated five-surface corpus. Source `verified` dates sit
// far in the past so staleness is deterministic without an injectable clock
// (meta.info() uses the wall clock): the current source is always stale, and
// the superseded/pending ones are never flagged regardless of the run date.
const fullCorpus = {
  regulation: [
    {
      id: "regulation://crr/1",
      framework: "crr",
      document_id: "crr",
      document_version: "2024-01-09",
      citation: "CRR Art. 1",
      text: "Scope of application of the prudential perimeter.",
      children: ["check://scope/entities"],
    },
    {
      id: "regulation://eba/gl-x/1",
      framework: "eba",
      document_id: "eba-gl-x",
      document_version: "2020-01-01",
      citation: "EBA GL X para 1",
      text: "Calibration testing expectations.",
    },
  ],
  tests: [
    {
      id: "test://binomial",
      name: "Binomial test",
      purpose: "One-sided calibration back-test per grade.",
      regulatory_basis: ["regulation://eba/gl-x/1"],
      last_updated: "2026-08-01",
    },
  ],
  checks: [
    {
      id: "check://scope/entities",
      name: "Perimeter completeness",
      derived_from: ["regulation://crr/1"],
      parent: "regulation://crr/1",
      expectation: "Every in-scope entity is covered by the model landscape.",
      expected_evidence: ["Entity perimeter list"],
      last_updated: "2026-08-01",
    },
  ],
  playbooks: [
    {
      id: "playbook://scope/review",
      area: "scope",
      phases: [
        {
          name: "Phase 1",
          description: "Establish the perimeter.",
          references: ["regulation://crr/1", "check://scope/entities"],
        },
      ],
      regulatory_scope: ["regulation://crr/1"],
      last_updated: "2026-08-01",
    },
  ],
  sources: [
    {
      id: "source://crr/crr",
      title: "Capital Requirements Regulation",
      framework: "crr",
      document_id: "crr",
      doc_type: "regulation",
      status: "current",
      verified: "2020-01-01", // always older than STALE_AFTER_DAYS → always stale
    },
    {
      id: "source://eba/gl-old",
      title: "Old guidelines",
      framework: "eba",
      document_id: "eba-gl-old",
      doc_type: "guideline",
      status: "superseded",
      superseded_by: "source://crr/crr",
      verified: "2020-01-01", // equally old, but never flagged: not current
    },
    {
      id: "source://eba/cp-x",
      title: "Consultation paper X",
      framework: "eba",
      document_id: "eba-cp-x",
      doc_type: "consultation",
      status: "pending",
      verified: "2020-01-01", // equally old, but never flagged: not current
    },
  ],
  taxonomy: [{ id: "scope", name: "Scope" }],
  // Stored corpus_info in the pre-sources 4-key shape: no `source` count, no
  // stale_sources. counts.regulation is deliberately wrong (42) to prove the
  // serve-time overlay replaces ONLY counts.source and stale_sources — stored
  // values pass through otherwise.
  corpus_info: {
    last_updated: "2026-08-01T00:00:00.000Z",
    counts: { regulation: 42, test: 1, check: 1, playbook: 1 },
    coverage: ["CRR", "EBA-GL-X"],
  },
};

describe("loadCorpusFile", () => {
  it("parses a full five-surface corpus from disk", () => {
    const corpus = loadCorpusFile(writeCorpus("full.json", fullCorpus));
    expect(corpus.regulation.map((r) => r.id)).toEqual(["regulation://crr/1", "regulation://eba/gl-x/1"]);
    expect(corpus.tests).toHaveLength(1);
    expect(corpus.checks).toHaveLength(1);
    expect(corpus.playbooks).toHaveLength(1);
    expect(corpus.sources).toHaveLength(3);
    expect(corpus.taxonomy.map((a) => a.id)).toEqual(["scope"]);
    // zod defaults applied inside records too
    expect(corpus.regulation[1]!.children).toEqual([]);
    expect(corpus.tests[0]!.aliases).toEqual([]);
  });

  it("fills defaults for missing surface keys (sources/taxonomy absent → [])", () => {
    const corpus = loadCorpusFile(
      writeCorpus("minimal.json", { regulation: [fullCorpus.regulation[0]] }),
    );
    expect(corpus.regulation).toHaveLength(1);
    expect(corpus.tests).toEqual([]);
    expect(corpus.checks).toEqual([]);
    expect(corpus.playbooks).toEqual([]);
    expect(corpus.sources).toEqual([]);
    expect(corpus.taxonomy).toEqual([]);
    expect(corpus.corpus_info).toBeUndefined();
  });

  it("accepts a stored corpus_info block with pre-sources 4-key counts", () => {
    const corpus = loadCorpusFile(writeCorpus("full.json", fullCorpus));
    expect(corpus.corpus_info).toBeDefined();
    expect(corpus.corpus_info!.counts.source).toBeUndefined();
    // stale_sources defaults to [] so old stored blocks stay parseable
    expect(corpus.corpus_info!.stale_sources).toEqual([]);
  });

  it("throws a ZodError on a malformed record (regulation with a test:// id)", () => {
    const path = writeCorpus("malformed.json", {
      regulation: [{ ...fullCorpus.regulation[0], id: "test://not-a-regulation" }],
    });
    expect(() => loadCorpusFile(path)).toThrow(ZodError);
  });
});

describe("createFileAdapters", () => {
  const adapters = createFileAdapters(loadCorpusFile(writeCorpus("adapters.json", fullCorpus)));

  it("get round-trips every content surface and misses cleanly", async () => {
    const regHit = await adapters.regulation.get("regulation://crr/1");
    expect(regHit?.citation).toBe("CRR Art. 1");
    expect(await adapters.regulation.get("regulation://nope")).toBeNull();

    const testHit = await adapters.test.get("test://binomial");
    expect(testHit?.name).toBe("Binomial test");
    expect(await adapters.test.get("test://nope")).toBeNull();

    const checkHit = await adapters.check.get("check://scope/entities");
    expect(checkHit?.expected_evidence).toEqual(["Entity perimeter list"]);
    expect(await adapters.check.get("check://nope/nope")).toBeNull();

    const playbookHit = await adapters.playbook.get("playbook://scope/review");
    expect(playbookHit?.phases[0]?.references).toContain("check://scope/entities");
    expect(await adapters.playbook.get("playbook://nope")).toBeNull();

    const sourceHit = await adapters.source.get("source://eba/gl-old");
    expect(sourceHit?.superseded_by).toBe("source://crr/crr");
    expect(await adapters.source.get("source://eba/nope")).toBeNull();
  });

  it("search matches record text case-insensitively and misses cleanly", async () => {
    expect((await adapters.regulation.search("PRUDENTIAL perimeter")).map((r) => r.id)).toEqual([
      "regulation://crr/1",
    ]);
    expect((await adapters.test.search("binomial")).map((t) => t.id)).toEqual(["test://binomial"]);
    expect((await adapters.check.search("perimeter list")).map((c) => c.id)).toEqual([
      "check://scope/entities",
    ]);
    expect((await adapters.playbook.search("establish the perimeter")).map((p) => p.id)).toEqual([
      "playbook://scope/review",
    ]);
    expect(await adapters.regulation.search("zzz-no-such-token")).toEqual([]);
  });

  it("source list returns everything unfiltered and filters by status", async () => {
    expect((await adapters.source.list()).map((s) => s.id)).toEqual([
      "source://crr/crr",
      "source://eba/gl-old",
      "source://eba/cp-x",
    ]);
    expect((await adapters.source.list({ status: "current" })).map((s) => s.id)).toEqual([
      "source://crr/crr",
    ]);
    expect((await adapters.source.list({ status: "superseded" })).map((s) => s.id)).toEqual([
      "source://eba/gl-old",
    ]);
    expect((await adapters.source.list({ status: "pending" })).map((s) => s.id)).toEqual([
      "source://eba/cp-x",
    ]);
  });

  it("meta.info() overlays computed counts.source and stale_sources on a stored corpus_info", async () => {
    const info = await adapters.meta.info();
    // Stored values pass through untouched — including the deliberately wrong
    // regulation count, proving the overlay is surgical.
    expect(info.last_updated).toBe("2026-08-01T00:00:00.000Z");
    expect(info.coverage).toEqual(["CRR", "EBA-GL-X"]);
    expect(info.counts.regulation).toBe(42);
    // …while source count and staleness are computed at serve time.
    expect(info.counts.source).toBe(3);
    expect(info.stale_sources).toEqual(["source://crr/crr"]);
  });

  it("meta.info() computes everything when the file ships no corpus_info", async () => {
    const bare = createFileAdapters(
      loadCorpusFile(writeCorpus("bare.json", { regulation: fullCorpus.regulation })),
    );
    const info = await bare.meta.info();
    expect(info.counts).toEqual({ regulation: 2, test: 0, check: 0, playbook: 0, source: 0 });
    expect(info.coverage).toEqual(["CRR", "EBA"]);
    expect(info.stale_sources).toEqual([]);
    expect(Number.isNaN(Date.parse(info.last_updated))).toBe(false);
  });
});
