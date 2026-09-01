import { describe, expect, it } from "vitest";
import { parseContract } from "../src/contract.js";
import { contract } from "./helpers.js";

function rawContract(): Record<string, unknown> {
  return structuredClone(contract()) as unknown as Record<string, unknown>;
}

describe("contract validation", () => {
  it("accepts the tracked contract", () => {
    expect(parseContract(rawContract()).version).toBe(1);
  });

  it("rejects unsupported versions", () => {
    const value = rawContract();
    value.version = 2;
    expect(() => parseContract(value)).toThrow(/unsupported contract version/);
  });

  it("rejects unknown top-level keys", () => {
    const value = rawContract();
    value.untrackedBehavior = true;
    expect(() => parseContract(value)).toThrow(/unknown.*untrackedBehavior/i);
  });

  it("rejects duplicate managed ruleset names", () => {
    const value = rawContract();
    const rulesets = value.rulesets as unknown[];
    rulesets.push(structuredClone(rulesets[0]));
    expect(() => parseContract(value)).toThrow(/duplicate.*agentbench\/protected-main/i);
  });

  it("rejects empty status-check names", () => {
    const value = rawContract();
    const first = (value.rulesets as Array<Record<string, unknown>>)[0]!;
    const rules = first.rules as Record<string, unknown>;
    rules.requireStatusChecks = ["CI / test", "   "];
    expect(() => parseContract(value)).toThrow(/status.*non-empty/i);
  });

  it("rejects unsafe wildcard branch targets", () => {
    const value = rawContract();
    const first = (value.rulesets as Array<Record<string, unknown>>)[0]!;
    first.branches = ["refs/heads/**"];
    expect(() => parseContract(value)).toThrow(/unsafe.*wildcard/i);
  });

  it("rejects unsupported merge methods", () => {
    const value = rawContract();
    value.mergeMethod = "force";
    expect(() => parseContract(value)).toThrow(/mergeMethod/i);
  });

  it("rejects rulesets outside the managed prefix", () => {
    const value = rawContract();
    (value.rulesets as Array<Record<string, unknown>>)[0]!.name = "manual/main";
    expect(() => parseContract(value)).toThrow(/outside the managed prefix/);
  });
});
