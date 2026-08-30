#!/usr/bin/env bun
/**
 * Bundles src/mcpb-entry.ts → dist/mcpb/server/index.mjs, copies the
 * manifest and icon, then invokes @anthropic-ai/mcpb pack.
 *
 *   bun run build:mcpb
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const OUT_DIR = "dist/mcpb";
const SERVER_DIR = join(OUT_DIR, "server");

mkdirSync(SERVER_DIR, { recursive: true });

console.log("Bundling server…");
await build({
  entryPoints: ["src/mcpb-entry.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(SERVER_DIR, "index.mjs"),
  target: "node18",
  // zod and @modelcontextprotocol/sdk are pure-JS — bundle them in.
  // node:* built-ins are automatically externalized by esbuild.
  //
  // Bundling statically links two MIT dependencies into this file, and MIT
  // requires their notices to travel with the copy. Neither ships a legal banner
  // comment today, so this preserves nothing right now — THIRD-PARTY-NOTICES.md
  // below is what actually discharges the obligation. Set anyway, so a future
  // dependency that does carry one keeps it instead of having it stripped.
  legalComments: "eof",
});

copyFileSync("manifest.json", join(OUT_DIR, "manifest.json"));
copyFileSync("prudent-logo.png", join(OUT_DIR, "icon.png"));
// The bundle is a redistribution, so it carries its own licence terms and the
// notices for what is linked into it.
copyFileSync("LICENSE", join(OUT_DIR, "LICENSE"));
copyFileSync("THIRD-PARTY-NOTICES.md", join(OUT_DIR, "THIRD-PARTY-NOTICES.md"));

console.log("Packing .mcpb…");
execSync("npx --yes @anthropic-ai/mcpb pack dist/mcpb", { stdio: "inherit" });

console.log("Done. Install by dragging the .mcpb file onto Claude Desktop.");
