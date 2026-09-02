import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadContract, parseContract } from "../src/contract.js";
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

  it.each([
    [null, /contract must be an object/i],
    [{}, /unsupported contract version/i],
    [{ ...rawContract(), managedNamePrefix: "agentbench" }, /managedNamePrefix/i],
    [{ ...rawContract(), managedNamePrefix: "agent*bench/" }, /managedNamePrefix/i],
    [{ ...rawContract(), defaultBranch: "bad branch" }, /defaultBranch/i],
    [{ ...rawContract(), rulesets: [] }, /non-empty array/i]
  ])("rejects malformed top-level contract input", (value, message) => {
    expect(() => parseContract(value)).toThrow(message);
  });

  it("rejects malformed and unsupported ruleset fields", () => {
    const cases: Array<[string, (first: Record<string, unknown>) => void, RegExp]> = [
      ["non-object", () => undefined, /must be an object/i],
      ["unknown", (first) => (first.extra = true), /unknown key extra/i],
      ["rules", (first) => (first.rules = null), /rules must be an object/i],
      [
        "unsupported rule",
        (first) => ((first.rules as Record<string, unknown>).requireSignedCommits = true),
        /unknown key requireSignedCommits/i
      ],
      [
        "checks",
        (first) => ((first.rules as Record<string, unknown>).requireStatusChecks = "CI / test"),
        /array of strings/i
      ],
      [
        "duplicate checks",
        (first) =>
          ((first.rules as Record<string, unknown>).requireStatusChecks = [
            "CI / test",
            "CI / test"
          ]),
        /contains duplicates/i
      ],
      [
        "approvals",
        (first) => ((first.rules as Record<string, unknown>).requiredApprovals = 7),
        /integer from 0 to 6/i
      ],
      ["target", (first) => (first.target = "tag"), /target is unsupported/i],
      ["enforcement", (first) => (first.enforcement = "sometimes"), /enforcement is unsupported/i],
      ["branches", (first) => (first.branches = []), /non-empty array/i],
      ["selector", (first) => (first.branches = ["main"]), /malformed branch selector/i],
      [
        "duplicate selector",
        (first) => (first.branches = ["~DEFAULT_BRANCH", "~DEFAULT_BRANCH"]),
        /duplicate branch selector/i
      ],
      ["bypass", (first) => (first.bypassActors = {}), /bypassActors must be an array/i]
    ];
    for (const [name, mutate, message] of cases) {
      const value = rawContract();
      if (name === "non-object") {
        value.rulesets = [null];
      } else {
        mutate((value.rulesets as Array<Record<string, unknown>>)[0]!);
      }
      expect(() => parseContract(value), name).toThrow(message);
    }
  });

  it("validates every bypass actor field", () => {
    const cases: Array<[unknown, RegExp]> = [
      [null, /must be an object/i],
      [{ actorId: 1, actorType: "Team", bypassMode: "always", extra: true }, /unknown key extra/i],
      [{ actorId: 0, actorType: "Team", bypassMode: "always" }, /positive integer/i],
      [{ actorId: 1, actorType: "User", bypassMode: "always" }, /actorType is unsupported/i],
      [{ actorId: 1, actorType: "Team", bypassMode: "sometimes" }, /bypassMode is unsupported/i]
    ];
    for (const [actor, message] of cases) {
      const value = rawContract();
      (value.rulesets as Array<Record<string, unknown>>)[0]!.bypassActors = [actor];
      expect(() => parseContract(value)).toThrow(message);
    }
  });

  it("rejects invalid booleans and conflicting branch policies", () => {
    const value = rawContract();
    const first = (value.rulesets as Array<Record<string, unknown>>)[0]!;
    (first.rules as Record<string, unknown>).blockDeletions = "yes";
    expect(() => parseContract(value)).toThrow(/blockDeletions must be a boolean/i);

    const conflict = rawContract();
    const second = structuredClone((conflict.rulesets as unknown[])[0]) as Record<string, unknown>;
    second.name = "agentbench/second";
    (conflict.rulesets as unknown[]).push(second);
    expect(() => parseContract(conflict)).toThrow(/conflicting policies/i);
  });

  it("loads valid JSON and rejects malformed JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-contract-"));
    const valid = join(directory, "valid.json");
    const invalid = join(directory, "invalid.json");
    await writeFile(valid, JSON.stringify(rawContract()));
    await writeFile(invalid, "{");
    await expect(loadContract(valid)).resolves.toMatchObject({ version: 1 });
    await expect(loadContract(invalid)).rejects.toThrow(/not valid JSON/i);
  });
});
