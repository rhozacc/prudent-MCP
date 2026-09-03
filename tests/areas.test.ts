import { describe, expect, it } from "bun:test";

import {
  areaKey,
  areaSlug,
  deriveTaxonomy,
  playbookAreaKey,
  playbookInArea,
  resolveArea,
} from "../src/areas.ts";
import type { Playbook, ReviewArea } from "../src/schema.ts";

// ── src/areas.ts — the ONE review-area key definition ────────────────────────
//
// What this exists to prevent, stated once: `get_area_overview` used to filter
// `p.area === area`, comparing a slug against the free-form prose extraction
// puts on a playbook ("PD Estimation", "Credit Risk"). On the shipped corpus
// `taxonomy` was also `[]`, so list_review_areas answered with nothing and the
// documented entry path — corpus_info → list_review_areas → get_area_overview —
// had no reachable second step.
//
// The reason it survived: the smoke test did not call the tool, it
// reimplemented the filter beside it, against a demo whose areas are ALREADY
// slugs ("calibration" + "pd" === "calibration.pd"). Two copies of one rule
// agreeing on a fixture chosen to fit them. So every test below that matters
// uses PROSE areas, the way real extracted playbooks do.

const pb = (id: string, area: string, subarea?: string): Playbook => ({
  id: id as Playbook["id"],
  area,
  ...(subarea !== undefined ? { subarea } : {}),
  phases: [],
  gates: [],
  regulatory_scope: [],
  last_updated: "2026-01-01",
});

describe("areaSlug", () => {
  it("lowercases and collapses every run of non-alphanumerics to one hyphen", () => {
    expect(areaSlug("PD Estimation")).toBe("pd-estimation");
    expect(areaSlug("Market Risk (CRR2)")).toBe("market-risk-crr2");
    expect(areaSlug("IRB Approach Governance, Validation and Lifecycle Management")).toBe(
      "irb-approach-governance-validation-and-lifecycle-management",
    );
  });

  it("trims hyphens off both ends rather than leaving them in an id", () => {
    expect(areaSlug("  (Overarching) Principles!  ")).toBe("overarching-principles");
    expect(areaSlug("---")).toBe("");
  });

  it("leaves an already-slugged label alone, so slugging twice is safe", () => {
    expect(areaSlug("pd-estimation")).toBe("pd-estimation");
    expect(areaSlug(areaSlug("PD Estimation"))).toBe("pd-estimation");
  });
});

describe("areaKey", () => {
  it("is the slugged area, dotted with the slugged subarea when there is one", () => {
    expect(areaKey("PD Estimation")).toBe("pd-estimation");
    expect(areaKey("LGD Estimation", "Downturn LGD Calibration")).toBe(
      "lgd-estimation.downturn-lgd-calibration",
    );
  });

  it("treats a blank subarea as no subarea, not as a trailing dot", () => {
    expect(areaKey("PD Estimation", "")).toBe("pd-estimation");
    expect(areaKey("PD Estimation", "   ")).toBe("pd-estimation");
  });

  it("agrees with playbookAreaKey, which is the only caller that matters", () => {
    expect(playbookAreaKey(pb("playbook://a/b", "LGD Estimation", "Downturn LGD Calibration"))).toBe(
      areaKey("LGD Estimation", "Downturn LGD Calibration"),
    );
  });
});

describe("deriveTaxonomy", () => {
  const playbooks = [
    pb("playbook://gl/5-pd", "PD Estimation"),
    pb("playbook://gl/6-lgd", "LGD Estimation"),
    pb("playbook://gl/7-lgd-defaulted", "LGD Estimation", "EL BE and LGD In-Default"),
    pb("playbook://egim/1-credit-risk", "Credit Risk", "IRB Approach Governance"),
  ];

  it("emits one node per distinct area and subarea", () => {
    expect(deriveTaxonomy(playbooks).map((a) => a.id)).toEqual([
      "pd-estimation",
      "lgd-estimation",
      "lgd-estimation.el-be-and-lgd-in-default",
      "credit-risk",
      "credit-risk.irb-approach-governance",
    ]);
  });

  it("keeps the prose as the node's name — the slug is an address, not a label", () => {
    const byId = new Map(deriveTaxonomy(playbooks).map((a) => [a.id, a]));
    expect(byId.get("pd-estimation")!.name).toBe("PD Estimation");
    expect(byId.get("credit-risk.irb-approach-governance")!.name).toBe("IRB Approach Governance");
  });

  it("wires parent and children both ways", () => {
    const byId = new Map(deriveTaxonomy(playbooks).map((a) => [a.id, a]));
    expect(byId.get("lgd-estimation")!.children).toEqual(["lgd-estimation.el-be-and-lgd-in-default"]);
    expect(byId.get("lgd-estimation.el-be-and-lgd-in-default")!.parent).toBe("lgd-estimation");
    // A childless area carries [] rather than undefined.
    expect(byId.get("pd-estimation")!.children).toEqual([]);
    expect(byId.get("pd-estimation")!.parent).toBeUndefined();
  });

  it("emits the top-level node even when every playbook under it has a subarea", () => {
    // Otherwise `parent` points at an id the caller was never told about.
    const only = [pb("playbook://egim/1", "Credit Risk", "IRB Approach Governance")];
    const t = deriveTaxonomy(only);
    expect(t.map((a) => a.id)).toEqual(["credit-risk", "credit-risk.irb-approach-governance"]);
    expect(t[0]!.children).toEqual(["credit-risk.irb-approach-governance"]);
  });

  it("does not duplicate a node when several playbooks share an area", () => {
    const dupes = [pb("playbook://a", "Definition of Default"), pb("playbook://b", "Definition of Default")];
    expect(deriveTaxonomy(dupes).map((a) => a.id)).toEqual(["definition-of-default"]);
  });

  it("is stable in first-seen order, so two reads agree", () => {
    expect(deriveTaxonomy(playbooks)).toEqual(deriveTaxonomy(playbooks));
  });

  it("returns [] for no playbooks rather than throwing", () => {
    expect(deriveTaxonomy([])).toEqual([]);
  });
});

