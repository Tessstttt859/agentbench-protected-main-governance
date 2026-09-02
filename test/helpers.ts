import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseContract } from "../src/contract.js";
import { desiredRuleset } from "../src/normalize.js";
import type {
  GitHubRuleset,
  GitHubTransport,
  GovernanceContract,
  RepositoryState
} from "../src/types.js";

export function contract(): GovernanceContract {
  return parseContract(
    JSON.parse(readFileSync(resolve("governance-contract.json"), "utf8")) as unknown
  );
}

export function expectedRuleset(id = 42): GitHubRuleset {
  return { ...desiredRuleset(contract().rulesets[0]!, "main"), id };
}

export function state(rulesets: GitHubRuleset[] = []): RepositoryState {
  return {
    owner: "octo-tester",
    repository: "agentbench-protected-main-governance",
    defaultBranch: "main",
    defaultBranchSha: "0123456789abcdef0123456789abcdef01234567",
    workflowChecks: ["CI / package", "CI / test"],
    rulesets
  };
}

export class RecordingTransport implements GitHubTransport {
  public readonly calls: Array<{ method: string; path: string; body?: unknown }> = [];
  public readonly responses: Array<{
    status: number;
    headers?: Record<string, string>;
    body: unknown;
  }> = [];

  public queue(body: unknown, status = 200, headers: Record<string, string> = {}): void {
    this.responses.push({ status, headers, body });
  }

  public async request<T>(method: string, path: string, body?: unknown) {
    this.calls.push({ method, path, ...(body === undefined ? {} : { body }) });
    const response = this.responses.shift();
    if (!response) throw new Error(`unexpected request: ${method} ${path}`);
    return {
      status: response.status,
      headers: response.headers ?? {},
      body: response.body as T
    };
  }
}
