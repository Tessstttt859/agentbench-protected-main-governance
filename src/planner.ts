import { desiredRuleset } from "./normalize.js";
import type {
  GitHubRuleset,
  GovernanceContract,
  GovernancePlan,
  PlanAction,
  RepositoryState
} from "./types.js";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(sortValue)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)])
    );
  }
  return value;
}

export function rulesetsEqual(left: GitHubRuleset, right: GitHubRuleset): boolean {
  const project = (value: GitHubRuleset) => ({
    name: value.name,
    target: value.target,
    enforcement: value.enforcement,
    conditions: value.conditions,
    rules: value.rules.map((rule) => {
      const desiredRule = right.rules.find((candidate) => candidate.type === rule.type);
      if (!desiredRule) return rule;
      if (!("parameters" in desiredRule) || !("parameters" in rule)) return { type: rule.type };
      const desiredParameters = desiredRule.parameters as Record<string, unknown>;
      const actualParameters = rule.parameters as Record<string, unknown>;
      return {
        type: rule.type,
        parameters: Object.fromEntries(
          Object.keys(desiredParameters).map((key) => [key, actualParameters[key]])
        )
      };
    }),
    bypass_actors: value.bypass_actors
  });
  return JSON.stringify(sortValue(project(left))) === JSON.stringify(sortValue(project(right)));
}

export function buildPlan(contract: GovernanceContract, state: RepositoryState): GovernancePlan {
  const managed = state.rulesets.filter((ruleset) =>
    ruleset.name.startsWith(contract.managedNamePrefix)
  );
  const unmanaged = state.rulesets.filter(
    (ruleset) => !ruleset.name.startsWith(contract.managedNamePrefix)
  );
  const writes: PlanAction[] = [];
  const deletions: PlanAction[] = [];

  for (const expected of contract.rulesets) {
    const desired = desiredRuleset(expected, state.defaultBranch, contract.mergeMethod);
    const candidates = managed
      .filter((ruleset) => ruleset.name === expected.name)
      .sort((left, right) => left.id - right.id);
    const compliant = candidates.find((ruleset) => rulesetsEqual(ruleset, desired));
    const keeper = compliant ?? candidates[0];
    if (!keeper) {
      writes.push({ kind: "create", name: expected.name, desired });
    } else if (!rulesetsEqual(keeper, desired)) {
      writes.push({
        kind: "update",
        name: expected.name,
        rulesetId: keeper.id,
        desired
      });
    }
    for (const duplicate of candidates) {
      if (duplicate.id !== keeper?.id) {
        deletions.push({ kind: "delete", name: duplicate.name, rulesetId: duplicate.id });
      }
    }
  }

  for (const current of managed) {
    if (!contract.rulesets.some((ruleset) => ruleset.name === current.name)) {
      deletions.push({ kind: "delete", name: current.name, rulesetId: current.id });
    }
  }

  writes.sort((left, right) => left.name.localeCompare(right.name));
  deletions.sort((left, right) => {
    const nameOrder = left.name.localeCompare(right.name);
    if (nameOrder !== 0) return nameOrder;
    if (left.kind !== "delete" || right.kind !== "delete") return 0;
    return left.rulesetId - right.rulesetId;
  });
  const requiredChecks = [
    ...new Set(contract.rulesets.flatMap((ruleset) => ruleset.rules.requireStatusChecks))
  ].sort();
  const observedWorkflowChecks = [...new Set(state.workflowChecks)].sort();

  return {
    schemaVersion: 1,
    repository: `${state.owner}/${state.repository}`,
    defaultBranch: state.defaultBranch,
    defaultBranchSha: state.defaultBranchSha,
    observedWorkflowChecks,
    missingWorkflowChecks: requiredChecks.filter(
      (check) => !observedWorkflowChecks.includes(check)
    ),
    actions: [...writes, ...deletions],
    preservedUnmanagedRulesets: unmanaged.map((ruleset) => ruleset.name).sort()
  };
}

export function isCompliant(plan: GovernancePlan): boolean {
  return plan.actions.length === 0 && plan.missingWorkflowChecks.length === 0;
}
