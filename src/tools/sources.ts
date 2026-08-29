/**
 * Sources surface — the registry of source documents the corpus derives from,
 * with currency status. Read-only like everything else: maintaining the
 * registry means editing the corpus file (see .claude/commands/maintain-context.md),
 * never calling tools.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { adapters } from "../adapters.ts";
import { sourceIdSchema, SourceStatusSchema } from "../schema.ts";
import type { Milestone, Source, SourceId, SourceStatus } from "../schema.ts";

// list_sources projection. Members are explicit `| undefined` unions (not
// optional markers) so direct assignment compiles under
// exactOptionalPropertyTypes; JSON.stringify drops undefined-valued keys.
type SourceSummary = {
  id: SourceId;
  title: string;
  doc_type: Source["doc_type"];
  status: SourceStatus;
  verified: string;
  effective_from: string | undefined;
  superseded_by: SourceId | undefined;
  next_milestone: Milestone | undefined;
};

function asJson(v: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] };
}

export function registerSourceTools(server: McpServer): void {
  server.registerTool(
    "list_sources",
    {
      description:
        "The registry of source documents the corpus derives from — the " +
        "'is my regulatory context current?' answer. Returns per source: id, title, " +
        "doc_type, status (current | pending | superseded), verified (last date currency " +
        "was confirmed against the publisher), effective_from, superseded_by, and " +
        "next_milestone (the first upcoming regulatory date; milestones are kept " +
        "chronological). Optionally filter by status. Call get_source for the full " +
        "record including all milestones, or search_regulation for corpus content " +
        "under a document (sources join regulation records via document_id).",
      inputSchema: {
        status: SourceStatusSchema.optional().describe("Filter by lifecycle status."),
      },
    },
    async ({ status }) => {
      const sources = await adapters.source.list(status === undefined ? undefined : { status });
      return asJson(
        sources.map(
          (s): SourceSummary => ({
            id: s.id,
            title: s.title,
            doc_type: s.doc_type,
            status: s.status,
            verified: s.verified,
            effective_from: s.effective_from,
            superseded_by: s.superseded_by,
            next_milestone: s.milestones[0],
          }),
        ),
      );
    },
  );

  server.registerTool(
    "get_source",
    {
      description:
        "Fetch a source document record by ID. Returns title, framework, document_id " +
        "(joins to Regulation.document_id), doc_type, status, published / effective_from / " +
        "verified dates, superseded_by (set when status is superseded), milestones " +
        "(upcoming regulatory dates, chronological), url, and notes — or null if the id " +
        "is unknown. Use list_sources to see the whole registry, or search_regulation " +
        "for the corpus content derived from this document.",
      inputSchema: { id: sourceIdSchema },
    },
    async ({ id }) => asJson(await adapters.source.get(id)),
  );
}