describe("resolveArea", () => {
  const areas: ReviewArea[] = deriveTaxonomy([
    pb("playbook://gl/5-pd", "PD Estimation"),
    pb("playbook://egim/1", "Credit Risk", "IRB Approach Governance"),
  ]);

  it("takes the canonical id", () => {
    expect(resolveArea(areas, "pd-estimation")?.id).toBe("pd-estimation");
    expect(resolveArea(areas, "credit-risk.irb-approach-governance")?.id).toBe(
      "credit-risk.irb-approach-governance",
    );
  });

  it("takes the prose a model just read off a playbook record", () => {
    // The dead end being removed: being told "unknown review area 'PD
    // Estimation'" after reading exactly that string off a playbook is what
    // sends a model back to full-text search.
    expect(resolveArea(areas, "PD Estimation")?.id).toBe("pd-estimation");
    expect(resolveArea(areas, "IRB Approach Governance")?.id).toBe(
      "credit-risk.irb-approach-governance",
    );
  });

  it("takes a dotted prose path, slugging each segment", () => {
    expect(resolveArea(areas, "Credit Risk.IRB Approach Governance")?.id).toBe(
      "credit-risk.irb-approach-governance",
    );
  });

  it("ignores surrounding whitespace and case", () => {
    expect(resolveArea(areas, "  pd estimation  ")?.id).toBe("pd-estimation");
    expect(resolveArea(areas, "PD-ESTIMATION")?.id).toBe("pd-estimation");
  });

  it("still misses loudly on something that is not an area", () => {
    expect(resolveArea(areas, "nonexistent.area")).toBeUndefined();
    expect(resolveArea(areas, "")).toBeUndefined();
    expect(resolveArea(areas, "   ")).toBeUndefined();
  });

  it("prefers an exact id over a name that would slug to a different node", () => {
    const shadowed: ReviewArea[] = [
      { id: "pd-estimation", name: "Something Else", children: [] },
      { id: "other", name: "PD Estimation", children: [] },
    ];
    expect(resolveArea(shadowed, "pd-estimation")?.id).toBe("pd-estimation");
  });
});

describe("playbookInArea", () => {
  const playbooks = [
    pb("playbook://egim/1", "Credit Risk", "IRB Approach Governance"),
    pb("playbook://egim/2", "Credit Risk"),
    pb("playbook://gl/5-pd", "PD Estimation"),
  ];
  const areas = deriveTaxonomy(playbooks);
  const node = (id: string): ReviewArea => areas.find((a) => a.id === id)!;

  it("matches a playbook sitting on the node itself", () => {
    expect(playbookInArea(playbooks[2]!, node("pd-estimation"))).toBe(true);
  });

  it("rolls a top-level area up over its subareas", () => {
    // Asking for "credit-risk" should not return only the subarea-less one.
    const inCreditRisk = playbooks.filter((p) => playbookInArea(p, node("credit-risk")));
    expect(inCreditRisk.map((p) => p.id)).toEqual(["playbook://egim/1", "playbook://egim/2"]);
  });

  it("does not roll a subarea up into its siblings or its parent's peers", () => {
    const inSub = playbooks.filter((p) =>
      playbookInArea(p, node("credit-risk.irb-approach-governance")),
    );
    expect(inSub.map((p) => p.id)).toEqual(["playbook://egim/1"]);
    expect(playbookInArea(playbooks[2]!, node("credit-risk"))).toBe(false);
  });

  it("does not match on a shared id prefix that is not a path boundary", () => {
    // "credit-risk" must not swallow "credit-risk-parameter-estimation".
    const other = pb("playbook://egim/3", "Credit Risk Parameter Estimation (PD and LGD)");
    expect(playbookInArea(other, node("credit-risk"))).toBe(false);
  });
});

describe("the real corpus shape, end to end", () => {
  // Areas exactly as the extraction wrote them, prose and punctuation intact.
  const real = [
    pb("playbook://gl-2017-16/5-pd-estimation", "PD Estimation"),
    pb("playbook://gl-2019-03/3-lgd-estimation", "LGD Estimation", "Downturn LGD Calibration"),
    pb("playbook://egim/1-credit-risk", "Credit Risk", "IRB Approach Governance, Validation and Lifecycle Management"),
    pb("playbook://egim/4-market-risk-crr2", "Market Risk (CRR2)"),
  ];

  it("derives a taxonomy whose every id resolves and selects its own playbook", () => {
    const areas = deriveTaxonomy(real);
    expect(areas.length).toBeGreaterThan(0);
    for (const node of areas) {
      // Every advertised id resolves...
      expect(resolveArea(areas, node.id)?.id).toBe(node.id);
      // ...and selects at least one playbook. An area nothing can be reached
      // from is the failure this whole module exists to make impossible.
      expect(real.some((p) => playbookInArea(p, node))).toBe(true);
    }
  });

  it("resolves each playbook's own prose area back to the node holding it", () => {
    const areas = deriveTaxonomy(real);
    for (const p of real) {
      const viaProse = resolveArea(areas, p.subarea ?? p.area);
      expect(viaProse).toBeDefined();
      expect(playbookInArea(p, viaProse!)).toBe(true);
    }
  });
});
