import { PolicyError } from "./errors.js";
import type { GitHubClient } from "./github.js";
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

export async function applyPlan(
  client: GitHubClient,
  contract: GovernanceContract,
  plan: GovernancePlan,
  before: GitHubRuleset[],
  snapshots: SnapshotStore
): Promise<void> {
  const managedBefore = before.filter((ruleset) =>
    ruleset.name.startsWith(contract.managedNamePrefix)
  );
  if (plan.actions.length > 0) {
    await snapshots.save({
      schemaVersion: 1,
      repository: plan.repository,
      defaultBranch: plan.defaultBranch,
      managedNamePrefix: contract.managedNamePrefix,
      managedRulesets: managedBefore
    });
  }

  for (const action of plan.actions) {
    if (action.kind === "delete") await client.deleteRuleset(action.rulesetId);
    if (action.kind === "create") await client.createRuleset(action.desired);
    if (action.kind === "update") await client.updateRuleset(action.rulesetId, action.desired);
  }
}

export async function restoreSnapshot(
  client: GitHubClient,
  contract: GovernanceContract,
  snapshot: RecoverySnapshot,
  current: GitHubRuleset[]
): Promise<void> {
  if (snapshot.managedNamePrefix !== contract.managedNamePrefix) {
    throw new PolicyError(
      "snapshot managed prefix does not match the contract",
      "SNAPSHOT_MISMATCH"
    );
  }

  for (const ruleset of current) {
    if (ruleset.name.startsWith(contract.managedNamePrefix)) {
      await client.deleteRuleset(ruleset.id);
    }
  }
  for (const ruleset of snapshot.managedRulesets) {
    await client.createRuleset(ruleset);
  }
}
