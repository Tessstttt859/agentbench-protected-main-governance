import { readFile } from "node:fs/promises";
import { ContractValidationError } from "./errors.js";
import type { ContractRuleset, GovernanceContract } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ContractValidationError(`${path} must be a non-empty string`);
  }
  return value;
}

function parseRuleset(value: unknown, index: number): ContractRuleset {
  if (!isRecord(value)) {
    throw new ContractValidationError(`rulesets[${String(index)}] must be an object`);
  }
  if (!isRecord(value.rules)) {
    throw new ContractValidationError(`rulesets[${String(index)}].rules must be an object`);
  }
  const checks = value.rules.requireStatusChecks;
  if (!Array.isArray(checks) || checks.some((check) => typeof check !== "string")) {
    throw new ContractValidationError(
      `rulesets[${String(index)}].rules.requireStatusChecks must be an array of strings`
    );
  }

  return value as unknown as ContractRuleset;
}

export function parseContract(value: unknown): GovernanceContract {
  if (!isRecord(value)) {
    throw new ContractValidationError("contract must be an object");
  }
  if (value.version !== 1) {
    throw new ContractValidationError("unsupported contract version");
  }
  const managedNamePrefix = requireString(value.managedNamePrefix, "managedNamePrefix");
  const defaultBranch = requireString(value.defaultBranch, "defaultBranch");
  if (!Array.isArray(value.rulesets) || value.rulesets.length === 0) {
    throw new ContractValidationError("rulesets must be a non-empty array");
  }
  const rulesets = value.rulesets.map(parseRuleset);
  for (const ruleset of rulesets) {
    if (!ruleset.name.startsWith(managedNamePrefix)) {
      throw new ContractValidationError(`ruleset ${ruleset.name} is outside the managed prefix`);
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
