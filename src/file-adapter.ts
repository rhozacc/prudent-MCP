import { readFileSync } from "node:fs";
import { z } from "zod";
import type {
  CheckAdapter,
  MetaAdapter,
  PlaybookAdapter,
  RegulationAdapter,
  SourceAdapter,
  TestAdapter,
} from "./adapters.ts";
import {
  CheckSchema,
  CorpusInfoSchema,
  PlaybookSchema,
  RegulationSchema,
  ReviewAreaSchema,
  SourceSchema,
  TestSchema,
} from "./schema.ts";
import type {
  Check,
  CheckId,
  CorpusInfo,
  Playbook,
  PlaybookId,
  Referrers,
  Regulation,
  RegulationId,
  ReviewArea,
  Source,
  SourceId,
  Test,
  TestId,
} from "./schema.ts";
import { staleSourceIds } from "./validate.ts";

// --- Corpus file schema -------------------------------------------------------

const CorpusFileSchema = z.object({
  regulation: z.array(RegulationSchema).default([]),
  tests: z.array(TestSchema).default([]),
  checks: z.array(CheckSchema).default([]),
  playbooks: z.array(PlaybookSchema).default([]),
  sources: z.array(SourceSchema).default([]),
  taxonomy: z.array(ReviewAreaSchema).default([]),
  corpus_info: CorpusInfoSchema.optional(),
});

export type CorpusFile = z.infer<typeof CorpusFileSchema>;

export function loadCorpusFile(path: string): CorpusFile {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return CorpusFileSchema.parse(raw);
}

// --- In-memory adapters -------------------------------------------------------

function textSearch<T>(items: T[], query: string): T[] {
  const q = query.toLowerCase();
  return items.filter(item => JSON.stringify(item).toLowerCase().includes(q));
}

export function createFileAdapters(corpus: CorpusFile): {
  regulation: RegulationAdapter;
  test: TestAdapter;
  check: CheckAdapter;
  playbook: PlaybookAdapter;
  source: SourceAdapter;
  meta: MetaAdapter;
} {
  const regMap = new Map<RegulationId, Regulation>(corpus.regulation.map(r => [r.id, r]));
  const testMap = new Map<TestId, Test>(corpus.tests.map(t => [t.id, t]));
  const checkMap = new Map<CheckId, Check>(corpus.checks.map(c => [c.id, c]));
  const playbookMap = new Map<PlaybookId, Playbook>(corpus.playbooks.map(p => [p.id, p]));
  const sourceMap = new Map<SourceId, Source>(corpus.sources.map(s => [s.id, s]));

  const regulation: RegulationAdapter = {
    async search(query) { return textSearch(corpus.regulation, query); },
    async get(id) { return regMap.get(id) ?? null; },
  };

  const test: TestAdapter = {
    async search(query) { return textSearch(corpus.tests, query); },
    async get(id) { return testMap.get(id) ?? null; },
  };

  const check: CheckAdapter = {
    async search(query) { return textSearch(corpus.checks, query); },
    async get(id) { return checkMap.get(id) ?? null; },
  };

  const playbook: PlaybookAdapter = {
    async search(query) { return textSearch(corpus.playbooks, query); },
    async get(id) { return playbookMap.get(id) ?? null; },
  };

  const source: SourceAdapter = {
    async list(filter) {
      const status = filter?.status;
      return status === undefined ? corpus.sources : corpus.sources.filter(s => s.status === status);
    },
    async get(id) { return sourceMap.get(id) ?? null; },
  };

  const meta: MetaAdapter = {
    async info(): Promise<CorpusInfo> {
      // Source count and staleness are computed at serve time even when the
      // file ships a corpus_info block — stored currency data is stale by definition.
      const stale_sources = staleSourceIds(corpus.sources);
      if (corpus.corpus_info) {
        return {
          ...corpus.corpus_info,
          counts: { ...corpus.corpus_info.counts, source: corpus.sources.length },
          stale_sources,
        };
      }
      return {
        last_updated: new Date().toISOString(),
        counts: {
          regulation: corpus.regulation.length,
          test: corpus.tests.length,
          check: corpus.checks.length,
          playbook: corpus.playbooks.length,
          source: corpus.sources.length,
        },
        coverage: [...new Set(corpus.regulation.map(r => r.framework.toUpperCase()))],
        stale_sources,
      };
    },
    async referrers(id: string): Promise<Referrers> {
      const rid = id as RegulationId;
      return {
        regulation: corpus.regulation
          .filter(r => r.parent === id || r.children.includes(rid))
          .map(r => r.id),
        tests: corpus.tests
          .filter(t => t.regulatory_basis.includes(rid))
          .map(t => t.id),
        checks: corpus.checks
          .filter(c => c.derived_from.includes(rid))
          .map(c => c.id),
        playbooks: corpus.playbooks
          .filter(p => p.regulatory_scope.includes(rid))
          .map(p => p.id),
      };
    },
    async resolveCitation(text: string): Promise<Regulation | null> {
      const q = text.toLowerCase();
      return corpus.regulation.find(
        r => r.citation.toLowerCase().includes(q) || r.id.toLowerCase().includes(q),
      ) ?? null;
    },
    async taxonomy(): Promise<ReviewArea[]> {
      return corpus.taxonomy;
    },
  };

  return { regulation, test, check, playbook, source, meta };
}
