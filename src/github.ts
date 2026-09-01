import { GitHubApiError, PolicyError } from "./errors.js";
import { redactSensitive } from "./redaction.js";
import type { GitHubRuleset, GitHubTransport } from "./types.js";

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{
  status: number;
  headers: { entries(): IterableIterator<[string, string]> };
  text(): Promise<string>;
}>;

export class FetchGitHubTransport implements GitHubTransport {
  public constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch as FetchLike,
    private readonly apiBase = "https://api.github.com"
  ) {
    if (token.trim() === "") {
      throw new PolicyError("GitHub token is empty", "EMPTY_TOKEN");
    }
  }

  public async request<T>(method: string, path: string, body?: unknown) {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "protected-main-governance-rollout"
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const raw = await response.text();
    let parsed: unknown = null;
    if (raw !== "") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }
    if (response.status < 200 || response.status >= 300) {
      throw new GitHubApiError(
        redactSensitive(`GitHub ${method} ${path} failed (${String(response.status)}): ${raw}`),
        response.status
      );
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: parsed as T
    };
  }
}

export class GitHubClient {
  public constructor(
    private readonly owner: string,
    private readonly repository: string,
    private readonly transport: GitHubTransport
  ) {}

  public async getDefaultBranch(): Promise<string> {
    const response = await this.transport.request<{ default_branch: string }>(
      "GET",
      `/repos/${this.owner}/${this.repository}`
    );
    if (typeof response.body.default_branch !== "string") {
      throw new GitHubApiError("GitHub repository response omitted default_branch", 502);
    }
    return response.body.default_branch;
  }

  public async listRulesets(): Promise<GitHubRuleset[]> {
    const response = await this.transport.request<GitHubRuleset[]>(
      "GET",
      `/repos/${this.owner}/${this.repository}/rulesets?includes_parents=false&per_page=100&page=1`
    );
    return response.body;
  }

  public async listWorkflowCheckNames(): Promise<string[]> {
    const response = await this.transport.request<{ workflow_runs: { name?: string }[] }>(
      "GET",
      `/repos/${this.owner}/${this.repository}/actions/runs?per_page=100`
    );
    return [...new Set(response.body.workflow_runs.flatMap((run) => (run.name ? [run.name] : [])))];
  }

  public async createRuleset(desired: GitHubRuleset): Promise<GitHubRuleset> {
    const response = await this.transport.request<GitHubRuleset>(
      "POST",
      `/repos/${this.owner}/${this.repository}/rulesets`,
      stripRulesetId(desired)
    );
    return response.body;
  }

  public async updateRuleset(id: number, desired: GitHubRuleset): Promise<GitHubRuleset> {
    const response = await this.transport.request<GitHubRuleset>(
      "PUT",
      `/repos/${this.owner}/${this.repository}/rulesets/${String(id)}`,
      stripRulesetId(desired)
    );
    return response.body;
  }

  public async deleteRuleset(id: number): Promise<void> {
    await this.transport.request(
      "DELETE",
      `/repos/${this.owner}/${this.repository}/rulesets/${String(id)}`
    );
  }
}

function stripRulesetId(ruleset: GitHubRuleset): Omit<GitHubRuleset, "id"> {
  const { id, ...body } = ruleset;
  void id;
  return body;
}
