import type { ContractRuleset, GitHubRuleset, MergeMethod } from "./types.js";

export function desiredRuleset(
  contract: ContractRuleset,
  defaultBranch: string,
  mergeMethod: MergeMethod = "squash"
): GitHubRuleset {
  const include = contract.branches.map((branch) =>
    branch === "~DEFAULT_BRANCH" ? `refs/heads/${defaultBranch}` : branch
  );
  const rules: GitHubRuleset["rules"] = [];
  if (contract.rules.blockDeletions) rules.push({ type: "deletion" });
  if (contract.rules.blockForcePushes) rules.push({ type: "non_fast_forward" });
  if (contract.rules.requireLinearHistory) rules.push({ type: "required_linear_history" });
  if (contract.rules.requirePullRequest) {
    rules.push({
      type: "pull_request",
      parameters: {
        required_approving_review_count: contract.rules.requiredApprovals,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: contract.rules.requireResolvedConversations,
        allowed_merge_methods: [mergeMethod]
      }
    });
  }
  if (contract.rules.requireStatusChecks.length > 0) {
    rules.push({
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: contract.rules.strictStatusChecks,
        required_status_checks: contract.rules.requireStatusChecks.map((context) => ({ context }))
      }
    });
  }

  return {
    id: 0,
    name: contract.name,
    target: contract.target,
    enforcement: contract.enforcement,
    conditions: { ref_name: { include, exclude: [] } },
    rules,
    bypass_actors: contract.bypassActors.map((actor) => ({
      actor_id: actor.actorId,
      actor_type: actor.actorType,
      bypass_mode: actor.bypassMode
    }))
  };
}
