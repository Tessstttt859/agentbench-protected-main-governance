import { describe, expect, it } from "vitest";
import { buildPlan } from "../src/planner.js";
import { stableJson } from "../src/stable-json.js";
import { contract, expectedRuleset, state } from "./helpers.js";

describe("governance planning", () => {
  it("reports no change when managed state matches", () => {
    const plan = buildPlan(contract(), state([expectedRuleset()]));
    expect(plan.actions).toEqual([]);
  });

  it("is byte-deterministic for unchanged remote state", () => {
    const first = stableJson(buildPlan(contract(), state([])));
    const second = stableJson(buildPlan(contract(), state([])));
    expect(first).toBe(second);
    expect(first).not.toContain("generatedAt");
  });

  it("plans replacement before obsolete managed deletion", () => {
    const old = { ...expectedRuleset(18), name: "agentbench/legacy-main" };
    const plan = buildPlan(contract(), state([old]));
    expect(plan.actions.map((action) => `${action.kind}:${action.name}`)).toEqual([
      "create:agentbench/protected-main",
      "delete:agentbench/legacy-main"
    ]);
  });

  it("preserves and reports unmanaged rulesets", () => {
    const unmanaged = { ...expectedRuleset(91), name: "manual/security-freeze" };
    const plan = buildPlan(contract(), state([unmanaged]));
    expect(plan.preservedUnmanagedRulesets).toEqual(["manual/security-freeze"]);
    expect(plan.actions.every((action) => action.name !== unmanaged.name)).toBe(true);
  });

  it("uses the actual default branch rather than assuming main", () => {
    const remoteState = { ...state([]), defaultBranch: "trunk" };
    const plan = buildPlan(contract(), remoteState);
    const create = plan.actions.find((action) => action.kind === "create");
    expect(create?.desired.conditions.ref_name.include).toEqual(["refs/heads/trunk"]);
  });
});
