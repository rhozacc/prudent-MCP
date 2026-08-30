/**
 * Shared tool plumbing — result envelopes, annotations, and input leniency.
 *
 * Conventions enforced here (and documented in the server instructions):
 *   - every tool is read-only/idempotent/closed-world, declared via annotations;
 *   - successful structured results return BOTH structuredContent and a JSON
 *     text fallback (the spec requires text alongside structured content);
 *   - misses are isError results with a next-step pointer, never the string
 *     "null";
 *   - search tools share one envelope: { results, total_matches, offset,
 *     truncated } with a text hint when truncated.
 */
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// Every tool on this server reads a local knowledge base and nothing else.
export const READ_ONLY_HINTS: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

// --- Result builders --------------------------------------------------------

type TextBlock = { type: "text"; text: string };

const textBlock = (text: string): TextBlock => ({ type: "text", text });

/** Success with structured content plus the JSON text fallback. */
export function ok(structured: Record<string, unknown>): CallToolResult {
  return {
    content: [textBlock(JSON.stringify(structured, null, 2))],
    structuredContent: structured,
  };
}

/** Success as plain JSON text (tools without an output schema). */
export function okText(value: unknown): CallToolResult {
  return { content: [textBlock(JSON.stringify(value, null, 2))] };
}

/** Miss / bad input: an isError result carrying a next-step pointer. */
export function miss(message: string): CallToolResult {
  return { content: [textBlock(message)], isError: true };
}

// --- Search envelope ---------------------------------------------------------

export interface SearchEnvelope<T> {
  results: T[];
  total_matches: number;
  offset: number;
  truncated: boolean;
}

/** Page `all` (already ranked) into the shared search envelope. */
export function paginate<T>(all: T[], limit: number, offset: number): SearchEnvelope<T> {
  const results = all.slice(offset, offset + limit);
  return {
    results,
    total_matches: all.length,
    offset,
    truncated: offset + results.length < all.length,
  };
}

/** Envelope → CallToolResult, adding the truncation hint when applicable. */
export function searchResult<T>(envelope: SearchEnvelope<T>): CallToolResult {
  const content: TextBlock[] = [textBlock(JSON.stringify(envelope, null, 2))];
  if (envelope.truncated) {
    content.push(textBlock("Result set truncated — narrow the query or raise offset."));
  }
  return { content, structuredContent: envelope as unknown as Record<string, unknown> };
}

/** The shared input shape for the four search_* tools. */
export function searchInputShape(fieldsDoc: string) {
  return {
    query: z
      .string()
      .min(2)
      .describe(`Search phrase, at least 2 characters — ranked, field-scoped search over ${fieldsDoc}. Empty/one-char queries are rejected; enumeration is not search's job.`),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Page size (default 20, max 100)."),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Skip this many ranked matches — raise to page through results."),
    detail: z
      .enum(["concise", "full"])
      .default("concise")
      .describe("concise (default): per-surface projection; full: complete records."),
  };
}

/** The shared output shape for the four search_* tools. */
export function searchOutputShape(resultItem: z.ZodTypeAny) {
  return {
    results: z.array(resultItem).describe("One page of ranked matches, best first."),
    total_matches: z.number().int().describe("Matches the backend returned before paging."),
    offset: z.number().int(),
    truncated: z.boolean().describe("True when matches exist beyond this page."),
  };
}

// --- Input leniency ----------------------------------------------------------

// Models routinely wrap IDs in quotes/brackets or leave trailing punctuation.
// No valid corpus URI starts or ends with any of these characters, so
// stripping them at the edges is safe and cheap.
const EDGE_NOISE = /^[\s"'<>()[\]{}`.,;:]+|[\s"'<>()[\]{}`.,;:]+$/g;

/** Strip quote/bracket/punctuation noise from the edges of an id-ish string. */
export function stripEdgeNoise(value: string): string {
  return value.replace(EDGE_NOISE, "");
}

/**
 * Wrap an id (or slug) schema so surrounding whitespace/quotes/punctuation are
 * tolerated before validation. Serialized to clients as the inner schema
 * (zod-to-json-schema renders effects with the input strategy as the wrapped
 * schema for preprocess).
 */
export function lenient<T extends string>(schema: z.ZodType<T>): z.ZodType<T> {
  return z.preprocess(
    (v) => (typeof v === "string" ? stripEdgeNoise(v) : v),
    schema,
  ) as unknown as z.ZodType<T>;
}

// --- Projection helpers --------------------------------------------------------

/** First sentence of a prose field, capped at ~240 chars, for concise projections. */
export function firstSentence(text: string): string {
  const match = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  const sentence = (match !== null ? match[0] : text).trim();
  return sentence.length > 240 ? `${sentence.slice(0, 239)}…` : sentence;
}
