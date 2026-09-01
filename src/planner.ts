import { desiredRuleset } from "./normalize.js";
import type {
  GitHubRuleset,
  GovernanceContract,
  GovernancePlan,
  PlanAction,
  RepositoryState
} from "./types.js";

function comparable(value: GitHubRuleset): string {
  const { id, ...rest } = value;
  void id;
  return JSON.stringify(rest);
}

export function buildPlan(contract: GovernanceContract, state: RepositoryState): GovernancePlan {
  const managed = state.rulesets.filter((ruleset) =>
    ruleset.name.startsWith(contract.managedNamePrefix)
  );
  const unmanaged = state.rulesets.filter(
    (ruleset) => !ruleset.name.startsWith(contract.managedNamePrefix)
  );
  const actions: PlanAction[] = [];

  for (const current of managed) {
    if (!contract.rulesets.some((ruleset) => ruleset.name === current.name)) {
      actions.push({ kind: "delete", name: current.name, rulesetId: current.id });
    }
  }

  for (const expected of contract.rulesets) {
    const desired = desiredRuleset(expected, state.defaultBranch);
    const current = managed.find((ruleset) => ruleset.name === expected.name);
    if (!current) {
      actions.push({ kind: "create", name: expected.name, desired });
    } else if (comparable(current) !== comparable(desired)) {
      actions.push({
        kind: "update",
        name: expected.name,
        rulesetId: current.id,
        desired
      });
    }
  }

  return {
    schemaVersion: 1,
    repository: `${state.owner}/${state.repository}`,
    defaultBranch: state.defaultBranch,
    generatedAt: new Date().toISOString(),
    actions,
    preservedUnmanagedRulesets: unmanaged.map((ruleset) => ruleset.name)
  };
}

export function isCompliant(plan: GovernancePlan): boolean {
  return plan.actions.length === 0;
}
