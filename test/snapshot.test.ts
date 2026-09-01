import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSnapshot, writeSnapshot } from "../src/snapshot.js";
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
});
