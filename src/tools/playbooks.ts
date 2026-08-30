/**
 * Playbooks surface — guided walkthroughs for review areas.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { adapters } from "../adapters.ts";
import { PlaybookSchema, playbookIdSchema } from "../schema.ts";
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

// Concise projection served by search_playbooks (detail: "concise").
const ConcisePlaybookHit = z.object({
  id: playbookIdSchema,
  area: z.string(),
  subarea: z.string().optional(),
  phase_count: z.number().int(),
});

export function registerPlaybookTools(server: McpServer): void {
  server.registerTool(
    "search_playbooks",
    {
      title: "Search playbooks",
      description:
        "Ranked, field-scoped search over validation playbooks: area, subarea, phase names, " +
        "and phase descriptions. Returns { results, total_matches, offset, truncated }; " +
        "concise results (default) are { id, area, subarea, phase_count } — pass detail: 'full' " +
        "for complete records. Follow up with expand_playbook (references resolved inline) or " +
        "get_playbook for the raw record.",
      inputSchema: searchInputShape("area, subarea, and phase names/descriptions"),
      outputSchema: searchOutputShape(z.union([ConcisePlaybookHit, PlaybookSchema])),
      annotations: READ_ONLY_HINTS,
    },
    async ({ query, limit, offset, detail }) => {
      const records = await adapters.playbook.search(query);
      if (detail === "full") return searchResult(paginate(records, limit, offset));
      const concise = records.map((p) => ({
        id: p.id,
        area: p.area,
        ...(p.subarea !== undefined ? { subarea: p.subarea } : {}),
        phase_count: p.phases.length,
      }));
      return searchResult(paginate(concise, limit, offset));
    },
  );

  server.registerTool(
    "get_playbook",
    {
      title: "Get playbook",
      description:
        "Fetch one playbook by ID (area or area/subarea). Returns the full record: ordered " +
        "phases — each with a description and a references array of mixed regulation://, " +
        "test://, check:// IDs — plus gates and regulatory_scope. Unknown ids return isError " +
        "with a pointer. Prefer expand_playbook to resolve every reference in one call.",
      inputSchema: { id: lenient(playbookIdSchema).describe("e.g. playbook://calibration/pd") },
      outputSchema: PlaybookSchema,
      annotations: READ_ONLY_HINTS,
    },
    async ({ id }) => {
      const record = await adapters.playbook.get(id);
      if (record === null) return miss(`No record for ${id}. Verify the id with search_playbooks or list_review_areas.`);
      return ok(record);
    },
  );
}
