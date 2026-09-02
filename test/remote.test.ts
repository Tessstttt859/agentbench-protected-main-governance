import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseGitHubRemote, resolveRepositoryFromOrigin } from "../src/remote.js";

describe("GitHub remote parsing", () => {
  it.each([
    ["https://github.com/octo/repository.git", "octo", "repository"],
    ["git@github.com:octo/repository.git", "octo", "repository"],
    ["ssh://git@github.com/octo/repository.git", "octo", "repository"]
  ])("resolves credential-free remote %s", (remote, owner, repository) => {
    expect(parseGitHubRemote(remote)).toEqual({ owner, repository });
  });

  it.each([
    ["https://", "token@", "github.com/octo/repository.git"].join(""),
    ["https://", "octo:secret@", "github.com/octo/repository.git"].join(""),
    "https://example.com/octo/repository.git",
    "file:///tmp/repository"
  ])("rejects unsupported or credential-bearing remote %s", (remote) => {
    expect(() => parseGitHubRemote(remote)).toThrow();
  });
});

describe("origin resolution", () => {
  it("reads coordinates from a temporary local repository", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-remote-"));
    execFileSync("git", ["init", "-q", directory]);
    execFileSync("git", ["remote", "add", "origin", "https://github.com/octo/repository.git"], {
      cwd: directory
    });
    expect(resolveRepositoryFromOrigin(directory)).toEqual({
      owner: "octo",
      repository: "repository"
    });
  });

  it("rejects a repository without an origin", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-remote-"));
    execFileSync("git", ["init", "-q", directory]);
    expect(() => resolveRepositoryFromOrigin(directory)).toThrow(/resolve the origin/i);
  });
});
