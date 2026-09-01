export type MergeMethod = "merge" | "squash" | "rebase";
export type Enforcement = "active" | "evaluate" | "disabled";

export interface ContractRules {
  requirePullRequest: boolean;
  requiredApprovals: number;
  requireResolvedConversations: boolean;
  requireStatusChecks: string[];
  strictStatusChecks: boolean;
  requireLinearHistory: boolean;
  blockForcePushes: boolean;
  blockDeletions: boolean;
}

export interface ContractRuleset {
  name: string;
  target: "branch";
  enforcement: Enforcement;
  branches: string[];
  bypassActors: {
    actorId: number;
    actorType: "RepositoryRole" | "Team" | "Integration" | "OrganizationAdmin";
    bypassMode: "always" | "pull_request";
  }[];
  rules: ContractRules;
}

export interface GovernanceContract {
  version: 1;
  managedNamePrefix: string;
  defaultBranch: string;
  mergeMethod: MergeMethod;
  rulesets: ContractRuleset[];
}

export interface GitHubRuleset {
  id: number;
  name: string;
  target: "branch" | "tag" | "push";
  enforcement: Enforcement;
  conditions: {
    ref_name: {
      include: string[];
      exclude: string[];
    };
  };
  rules: (Record<string, unknown> & { type: string })[];
  bypass_actors: Record<string, unknown>[];
}

export interface RepositoryState {
  owner: string;
  repository: string;
  defaultBranch: string;
  rulesets: GitHubRuleset[];
  workflowChecks: string[];
}

export type PlanAction =
  | { kind: "create"; name: string; desired: GitHubRuleset }
  | { kind: "update"; name: string; rulesetId: number; desired: GitHubRuleset }
  | { kind: "delete"; name: string; rulesetId: number };

export interface GovernancePlan {
  schemaVersion: 1;
  repository: string;
  defaultBranch: string;
  generatedAt?: string;
  actions: PlanAction[];
  preservedUnmanagedRulesets: string[];
}

export interface RecoverySnapshot {
  schemaVersion: 1;
  repository: string;
  defaultBranch: string;
  managedNamePrefix: string;
  managedRulesets: GitHubRuleset[];
}

export interface GitHubTransport {
  request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: T;
  }>;
}
