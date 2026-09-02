import { PolicyError } from "./errors.js";
import type { GitHubClient } from "./github.js";
import { desiredRuleset } from "./normalize.js";
import { rulesetsEqual } from "./planner.js";
import { validateRecoverySnapshot } from "./snapshot.js";
import type {
  GitHubRuleset,
  GovernanceContract,
  GovernancePlan,
  RecoverySnapshot
} from "./types.js";

export interface SnapshotStore {
  save(snapshot: RecoverySnapshot): Promise<void>;
  load(): Promise<RecoverySnapshot>;
}

function snapshotRuleset(ruleset: GitHubRuleset): GitHubRuleset {
  return {
    id: ruleset.id,
    name: ruleset.name,
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    conditions: structuredClone(ruleset.conditions),
    rules: ruleset.rules.map((rule) => ({
      type: rule.type,
      ...(rule.parameters === undefined ? {} : { parameters: structuredClone(rule.parameters) })
    })),
    bypass_actors: ruleset.bypass_actors.map((actor) => ({
      ...("actor_id" in actor ? { actor_id: actor.actor_id } : {}),
      ...("actor_type" in actor ? { actor_type: actor.actor_type } : {}),
      ...("bypass_mode" in actor ? { bypass_mode: actor.bypass_mode } : {})
    }))
  };
}

function assertVerified(actual: GitHubRuleset, desired: GitHubRuleset, operation: string): void {
  if (!rulesetsEqual(actual, desired)) {
    throw new PolicyError(
      `${operation} did not produce the independently verified managed policy`,
      "REPLACEMENT_VERIFICATION_FAILED"
    );
  }
}

async function saveRecoverySnapshot(
  store: SnapshotStore,
  snapshot: RecoverySnapshot
): Promise<void> {
  try {
    await store.save(snapshot);
  } catch (error) {
    if (!(error instanceof PolicyError) || error.code !== "SNAPSHOT_EXISTS") throw error;
    const existing = validateRecoverySnapshot(await store.load());
    if (
      existing.repository !== snapshot.repository ||
      existing.managedNamePrefix !== snapshot.managedNamePrefix
    ) {
      throw new PolicyError(
        "existing recovery snapshot does not match this repository and contract",
        "SNAPSHOT_MISMATCH"
      );
    }
  }
}

async function executeVerifiedWrite(
  client: GitHubClient,
  action: Extract<GovernancePlan["actions"][number], { kind: "create" | "update" }>,
  before: GitHubRuleset[]
): Promise<void> {
  let written: GitHubRuleset | undefined;
  try {
    written =
      action.kind === "create"
        ? await client.createRuleset(action.desired)
        : await client.updateRuleset(action.rulesetId, action.desired);
    const actual = await client.getRuleset(written.id);
    assertVerified(actual, action.desired, `${action.kind} ${action.name}`);
  } catch (error) {
    if (action.kind === "update") {
      const previous = before.find((ruleset) => ruleset.id === action.rulesetId);
      if (previous) {
        await client.updateRuleset(previous.id, previous).catch(() => undefined);
      }
    } else if (written) {
      await client.deleteRuleset(written.id).catch(() => undefined);
    }
    throw error;
  }
}

export async function applyPlan(
  client: GitHubClient,
  contract: GovernanceContract,
  plan: GovernancePlan,
  before: GitHubRuleset[],
  snapshots: SnapshotStore
): Promise<void> {
  if (plan.missingWorkflowChecks.length > 0) {
    throw new PolicyError(
      `required workflow checks were not observed: ${plan.missingWorkflowChecks.join(", ")}`,
      "MISSING_REQUIRED_CHECKS"
    );
  }
  if (plan.actions.length === 0) return;

  const managedBefore = before
    .filter((ruleset) => ruleset.name.startsWith(contract.managedNamePrefix))
    .map(snapshotRuleset);
  await saveRecoverySnapshot(snapshots, {
    schemaVersion: 1,
    repository: plan.repository,
    defaultBranch: plan.defaultBranch,
    managedNamePrefix: contract.managedNamePrefix,
    managedRulesets: managedBefore
  });

  const writes = plan.actions.filter(
    (action): action is Extract<typeof action, { kind: "create" | "update" }> =>
      action.kind !== "delete"
  );
  for (const action of writes) await executeVerifiedWrite(client, action, before);

  for (const expected of contract.rulesets) {
    const desired = desiredRuleset(expected, plan.defaultBranch, contract.mergeMethod);
    const written = writes.find((action) => action.name === expected.name);
    if (written) continue;
    const existing = before.find(
      (ruleset) => ruleset.name === expected.name && rulesetsEqual(ruleset, desired)
    );
    if (!existing) {
      throw new PolicyError(
        `refusing managed deletion without a verified replacement for ${expected.name}`,
        "NO_VERIFIED_REPLACEMENT"
      );
    }
  }

  for (const action of plan.actions) {
    if (action.kind === "delete") await client.deleteRuleset(action.rulesetId);
  }
}

export async function restoreSnapshot(
  client: GitHubClient,
  contract: GovernanceContract,
  snapshotValue: RecoverySnapshot,
  current: GitHubRuleset[]
): Promise<void> {
  const snapshot = validateRecoverySnapshot(snapshotValue);
  if (snapshot.repository !== client.fullName) {
    throw new PolicyError("snapshot repository mismatch", "SNAPSHOT_MISMATCH");
  }
  if (snapshot.managedNamePrefix !== contract.managedNamePrefix) {
    throw new PolicyError(
      "snapshot managed prefix does not match the contract",
      "SNAPSHOT_MISMATCH"
    );
  }
  if (
    snapshot.managedRulesets.some((ruleset) => !ruleset.name.startsWith(contract.managedNamePrefix))
  ) {
    throw new PolicyError("snapshot contains an unmanaged ruleset", "SNAPSHOT_INVALID");
  }

  const managedCurrent = current.filter((ruleset) =>
    ruleset.name.startsWith(contract.managedNamePrefix)
  );
  for (const desired of snapshot.managedRulesets) {
    const existing = managedCurrent.find((ruleset) => ruleset.name === desired.name);
    if (existing && rulesetsEqual(existing, desired)) {
      continue;
    }
    await executeVerifiedWrite(
      client,
      existing
        ? { kind: "update", name: desired.name, rulesetId: existing.id, desired }
        : { kind: "create", name: desired.name, desired },
      managedCurrent
    );
  }

  for (const ruleset of managedCurrent) {
    const desired = snapshot.managedRulesets.find((item) => item.name === ruleset.name);
    if (!desired) {
      await client.deleteRuleset(ruleset.id);
      continue;
    }
    if (ruleset.id !== managedCurrent.find((item) => item.name === ruleset.name)?.id) {
      await client.deleteRuleset(ruleset.id);
    }
  }
}
