import { describe, expect, it } from "vitest";
import { parseGitHubRemote } from "../src/remote.js";

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
