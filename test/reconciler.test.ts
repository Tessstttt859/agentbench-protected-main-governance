import { describe, expect, it } from "vitest";
import { GitHubClient } from "../src/github.js";
import { PolicyError } from "../src/errors.js";
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
    transport.queue(expectedRuleset(73));
    const client = new GitHubClient("octo", "repository", transport);
    const snapshots = store();
    const plan: GovernancePlan = {
      schemaVersion: 1,
      repository: "octo/repository",
      defaultBranch: "main",
      defaultBranchSha: "0123456789abcdef0123456789abcdef01234567",
      observedWorkflowChecks: ["CI / package", "CI / test"],
      missingWorkflowChecks: [],
      actions: [{ kind: "create", name: "agentbench/protected-main", desired: expectedRuleset(0) }],
      preservedUnmanagedRulesets: []
    };
    await applyPlan(client, contract(), plan, [], snapshots);
    expect(snapshots.saved).toHaveLength(1);
    expect(transport.calls.map((call) => call.method)).toEqual(["POST", "GET"]);
  });

  it("creates and verifies a replacement before deleting obsolete policy", async () => {
    const transport = new RecordingTransport();
    transport.queue(expectedRuleset(88), 201);
    transport.queue(expectedRuleset(88));
    transport.queue(null, 204);
    const client = new GitHubClient("octo", "repository", transport);
    const old = { ...expectedRuleset(18), name: "agentbench/legacy-main" };
    const plan: GovernancePlan = {
      schemaVersion: 1,
      repository: "octo/repository",
      defaultBranch: "main",
      defaultBranchSha: "0123456789abcdef0123456789abcdef01234567",
      observedWorkflowChecks: ["CI / package", "CI / test"],
      missingWorkflowChecks: [],
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
      defaultBranchSha: "0123456789abcdef0123456789abcdef01234567",
      observedWorkflowChecks: ["CI / package", "CI / test"],
      missingWorkflowChecks: [],
      actions: [],
      preservedUnmanagedRulesets: []
    };
    await applyPlan(client, contract(), plan, [expectedRuleset()], snapshots);
    expect(transport.calls).toEqual([]);
    expect(snapshots.saved).toEqual([]);
  });

  it("rejects missing workflow checks before capturing or writing", async () => {
    const snapshots = store();
    const plan: GovernancePlan = {
      schemaVersion: 1,
      repository: "octo/repository",
      defaultBranch: "main",
      defaultBranchSha: "0123456789abcdef0123456789abcdef01234567",
      observedWorkflowChecks: [],
      missingWorkflowChecks: ["CI / test"],
      actions: [{ kind: "create", name: "agentbench/protected-main", desired: expectedRuleset(0) }],
      preservedUnmanagedRulesets: []
    };
    await expect(
      applyPlan(
        new GitHubClient("octo", "repository", new RecordingTransport()),
        contract(),
        plan,
        [],
        snapshots
      )
    ).rejects.toThrow(/not observed/i);
    expect(snapshots.saved).toEqual([]);
  });

  it("removes an unverified replacement and preserves the prior managed policy", async () => {
    const transport = new RecordingTransport();
    transport.queue(expectedRuleset(77), 201);
    transport.queue({ ...expectedRuleset(77), enforcement: "disabled" });
    transport.queue(null, 204);
    const old = { ...expectedRuleset(18), name: "agentbench/legacy-main" };
    const plan: GovernancePlan = {
      schemaVersion: 1,
      repository: "octo/repository",
      defaultBranch: "main",
      defaultBranchSha: "0123456789abcdef0123456789abcdef01234567",
      observedWorkflowChecks: ["CI / package", "CI / test"],
      missingWorkflowChecks: [],
      actions: [
        { kind: "create", name: "agentbench/protected-main", desired: expectedRuleset(0) },
        { kind: "delete", name: old.name, rulesetId: old.id }
      ],
      preservedUnmanagedRulesets: []
    };
    await expect(
      applyPlan(new GitHubClient("octo", "repository", transport), contract(), plan, [old], store())
    ).rejects.toThrow(/independently verified/i);
    expect(transport.calls.map((call) => call.method)).toEqual(["POST", "GET", "DELETE"]);
    expect(transport.calls.some((call) => call.path.endsWith("/18"))).toBe(false);
  });

  it("refuses deletion when no verified contract replacement exists", async () => {
    const old = { ...expectedRuleset(18), name: "agentbench/legacy-main" };
    const plan: GovernancePlan = {
      schemaVersion: 1,
      repository: "octo/repository",
      defaultBranch: "main",
      defaultBranchSha: "0123456789abcdef0123456789abcdef01234567",
      observedWorkflowChecks: ["CI / package", "CI / test"],
      missingWorkflowChecks: [],
      actions: [{ kind: "delete", name: old.name, rulesetId: old.id }],
      preservedUnmanagedRulesets: []
    };
    await expect(
      applyPlan(
        new GitHubClient("octo", "repository", new RecordingTransport()),
        contract(),
        plan,
        [old],
        store()
      )
    ).rejects.toThrow(/without a verified replacement/i);
  });

  it("reuses only a matching existing recovery snapshot", async () => {
    const transport = new RecordingTransport();
    transport.queue(expectedRuleset(70), 201);
    transport.queue(expectedRuleset(70));
    const plan: GovernancePlan = {
      schemaVersion: 1,
      repository: "octo/repository",
      defaultBranch: "main",
      defaultBranchSha: "0123456789abcdef0123456789abcdef01234567",
      observedWorkflowChecks: ["CI / package", "CI / test"],
      missingWorkflowChecks: [],
      actions: [{ kind: "create", name: "agentbench/protected-main", desired: expectedRuleset(0) }],
      preservedUnmanagedRulesets: []
    };
    const existing: RecoverySnapshot = {
      schemaVersion: 1,
      repository: "octo/repository",
      defaultBranch: "main",
      managedNamePrefix: "agentbench/",
      managedRulesets: []
    };
    const snapshotStore: SnapshotStore = {
      save: async () => {
        throw new PolicyError("exists", "SNAPSHOT_EXISTS");
      },
      load: async () => existing
    };
    await expect(
      applyPlan(
        new GitHubClient("octo", "repository", transport),
        contract(),
        plan,
        [],
        snapshotStore
      )
    ).resolves.toBeUndefined();

    existing.repository = "someone/else";
    await expect(
      applyPlan(
        new GitHubClient("octo", "repository", new RecordingTransport()),
        contract(),
        plan,
        [],
        snapshotStore
      )
    ).rejects.toThrow(/does not match/i);
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

  it("restores a changed managed ruleset before removing an obsolete one", async () => {
    const transport = new RecordingTransport();
    const disabled = { ...expectedRuleset(12), enforcement: "disabled" as const };
    const obsolete = { ...expectedRuleset(13), name: "agentbench/obsolete" };
    const unmanaged = { ...expectedRuleset(90), name: "manual/security-freeze" };
    transport.queue(expectedRuleset(12));
    transport.queue(expectedRuleset(12));
    transport.queue(null, 204);
    const snapshot: RecoverySnapshot = {
      schemaVersion: 1,
      repository: "octo/repository",
      defaultBranch: "main",
      managedNamePrefix: "agentbench/",
      managedRulesets: [expectedRuleset(44)]
    };
    await restoreSnapshot(new GitHubClient("octo", "repository", transport), contract(), snapshot, [
      disabled,
      obsolete,
      unmanaged
    ]);
    expect(transport.calls.map((call) => call.method)).toEqual(["PUT", "GET", "DELETE"]);
    expect(transport.calls.some((call) => call.path.endsWith("/90"))).toBe(false);
  });

  it("rolls back a partially verified restore update", async () => {
    const transport = new RecordingTransport();
    const disabled = { ...expectedRuleset(12), enforcement: "disabled" as const };
    transport.queue(expectedRuleset(12));
    transport.queue({ ...expectedRuleset(12), enforcement: "disabled" });
    transport.queue(disabled);
    const snapshot: RecoverySnapshot = {
      schemaVersion: 1,
      repository: "octo/repository",
      defaultBranch: "main",
      managedNamePrefix: "agentbench/",
      managedRulesets: [expectedRuleset(44)]
    };
    await expect(
      restoreSnapshot(new GitHubClient("octo", "repository", transport), contract(), snapshot, [
        disabled
      ])
    ).rejects.toThrow(/independently verified/i);
    expect(transport.calls.map((call) => call.method)).toEqual(["PUT", "GET", "PUT"]);
  });

  it("creates missing snapshot state before deleting obsolete managed state", async () => {
    const transport = new RecordingTransport();
    const obsolete = { ...expectedRuleset(13), name: "agentbench/obsolete" };
    transport.queue(expectedRuleset(44), 201);
    transport.queue(expectedRuleset(44));
    transport.queue(null, 204);
    const snapshot: RecoverySnapshot = {
      schemaVersion: 1,
      repository: "octo/repository",
      defaultBranch: "main",
      managedNamePrefix: "agentbench/",
      managedRulesets: [expectedRuleset(44)]
    };
    await restoreSnapshot(new GitHubClient("octo", "repository", transport), contract(), snapshot, [
      obsolete
    ]);
    expect(transport.calls.map((call) => call.method)).toEqual(["POST", "GET", "DELETE"]);
  });
});
