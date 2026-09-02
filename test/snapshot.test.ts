import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSnapshot, validateRecoverySnapshot, writeSnapshot } from "../src/snapshot.js";
import { contract, expectedRuleset } from "./helpers.js";
import type { RecoverySnapshot } from "../src/types.js";

function snapshot(): RecoverySnapshot {
  return {
    schemaVersion: 1,
    repository: "octo/agentbench-protected-main-governance",
    defaultBranch: "main",
    managedNamePrefix: contract().managedNamePrefix,
    managedRulesets: [expectedRuleset()]
  };
}

describe("recovery snapshots", () => {
  it("writes a private, credential-free snapshot and reads it back", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-snapshot-"));
    await chmod(directory, 0o700);
    const path = join(directory, "snapshot.json");
    await writeSnapshot(path, snapshot());
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readSnapshot(path)).toEqual(snapshot());
  });

  it("does not overwrite an existing recovery snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-snapshot-"));
    const path = join(directory, "snapshot.json");
    await writeSnapshot(path, snapshot());
    await expect(writeSnapshot(path, snapshot())).rejects.toThrow();
  });

  it("rejects structurally malformed snapshot JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-snapshot-"));
    const path = join(directory, "snapshot.json");
    await writeFile(path, '{"schemaVersion":1,"managedRulesets":"not-an-array"}\n');
    await expect(readSnapshot(path)).rejects.toThrow(/invalid.*managedRulesets/i);
  });

  it("rejects unknown fields that could expand restore scope", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-snapshot-"));
    const path = join(directory, "snapshot.json");
    const value = { ...snapshot(), repositorySettings: { visibility: "private" } };
    await writeFile(path, JSON.stringify(value));
    await expect(readSnapshot(path)).rejects.toThrow(/unknown.*repositorySettings/i);
  });

  it("does not serialize local paths or credentials supplied outside the snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-snapshot-"));
    const path = join(directory, "snapshot.json");
    await writeSnapshot(path, snapshot());
    const raw = await readFile(path, "utf8");
    expect(raw).not.toContain(directory);
    expect(raw).not.toMatch(/Authorization|Bearer|github_pat_|ghp_/i);
  });

  it("rejects malformed top-level snapshot fields", () => {
    expect(() => validateRecoverySnapshot(null)).toThrow(/invalid recovery snapshot/i);
    expect(() => validateRecoverySnapshot({ ...snapshot(), schemaVersion: 2 })).toThrow(
      /schemaVersion/i
    );
    expect(() => validateRecoverySnapshot({ ...snapshot(), repository: "invalid" })).toThrow(
      /fields/i
    );
  });

  it("rejects malformed ruleset, condition, rule, and actor shapes", () => {
    const cases: Array<[string, (ruleset: Record<string, unknown>) => void]> = [
      ["ruleset", (ruleset) => (ruleset.id = "bad")],
      ["conditions", (ruleset) => (ruleset.conditions = {})],
      [
        "condition field",
        (ruleset) =>
          ((
            (ruleset.conditions as Record<string, unknown>).ref_name as Record<string, unknown>
          ).extra = true)
      ],
      [
        "condition arrays",
        (ruleset) =>
          ((
            (ruleset.conditions as Record<string, unknown>).ref_name as Record<string, unknown>
          ).include = "main")
      ],
      ["rule", (ruleset) => (ruleset.rules = [null])],
      ["rule field", (ruleset) => (ruleset.rules = [{ type: "deletion", extra: true }])],
      ["actor", (ruleset) => (ruleset.bypass_actors = [null])],
      [
        "actor field",
        (ruleset) =>
          (ruleset.bypass_actors = [
            { actor_id: 1, actor_type: "Team", bypass_mode: "always", extra: true }
          ])
      ]
    ];
    for (const [name, mutate] of cases) {
      const value = structuredClone(snapshot()) as unknown as Record<string, unknown>;
      const ruleset = (value.managedRulesets as Array<Record<string, unknown>>)[0]!;
      mutate(ruleset);
      expect(() => validateRecoverySnapshot(value), name).toThrow(/invalid|unknown/i);
    }
  });

  it("rejects unmanaged and duplicate managed snapshot rulesets", () => {
    const unmanaged = structuredClone(snapshot());
    unmanaged.managedRulesets[0]!.name = "manual/security";
    expect(() => validateRecoverySnapshot(unmanaged)).toThrow(/unmanaged/i);

    const duplicate = structuredClone(snapshot());
    duplicate.managedRulesets.push(structuredClone(duplicate.managedRulesets[0]!));
    expect(() => validateRecoverySnapshot(duplicate)).toThrow(/duplicate/i);
  });
});
