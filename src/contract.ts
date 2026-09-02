import { readFile } from "node:fs/promises";
import { ContractValidationError } from "./errors.js";
import type { ContractRuleset, GovernanceContract } from "./types.js";

const TOP_LEVEL_KEYS = [
  "version",
  "managedNamePrefix",
  "defaultBranch",
  "mergeMethod",
  "rulesets"
] as const;
const RULESET_KEYS = [
  "name",
  "target",
  "enforcement",
  "branches",
  "bypassActors",
  "rules"
] as const;
const RULE_KEYS = [
  "requirePullRequest",
  "requiredApprovals",
  "requireResolvedConversations",
  "requireStatusChecks",
  "strictStatusChecks",
  "requireLinearHistory",
  "blockForcePushes",
  "blockDeletions"
] as const;
const BYPASS_KEYS = ["actorId", "actorType", "bypassMode"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ContractValidationError(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string
): void {
  const unknown = Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .sort();
  if (unknown.length > 0) {
    throw new ContractValidationError(`${path} contains unknown key ${unknown[0] ?? "unknown"}`);
  }
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new ContractValidationError(`${path} must be a boolean`);
  }
  return value;
}

function parseBranches(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ContractValidationError(`${path} must be a non-empty array`);
  }
  const branches = value.map((branch, index) => requireString(branch, `${path}[${String(index)}]`));
  const seen = new Set<string>();
  for (const branch of branches) {
    if (branch.includes("*") || branch.includes("?") || branch.includes("[")) {
      throw new ContractValidationError(`${path} contains an unsafe wildcard target`);
    }
    if (branch !== "~DEFAULT_BRANCH" && !/^refs\/heads\/[A-Za-z0-9._/-]+$/.test(branch)) {
      throw new ContractValidationError(`${path} contains a malformed branch selector`);
    }
    if (seen.has(branch)) {
      throw new ContractValidationError(`${path} contains duplicate branch selector ${branch}`);
    }
    seen.add(branch);
  }
  return branches;
}

function parseBypassActors(value: unknown, path: string): ContractRuleset["bypassActors"] {
  if (!Array.isArray(value)) {
    throw new ContractValidationError(`${path} must be an array`);
  }
  return value.map((actor, index) => {
    const actorPath = `${path}[${String(index)}]`;
    if (!isRecord(actor)) throw new ContractValidationError(`${actorPath} must be an object`);
    rejectUnknownKeys(actor, BYPASS_KEYS, actorPath);
    if (!Number.isSafeInteger(actor.actorId) || Number(actor.actorId) < 1) {
      throw new ContractValidationError(`${actorPath}.actorId must be a positive integer`);
    }
    if (
      !(["RepositoryRole", "Team", "Integration", "OrganizationAdmin"] as const).includes(
        actor.actorType as never
      )
    ) {
      throw new ContractValidationError(`${actorPath}.actorType is unsupported`);
    }
    if (!(["always", "pull_request"] as const).includes(actor.bypassMode as never)) {
      throw new ContractValidationError(`${actorPath}.bypassMode is unsupported`);
    }
    return {
      actorId: Number(actor.actorId),
      actorType: actor.actorType as ContractRuleset["bypassActors"][number]["actorType"],
      bypassMode: actor.bypassMode as ContractRuleset["bypassActors"][number]["bypassMode"]
    };
  });
}

