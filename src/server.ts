#!/usr/bin/env node
/**
 * Prudent-MCP server entry point.
 *
 * Registration is explicit (no decorator side effects) — read this file and
 * you can see exactly what surface area exists.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import packageJson from "../package.json";
import { registerMetaTools } from "./tools/meta.ts";
import { registerRegulationTools } from "./tools/regulation.ts";
import { registerTestTools } from "./tools/tests.ts";
import { registerCheckTools } from "./tools/checks.ts";
import { registerPlaybookTools } from "./tools/playbooks.ts";
import { registerSourceTools } from "./tools/sources.ts";
import { registerResources } from "./resources.ts";
import { registerPrompts } from "./prompts/validateReviewArea.ts";

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "prudent-mcp",
      // Single-sourced from package.json — the two drifted before.
      version: packageJson.version,
    },
    {
      instructions:
        "IRB credit-risk model validation knowledge layer — read-only; the server describes, computation happens elsewhere.\n" +
        "Five surfaces with matching URI schemes: regulation:// test:// check:// playbook:// source://.\n" +
        "Entry path: get_corpus_info → list_review_areas → get_area_overview(area) for the one-shot bundle of a review area.\n" +
        "Traversal: expand_playbook / expand_regulation (references resolved inline), get_regulation_tree (dossier walk, " +
        "200-node cap), get_referrers (the reverse index), get_coverage_gaps (its aggregate inverse).\n" +
        "Conventions: search_* and traversal tools are concise by default — pass detail: 'full' for complete records; " +
        "search_* return { results, total_matches, offset, truncated }.\n" +
        "Misses come back as isError results pointing at the right search/list tool — never a bare 'null'.\n" +
        "Regulation is the only versioned surface: pass as_of (ISO date) for the text in force on that date; backends " +
        "without history serve current text, and an as_of predating all recorded versions is a miss.\n" +
        "Sources are the currency registry (verified dates, supersession, milestones); they join regulation via " +
        "framework + document_id, never by URI reference.\n" +
        // Guidance, not enforcement: instructions are advisory and no string here can
        // compel a client model to leave a quote alone. The machine-checked half of
        // this promise is the verbatim invariant in src/validate.ts, which keeps
        // markup out of the records the client is asked to reproduce.
        "Presentation: reproduce record text — regulation, citations, commentary, expectations — verbatim as plain " +
        "text; never add HTML, markdown emphasis or markup the record does not contain, and keep notation exactly " +
        "as the source spells it (LGD in-default, not LGD with a subscript).",
    },
  );

  registerMetaTools(server);
  registerRegulationTools(server);
  registerTestTools(server);
  registerCheckTools(server);
  registerPlaybookTools(server);
  registerSourceTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}

export const server = createServer();

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Run if invoked directly (not when imported by examples or tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("prudent-mcp failed to start:", err);
    process.exit(1);
  });
}
