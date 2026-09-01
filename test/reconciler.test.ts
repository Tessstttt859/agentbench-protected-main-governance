import { describe, expect, it } from "vitest";
import { GitHubClient } from "../src/github.js";
import { applyPlan, restoreSnapshot, type SnapshotStore } from "../src/reconciler.js";
import { contract, expectedRuleset, RecordingTransport } from "./helpers.js";
import type { GovernancePlan, RecoverySnapshot } from "../src/types.js";

function store(initial?: RecoverySnapshot): SnapshotStore & { saved: RecoverySnapshot[] } {
  const saved: RecoverySnapshot[] = [];
  return {
    saved,
    save: async (snapshot) => {
      saved.push(snapshot);
    },
    load: async () => {
      if (!initial) throw new Error("missing snapshot");
      return initial;
    }
  };
}

describe("managed policy reconciliation", () => {
  it("captures managed pre-change state before the first remote write", async () => {
    const transport = new RecordingTransport();
    transport.queue(expectedRuleset(73), 201);
    const client = new GitHubClient("octo", "repository", transport);
    const snapshots = store();
    const plan: GovernancePlan = {
      schemaVersion: 1,
      repository: "octo/repository",
      defaultBranch: "main",
      actions: [{ kind: "create", name: "agentbench/protected-main", desired: expectedRuleset(0) }],
      preservedUnmanagedRulesets: []
    };
    await applyPlan(client, contract(), plan, [], snapshots);
    expect(snapshots.saved).toHaveLength(1);
    expect(transport.calls).toHaveLength(1);
  });

  it("creates and verifies a replacement before deleting obsolete policy", async () => {
    const transport = new RecordingTransport();
    transport.queue(null, 204);
    transport.queue(expectedRuleset(88), 201);
    const client = new GitHubClient("octo", "repository", transport);
    const old = { ...expectedRuleset(18), name: "agentbench/legacy-main" };
    const plan: GovernancePlan = {
      schemaVersion: 1,
      repository: "octo/repository",
      defaultBranch: "main",
      actions: [
        { kind: "delete", name: old.name, rulesetId: old.id },
        { kind: "create", name: "agentbench/protected-main", desired: expectedRuleset(0) }
      ],
      preservedUnmanagedRulesets: []
    };
    await applyPlan(client, contract(), plan, [old], store());
    expect(transport.calls.map((call) => call.method)).toEqual(["POST", "GET", "DELETE"]);
  });

  it("performs no snapshot or remote write for an empty plan", async () => {
    const transport = new RecordingTransport();
    const client = new GitHubClient("octo", "repository", transport);
    const snapshots = store();
    const plan: GovernancePlan = {
      schemaVersion: 1,
      repository: "octo/repository",
      defaultBranch: "main",
      actions: [],
      preservedUnmanagedRulesets: []
    };
    await applyPlan(client, contract(), plan, [expectedRuleset()], snapshots);
    expect(transport.calls).toEqual([]);
    expect(snapshots.saved).toEqual([]);
  });
});

describe("restore", () => {
  it("preserves unmanaged rulesets", async () => {
    const transport = new RecordingTransport();
    transport.queue(null, 204);
    transport.queue(expectedRuleset(62), 201);
    const client = new GitHubClient("octo", "repository", transport);
    const managed = expectedRuleset(12);
    const unmanaged = { ...expectedRuleset(90), name: "manual/security-freeze" };
    const snapshot: RecoverySnapshot = {
      schemaVersion: 1,
      repository: "octo/repository",
      defaultBranch: "main",
      managedNamePrefix: "agentbench/",
      managedRulesets: [expectedRuleset(44)]
    };
    await restoreSnapshot(client, contract(), snapshot, [managed, unmanaged]);
    expect(transport.calls.some((call) => call.path.endsWith("/90"))).toBe(false);
  });

  it("rejects a snapshot captured for a different repository", async () => {
    const client = new GitHubClient("octo", "repository", new RecordingTransport());
    const snapshot: RecoverySnapshot = {
      schemaVersion: 1,
      repository: "someone/else",
      defaultBranch: "main",
      managedNamePrefix: "agentbench/",
      managedRulesets: []
    };
    await expect(restoreSnapshot(client, contract(), snapshot, [])).rejects.toThrow(
      /repository.*mismatch/i
    );
  });
});
