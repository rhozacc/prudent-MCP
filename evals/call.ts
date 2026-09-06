/**
 * One-shot tool call against the real server — the substrate for simulating a
 * consuming model.
 *
 * A simulation is only worth anything if the simulated model sees exactly what
 * a real one would: the same body, the same errors, and the same cost. So this
 * prints the raw content and, on stderr, the accounting — which keeps the
 * "context" the simulated model reads uncontaminated by the measurement.
 *
 *   bun evals/call.ts <tool> '<json args>'
 *   bun evals/call.ts tools                    # list the published surface
 *
 * Honours CORPUS_FILE.
 */
import { openSession } from "./harness.ts";

async function main(): Promise<void> {
  const [tool, rawArgs] = process.argv.slice(2);
  if (tool === undefined) {
    console.error("usage: bun evals/call.ts <tool|tools> '<json args>'");
    process.exit(2);
  }

  const corpusFile = process.env["CORPUS_FILE"];
  const session = await openSession(corpusFile === undefined ? {} : { corpusFile });

  if (tool === "tools") {
    for (const t of session.tools) console.log(`${t.name}\n    ${t.description}\n`);
    console.error(`[surface ~${session.surfaceTokens} tokens across ${session.tools.length} tools]`);
    await session.close();
    return;
  }

  let args: Record<string, unknown> = {};
  if (rawArgs !== undefined && rawArgs.trim() !== "") {
    try {
      args = JSON.parse(rawArgs) as Record<string, unknown>;
    } catch (e) {
      console.error(`bad JSON args: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(2);
    }
  }

  const t = await session.call(tool, args);
  await session.close();

  console.log(t.text);
  console.error(
    `[${t.isError ? "ERROR " : ""}${t.tokens} tokens · ${t.chars} chars · ${t.ms}ms · json=${t.json !== null}]`,
  );
  process.exit(t.isError ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
