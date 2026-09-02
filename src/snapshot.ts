import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PolicyError } from "./errors.js";
import { stableJson } from "./stable-json.js";
import type { GitHubRuleset, RecoverySnapshot } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknown(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string
): void {
  const unknown = Object.keys(value)
    .filter((key) => !keys.includes(key))
    .sort();
  if (unknown[0]) {
    throw new PolicyError(`${path} contains unknown field ${unknown[0]}`, "SNAPSHOT_INVALID");
  }
}

function parseRuleset(value: unknown, index: number): GitHubRuleset {
  const path = `managedRulesets[${String(index)}]`;
  if (!isRecord(value)) throw new PolicyError(`invalid ${path}`, "SNAPSHOT_INVALID");
  rejectUnknown(
    value,
    ["id", "name", "target", "enforcement", "conditions", "rules", "bypass_actors"],
    path
  );
  if (
    !Number.isSafeInteger(value.id) ||
    typeof value.name !== "string" ||
    value.name === "" ||
    !(["branch", "tag", "push"] as const).includes(value.target as never) ||
    !(["active", "evaluate", "disabled"] as const).includes(value.enforcement as never) ||
    !isRecord(value.conditions) ||
    !Array.isArray(value.rules) ||
    !Array.isArray(value.bypass_actors)
  ) {
    throw new PolicyError(`invalid ${path}`, "SNAPSHOT_INVALID");
  }
  if (!isRecord(value.conditions.ref_name)) {
    throw new PolicyError(`invalid ${path}.conditions.ref_name`, "SNAPSHOT_INVALID");
  }
  rejectUnknown(value.conditions, ["ref_name"], `${path}.conditions`);
  rejectUnknown(value.conditions.ref_name, ["include", "exclude"], `${path}.conditions.ref_name`);
  if (
    !Array.isArray(value.conditions.ref_name.include) ||
    !value.conditions.ref_name.include.every((item) => typeof item === "string") ||
    !Array.isArray(value.conditions.ref_name.exclude) ||
    !value.conditions.ref_name.exclude.every((item) => typeof item === "string")
  ) {
    throw new PolicyError(`invalid ${path}.conditions.ref_name`, "SNAPSHOT_INVALID");
  }
  for (const [ruleIndex, rule] of value.rules.entries()) {
    if (!isRecord(rule) || typeof rule.type !== "string") {
      throw new PolicyError(`invalid ${path}.rules[${String(ruleIndex)}]`, "SNAPSHOT_INVALID");
    }
    rejectUnknown(rule, ["type", "parameters"], `${path}.rules[${String(ruleIndex)}]`);
  }
  for (const [actorIndex, actor] of value.bypass_actors.entries()) {
    if (!isRecord(actor)) {
      throw new PolicyError(
        `invalid ${path}.bypass_actors[${String(actorIndex)}]`,
        "SNAPSHOT_INVALID"
      );
    }
    rejectUnknown(
      actor,
      ["actor_id", "actor_type", "bypass_mode"],
      `${path}.bypass_actors[${String(actorIndex)}]`
    );
  }
  return value as unknown as GitHubRuleset;
}

export function validateRecoverySnapshot(value: unknown): RecoverySnapshot {
  if (!isRecord(value)) throw new PolicyError("invalid recovery snapshot", "SNAPSHOT_INVALID");
  rejectUnknown(
    value,
    ["schemaVersion", "repository", "defaultBranch", "managedNamePrefix", "managedRulesets"],
    "snapshot"
  );
  if (value.schemaVersion !== 1) {
    throw new PolicyError("invalid snapshot schemaVersion", "SNAPSHOT_INVALID");
  }
  if (
    typeof value.repository !== "string" ||
    !/^[^/\s]+\/[^/\s]+$/.test(value.repository) ||
    typeof value.defaultBranch !== "string" ||
    value.defaultBranch === "" ||
    typeof value.managedNamePrefix !== "string" ||
    value.managedNamePrefix === "" ||
    !Array.isArray(value.managedRulesets)
  ) {
    throw new PolicyError("invalid snapshot fields or managedRulesets", "SNAPSHOT_INVALID");
  }
  const managedRulesets = value.managedRulesets.map(parseRuleset);
  const names = new Set<string>();
  for (const ruleset of managedRulesets) {
    if (!ruleset.name.startsWith(value.managedNamePrefix)) {
      throw new PolicyError("snapshot contains an unmanaged ruleset", "SNAPSHOT_INVALID");
    }
    if (names.has(ruleset.name)) {
      throw new PolicyError("snapshot contains duplicate managed rulesets", "SNAPSHOT_INVALID");
    }
    names.add(ruleset.name);
  }
  return {
    schemaVersion: 1,
    repository: value.repository,
    defaultBranch: value.defaultBranch,
    managedNamePrefix: value.managedNamePrefix,
    managedRulesets
  };
}

export async function writeSnapshot(path: string, snapshot: RecoverySnapshot): Promise<void> {
  const validated = validateRecoverySnapshot(snapshot);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, stableJson(validated), { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
    if (code === "EEXIST") {
      throw new PolicyError("recovery snapshot already exists", "SNAPSHOT_EXISTS", {
        cause: error
      });
    }
    throw error;
  }
}

export async function readSnapshot(path: string): Promise<RecoverySnapshot> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new PolicyError("recovery snapshot is missing", "SNAPSHOT_MISSING", { cause: error });
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new PolicyError("recovery snapshot is not valid JSON", "SNAPSHOT_INVALID", {
      cause: error
    });
  }
  return validateRecoverySnapshot(value);
}
