import { execFileSync } from "node:child_process";
import { PolicyError } from "./errors.js";

export interface RepositoryCoordinates {
  owner: string;
  repository: string;
}

export function parseGitHubRemote(remote: string): RepositoryCoordinates {
  const value = remote.trim();
  const https = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(value);
  if (https) {
    const [, owner, repository] = https;
    if (owner && repository) return { owner, repository };
  }

  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(value);
  if (ssh) {
    const [, owner, repository] = ssh;
    if (owner && repository) return { owner, repository };
  }

  const sshUrl = /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(value);
  if (sshUrl) {
    const [, owner, repository] = sshUrl;
    if (owner && repository) return { owner, repository };
  }

  throw new PolicyError("origin is not a supported GitHub remote", "INVALID_REMOTE");
}

export function resolveRepositoryFromOrigin(cwd = process.cwd()): RepositoryCoordinates {
  let origin: string;
  try {
    origin = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch (error) {
    throw new PolicyError("unable to resolve the origin remote", "MISSING_REMOTE", {
      cause: error
    });
  }
  return parseGitHubRemote(origin);
}
