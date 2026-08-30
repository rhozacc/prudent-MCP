---
layout: page
title: prudent-mcp
titleTemplate: The evidence ledger for IRB model validation
sidebar: false
aside: false
---

<div class="register">

<p class="eyebrow">Register of regulatory knowledge · MCP server</p>

<h1 class="masthead">prudent-mcp</h1>

<p class="standfirst">
A knowledge layer for IRB credit-risk model validation, served over MCP.
Regulation, statistical tests, supervisor checks, review playbooks, and a
currency registry of the documents behind them — <em>every claim typed,
anchored, and traceable back to law</em>. Read-only by construction: the
server describes; nothing executes, nothing mutates.
</p>

<div class="actions">
  <a class="primary" href="/prudent-mcp/guide/quickstart">Get started</a>
  <a class="quiet" href="/prudent-mcp/tools/">Tool register</a>
  <a class="quiet" href="https://github.com/rhozacc/prudent-mcp">Source · MIT</a>
</div>

<div class="statrow" aria-label="Corpus surface summary">
  <div class="cell"><div class="k">5</div><div class="v">Typed surfaces</div></div>
  <div class="cell"><div class="k">19</div><div class="v">Tools</div></div>
  <div class="cell"><div class="k">5</div><div class="v">URI schemes</div></div>
  <div class="cell"><div class="k">0</div><div class="v">Write tools</div></div>
</div>

<h2 class="rsec">One record, in evidence</h2>

<div class="readtwice">
<div>

<div class="statute">
  <div class="cite">regulation://crr/180/1/a — CRR Article 180(1)(a)</div>
  <div class="body">“Institutions shall estimate PDs by obligor grade from long-run averages of one-year default rates.”</div>
  <div class="provenance">
    <span class="stamp">Source · Verified · Current</span>
    <span><code>source://crr/575-2013</code></span>
  </div>
</div>

<ul class="docket" aria-label="Records that cite this article">
  <li>
    <span class="tab">chk</span>
    <a class="uri" href="/prudent-mcp/tools/checks">check://calibration/pd/lra-derived</a>
    <span class="leader"></span>
    <span class="edge-label">derives from it</span>
  </li>
  <li>
    <span class="tab">tst</span>
    <a class="uri" href="/prudent-mcp/tools/tests">test://binomial</a>
    <span class="leader"></span>
    <span class="edge-label">verifies it</span>
  </li>
  <li>
    <span class="tab">tst</span>
    <a class="uri" href="/prudent-mcp/tools/tests">test://hosmer-lemeshow</a>
    <span class="leader"></span>
    <span class="edge-label">verifies it</span>
  </li>
  <li>
    <span class="tab">pbk</span>
    <a class="uri" href="/prudent-mcp/tools/playbooks">playbook://calibration/pd</a>
    <span class="leader"></span>
    <span class="edge-label">walks a review through it</span>
  </li>
</ul>

</div>
<div>

<div class="exhibit">
  <div class="cap"><span>Exhibit — the same record, machine truth</span><span>json</span></div>
  <pre><span class="key">get_referrers</span>("regulation://crr/180/1/a")
→ {
  "checks":    ["check://calibration/pd/lra-derived"],
  "tests":     ["test://binomial",
                "test://hosmer-lemeshow",
                "test://jeffreys"],
  "playbooks": ["playbook://calibration/pd"],
  "regulation": ["regulation://crr/180"]
}</pre>
</div>

</div>
</div>

<h2 class="rsec">The five surfaces</h2>

| | Surface | URI scheme | What an entry asserts |
|---|---|---|---|
| <span class="tab doc-tab">reg</span> | **Regulation** | `regulation://{framework}/{article}…` | What the law says — versioned, `as_of`-queryable |
| <span class="tab doc-tab">tst</span> | **Tests** | `test://{test-id}` | What a statistical test measures and when to trust it — described, never executed |
| <span class="tab doc-tab">chk</span> | **Checks** | `check://{area}/{topic}…` | What a supervisor expects to see, traced to law via `derived_from` |
| <span class="tab doc-tab">pbk</span> | **Playbooks** | `playbook://{area}…` | How to walk a review area, phase by phase |
| <span class="tab doc-tab">src</span> | **Sources** | `source://{framework}/{doc-id}` | Whether the regulatory context is current — verification dates, supersession, milestones |

<h2 class="rsec">Enter into service</h2>

<div class="install">
  <div class="step">
    <div class="n">01 · Clone &amp; install</div>
    <code>git clone https://github.com/rhozacc/prudent-mcp && cd prudent-mcp && bun install</code>
  </div>
  <div class="step">
    <div class="n">02 · Inspect the demo corpus</div>
    <code>bun run inspect:demo</code>
  </div>
  <div class="step">
    <div class="n">03 · Wire your client</div>
    <code>claude mcp add prudent --env CORPUS_FILE=… -- bun run src/mcpb-entry.ts</code>
  </div>
</div>

<p class="foot">
The open-source server ships with empty adapters and a seeded in-memory demo —
the schemas, tools, and validation machinery are all here under MIT. A corpus is
what you bring: point <code>CORPUS_FILE</code> at your own, or build adapters
against any backend. Every corpus a server loads is linted on startup — broken
cross-references, supersession cycles, and stale sources refuse to serve.
See the <a href="/prudent-mcp/guide/">guide</a> for concepts, the
<a href="/prudent-mcp/corpus/">corpus reference</a> for the record shapes, and
<a href="/prudent-mcp/guide/clients">clients</a> for Claude Desktop, Claude Code,
and API wiring.
</p>

</div>
