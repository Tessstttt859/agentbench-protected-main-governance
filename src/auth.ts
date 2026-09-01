import { homedir } from "node:os";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { PolicyError } from "./errors.js";

export function defaultTokenPath(): string {
  return resolve(homedir(), ".config", "agent-eval", "github-governance-token.txt");
}

export async function readToken(path = process.env.GITHUB_TOKEN_FILE ?? defaultTokenPath()) {
  let token: string;
  try {
    token = (await readFile(path, "utf8")).trim();
  } catch (error) {
    throw new PolicyError("unable to read the configured GitHub token file", "TOKEN_READ_FAILED", {
      cause: error
    });
  }
  if (token === "") {
    throw new PolicyError("the configured GitHub token file is empty", "EMPTY_TOKEN");
  }
  return token;
}
