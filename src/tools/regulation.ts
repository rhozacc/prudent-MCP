/**
 * Regulation surface — versioned per source document.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { RegulationSchema, regulationIdSchema } from "../schema.ts";
import { rankedSearch, regulationSearchFields } from "../search.ts";
import {
  READ_ONLY_HINTS,
  lenient,
  miss,
  ok,
  paginate,
  searchInputShape,
  searchOutputShape,
  searchResult,
} from "./shared.ts";

// Concise projection served by search_regulation (detail: "concise").
const ConciseRegulationHit = z.object({
  id: regulationIdSchema,
  citation: z.string(),
  matched_excerpt: z.string().optional().describe("~120-char window around the best match"),
  document_id: z.string(),
  parent: regulationIdSchema.optional(),
});

export function registerRegulationTools(server: McpServer): void {
  server.registerTool(
    "search_regulation",
    {
      title: "Search regulation",
      description:
        "Ranked, field-scoped search over regulation citation, text, and commentary " +
        "(record ids join in only for URI-like queries). Returns { results, total_matches, " +
        "offset, truncated }; concise results (default) are { id, citation, matched_excerpt, " +
        "document_id, parent } — pass detail: 'full' for complete records. Latest versions only. " +
        "Follow up with get_regulation (as_of for history) or get_referrers on any id.",
      inputSchema: searchInputShape("citation, text, and commentary"),
      outputSchema: searchOutputShape(z.union([ConciseRegulationHit, RegulationSchema])),
      annotations: READ_ONLY_HINTS,
    },
    async ({ query, limit, offset, detail }) => {
      const records = await adapters.regulation.search(query);
      if (detail === "full") return searchResult(paginate(records, limit, offset));
      // The adapter interface returns records only — recompute matches locally
      // (cheap at result sizes) to attach the excerpt to each concise hit.
      const matches = rankedSearch(records, query, regulationSearchFields(query), records.length);
      const excerpts = new Map(matches.map((m) => [m.record.id, m.matched.excerpt]));
      const concise = records.map((r) => {
        const excerpt = excerpts.get(r.id);
        return {
          id: r.id,
          citation: r.citation,
          ...(excerpt !== undefined ? { matched_excerpt: excerpt } : {}),
          document_id: r.document_id,
          ...(r.parent !== undefined ? { parent: r.parent } : {}),
        };
      });
      return searchResult(paginate(concise, limit, offset));
    },
  );

  server.registerTool(
    "get_regulation",
    {
      title: "Get regulation",
      description:
        "Fetch one regulation paragraph by URI. Returns the full record: citation, verbatim " +
        "text, and attached commentary (supervisor Q&A, interpretive letters). Latest version " +
        "by default; pass as_of (ISO date) for the text in force on that date — backends " +
        "without history for the id serve the current text, and an as_of predating every " +
        "recorded version is a miss, never current text as historical. Unknown ids return " +
        "isError with a pointer. Use get_referrers to find operationalising checks/playbooks.",
      inputSchema: {
        id: lenient(regulationIdSchema).describe("e.g. regulation://crr/178/1/a"),
        as_of: z.string().date().optional().describe("ISO date, e.g. 2019-03-01"),
      },
      outputSchema: RegulationSchema,
      annotations: READ_ONLY_HINTS,
    },
    async ({ id, as_of }) => {
      const record = await adapters.regulation.get(id, as_of);
      if (record !== null) return ok(record);
      if (as_of !== undefined && (await adapters.regulation.get(id)) !== null) {
        return miss(
          `No version of ${id} was in force on ${as_of} according to this corpus's history. ` +
            "Historical coverage rule: as_of resolves against recorded versions only — a date " +
            "predating every recorded version returns nothing (backends without history for an " +
            "id always serve the current text). Retry without as_of for the current text.",
        );
      }
      return miss(`No record for ${id}. Verify the id with search_regulation or list_review_areas.`);
    },
  );
}
