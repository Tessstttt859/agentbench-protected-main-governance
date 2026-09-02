import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { apply, plan, restore, verify, type RuntimeOptions } from "../src/runtime.js";
import { writeSnapshot } from "../src/snapshot.js";
import { contract, expectedRuleset, RecordingTransport } from "./helpers.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function options(directory: string, transport: RecordingTransport): RuntimeOptions {
  return {
    cwd: directory,
    contractPath: resolve("governance-contract.json"),
    snapshotPath: join(directory, "artifacts", "recovery-snapshot.json"),
    coordinates: { owner: "octo", repository: "repository" },
    transport
  };
}

function queueState(transport: RecordingTransport, rulesets = [expectedRuleset()]): void {
  transport.queue({ default_branch: "main" });
  transport.queue({ commit: { sha: SHA } });
  transport.queue(rulesets);
  transport.queue({ check_runs: [{ name: "CI / test" }, { name: "CI / package" }] });
}

describe("runtime commands", () => {
  it("plans deterministically with injected mocked GitHub state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-runtime-"));
    const transport = new RecordingTransport();
    queueState(transport, []);

    const result = await plan(options(directory, transport));

    expect(result.actions.map((action) => action.kind)).toEqual(["create"]);
    expect(await readFile(join(directory, "artifacts", "governance-plan.json"), "utf8")).toContain(
      SHA
    );
    expect(transport.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("verifies compliant state and rejects drift", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-runtime-"));
    const compliant = new RecordingTransport();
    queueState(compliant);
    await expect(verify(options(directory, compliant))).resolves.toBeUndefined();

    const drifted = new RecordingTransport();
    queueState(drifted, []);
    await expect(verify(options(directory, drifted))).rejects.toThrow(/differs from the contract/i);
  });

  it("applies, independently verifies, and writes the pre-change snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-runtime-"));
    const transport = new RecordingTransport();
    queueState(transport, []);
    transport.queue(expectedRuleset(77), 201);
    transport.queue(expectedRuleset(77));
    queueState(transport, [expectedRuleset(77)]);

    await apply(options(directory, transport));

    const snapshot = await readFile(join(directory, "artifacts", "recovery-snapshot.json"), "utf8");
    expect(snapshot).toContain('"managedRulesets": []');
    expect(transport.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("rejects an unexpected repository default branch before writing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-runtime-"));
    const transport = new RecordingTransport();
    transport.queue({ default_branch: "trunk" });
    transport.queue({ commit: { sha: SHA } });
    transport.queue([]);
    transport.queue({ check_runs: [] });
    await expect(apply(options(directory, transport))).rejects.toThrow(/default branch/i);
    expect(transport.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("restores only validated managed snapshot state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-runtime-"));
    const transport = new RecordingTransport();
    const runtimeOptions = options(directory, transport);
    await writeSnapshot(runtimeOptions.snapshotPath!, {
      schemaVersion: 1,
      repository: "octo/repository",
      defaultBranch: "main",
      managedNamePrefix: contract().managedNamePrefix,
      managedRulesets: [expectedRuleset(55)]
    });
    transport.queue([expectedRuleset(99)]);

    await restore(runtimeOptions);

    expect(transport.calls).toEqual([
      {
        method: "GET",
        path: "/repos/octo/repository/rulesets?includes_parents=false&per_page=100&page=1"
      }
    ]);
  });
});