function parseRuleset(value: unknown, index: number): ContractRuleset {
  if (!isRecord(value)) {
    throw new ContractValidationError(`rulesets[${String(index)}] must be an object`);
  }
  const path = `rulesets[${String(index)}]`;
  rejectUnknownKeys(value, RULESET_KEYS, path);
  if (!isRecord(value.rules)) {
    throw new ContractValidationError(`rulesets[${String(index)}].rules must be an object`);
  }
  rejectUnknownKeys(value.rules, RULE_KEYS, `${path}.rules`);
  const checks = value.rules.requireStatusChecks;
  if (!Array.isArray(checks)) {
    throw new ContractValidationError(
      `rulesets[${String(index)}].rules.requireStatusChecks must be an array of strings`
    );
  }
  const requireStatusChecks = checks.map((check, checkIndex) =>
    requireString(check, `${path}.rules.requireStatusChecks[${String(checkIndex)}]`)
  );
  if (new Set(requireStatusChecks).size !== requireStatusChecks.length) {
    throw new ContractValidationError(`${path}.rules.requireStatusChecks contains duplicates`);
  }
  const requiredApprovals = value.rules.requiredApprovals;
  if (
    !Number.isSafeInteger(requiredApprovals) ||
    Number(requiredApprovals) < 0 ||
    Number(requiredApprovals) > 6
  ) {
    throw new ContractValidationError(
      `${path}.rules.requiredApprovals must be an integer from 0 to 6`
    );
  }
  const name = requireString(value.name, `${path}.name`);
  if (value.target !== "branch") {
    throw new ContractValidationError(`${path}.target is unsupported`);
  }
  if (!(["active", "evaluate", "disabled"] as const).includes(value.enforcement as never)) {
    throw new ContractValidationError(`${path}.enforcement is unsupported`);
  }
  return {
    name,
    target: "branch",
    enforcement: value.enforcement as ContractRuleset["enforcement"],
    branches: parseBranches(value.branches, `${path}.branches`),
    bypassActors: parseBypassActors(value.bypassActors, `${path}.bypassActors`),
    rules: {
      requirePullRequest: requireBoolean(
        value.rules.requirePullRequest,
        `${path}.rules.requirePullRequest`
      ),
      requiredApprovals: Number(requiredApprovals),
      requireResolvedConversations: requireBoolean(
        value.rules.requireResolvedConversations,
        `${path}.rules.requireResolvedConversations`
      ),
      requireStatusChecks,
      strictStatusChecks: requireBoolean(
        value.rules.strictStatusChecks,
        `${path}.rules.strictStatusChecks`
      ),
      requireLinearHistory: requireBoolean(
        value.rules.requireLinearHistory,
        `${path}.rules.requireLinearHistory`
      ),
      blockForcePushes: requireBoolean(
        value.rules.blockForcePushes,
        `${path}.rules.blockForcePushes`
      ),
      blockDeletions: requireBoolean(value.rules.blockDeletions, `${path}.rules.blockDeletions`)
    }
  };
}

export function parseContract(value: unknown): GovernanceContract {
  if (!isRecord(value)) {
    throw new ContractValidationError("contract must be an object");
  }
  if (value.version !== 1) {
    throw new ContractValidationError("unsupported contract version");
  }
  rejectUnknownKeys(value, TOP_LEVEL_KEYS, "contract");
  const managedNamePrefix = requireString(value.managedNamePrefix, "managedNamePrefix");
  if (
    managedNamePrefix.includes("*") ||
    managedNamePrefix.includes("?") ||
    managedNamePrefix.includes("[") ||
    !managedNamePrefix.endsWith("/")
  ) {
    throw new ContractValidationError("managedNamePrefix must be a literal namespace ending in /");
  }
  const defaultBranch = requireString(value.defaultBranch, "defaultBranch");
  if (!/^[A-Za-z0-9._/-]+$/.test(defaultBranch)) {
    throw new ContractValidationError("defaultBranch is malformed");
  }
  if (!(["merge", "squash", "rebase"] as const).includes(value.mergeMethod as never)) {
    throw new ContractValidationError("mergeMethod is unsupported");
  }
  if (!Array.isArray(value.rulesets) || value.rulesets.length === 0) {
    throw new ContractValidationError("rulesets must be a non-empty array");
  }
  const rulesets = value.rulesets.map(parseRuleset);
  const names = new Set<string>();
  const selectors = new Map<string, string>();
  for (const ruleset of rulesets) {
    if (!ruleset.name.startsWith(managedNamePrefix)) {
      throw new ContractValidationError(`ruleset ${ruleset.name} is outside the managed prefix`);
    }
    if (names.has(ruleset.name)) {
      throw new ContractValidationError(`duplicate managed ruleset name ${ruleset.name}`);
    }
    names.add(ruleset.name);
    for (const selector of ruleset.branches) {
      const owner = selectors.get(selector);
      if (owner) {
        throw new ContractValidationError(
          `conflicting policies ${owner} and ${ruleset.name} target ${selector}`
        );
      }
      selectors.set(selector, ruleset.name);
    }
  }

  return {
    version: 1,
    managedNamePrefix,
    defaultBranch,
    mergeMethod: value.mergeMethod as GovernanceContract["mergeMethod"],
    rulesets
  };
}

export async function loadContract(path: string): Promise<GovernanceContract> {
  const source = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new ContractValidationError(`contract is not valid JSON: ${String(error)}`);
  }
  return parseContract(value);
}
