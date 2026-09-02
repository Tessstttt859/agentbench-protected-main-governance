import { setTimeout as delay } from "node:timers/promises";
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

interface TransportOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function headersObject(entries: IterableIterator<[string, string]>): Record<string, string> {
  return Object.fromEntries([...entries].map(([key, value]) => [key.toLowerCase(), value]));
}

function retryAfterMilliseconds(value: string | undefined, now = Date.now()): number | undefined {
  if (value === undefined) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

function isTransientStatus(status: number, headers: Record<string, string>): boolean {
  if ([408, 429, 500, 502, 503, 504].includes(status)) return true;
  return (
    status === 403 &&
    (headers["retry-after"] !== undefined || headers["x-ratelimit-remaining"] === "0")
  );
}

function safeRemoteDetail(raw: string): string {
  const compact = raw.replace(/\s+/g, " ").slice(0, 500);
  return redactSensitive(compact === "" ? "no response body" : compact);
}

export class FetchGitHubTransport implements GitHubTransport {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  public constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch as FetchLike,
    private readonly apiBase = "https://api.github.com",
    options: TransportOptions = {}
  ) {
    if (token.trim() === "") throw new PolicyError("GitHub token is empty", "EMPTY_TOKEN");
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.sleep = options.sleep ?? (async (milliseconds) => delay(milliseconds));
  }

  public async request<T>(method: string, path: string, body?: unknown) {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.apiBase}${path}`, {
          method,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "protected-main-governance-rollout"
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal
        });
        const headers = headersObject(response.headers.entries());
        const raw = await response.text();
        if (response.status < 200 || response.status >= 300) {
          if (attempt < this.maxAttempts && isTransientStatus(response.status, headers)) {
            const retryAfter = retryAfterMilliseconds(headers["retry-after"]);
            await this.sleep(Math.min(retryAfter ?? 100 * 2 ** (attempt - 1), 5_000));
            continue;
          }
          throw new GitHubApiError(
            `GitHub ${method} ${path} failed (${String(response.status)}): ${safeRemoteDetail(raw)}`,
            response.status
          );
        }
        let parsed: unknown = null;
        if (raw !== "") {
          try {
            parsed = JSON.parse(raw);
          } catch {
            throw new GitHubApiError(`GitHub ${method} ${path} returned malformed JSON`, 502);
          }
        }
        return { status: response.status, headers, body: parsed as T };
      } catch (error) {
        if (error instanceof GitHubApiError) throw error;
        if (attempt === this.maxAttempts) {
          throw new PolicyError(
            `GitHub ${method} ${path} failed after ${String(this.maxAttempts)} bounded attempts`,
            "GITHUB_NETWORK_ERROR",
            { cause: error }
          );
        }
        await this.sleep(100 * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new PolicyError("GitHub request exhausted retry budget", "GITHUB_NETWORK_ERROR");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuleset(value: unknown): value is GitHubRuleset {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.id) &&
    typeof value.name === "string" &&
    typeof value.target === "string" &&
    typeof value.enforcement === "string" &&
    isRecord(value.conditions) &&
    Array.isArray(value.rules) &&
    Array.isArray(value.bypass_actors)
  );
}

function nextPage(headers: Record<string, string>): string | undefined {
  const link = headers.link;
  if (!link) return undefined;
  for (const entry of link.split(",")) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(entry);
    if (!match?.[1]) continue;
    const url = new URL(match[1], "https://api.github.com");
    if (url.hostname !== "api.github.com") {
      throw new GitHubApiError("GitHub pagination returned an unsafe next link", 502);
    }
    return `${url.pathname}${url.search}`;
  }
  return undefined;
}

export class GitHubClient {
  public constructor(
    private readonly owner: string,
    private readonly repository: string,
    private readonly transport: GitHubTransport
  ) {}

  public get fullName(): string {
    return `${this.owner}/${this.repository}`;
  }

  private path(suffix = ""): string {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repository)}${suffix}`;
  }

  public async getDefaultBranch(): Promise<string> {
    const response = await this.transport.request<unknown>("GET", this.path());
    if (!isRecord(response.body) || typeof response.body.default_branch !== "string") {
      throw new GitHubApiError("GitHub repository response omitted default_branch", 502);
    }
    return response.body.default_branch;
  }

  public async getBranchHead(branch: string): Promise<string> {
    const response = await this.transport.request<unknown>(
      "GET",
      this.path(`/branches/${encodeURIComponent(branch)}`)
    );
    if (
      !isRecord(response.body) ||
      !isRecord(response.body.commit) ||
      typeof response.body.commit.sha !== "string"
    ) {
      throw new GitHubApiError("GitHub branch response omitted commit.sha", 502);
    }
    return response.body.commit.sha;
  }

  public async getRuleset(id: number): Promise<GitHubRuleset> {
    const response = await this.transport.request<unknown>(
      "GET",
      this.path(`/rulesets/${String(id)}`)
    );
    if (!isRuleset(response.body)) {
      throw new GitHubApiError("GitHub returned a malformed ruleset", 502);
    }
    return response.body;
  }

  public async listRulesets(): Promise<GitHubRuleset[]> {
    const result: GitHubRuleset[] = [];
    let path: string | undefined = this.path(
      "/rulesets?includes_parents=false&per_page=100&page=1"
    );
    while (path) {
      const response = await this.transport.request<unknown>("GET", path);
      if (!Array.isArray(response.body)) {
        throw new GitHubApiError("GitHub returned a malformed ruleset list", 502);
      }
      for (const item of response.body) {
        if (!isRecord(item) || !Number.isSafeInteger(item.id)) {
          throw new GitHubApiError("GitHub returned a malformed ruleset list item", 502);
        }
        result.push(isRuleset(item) ? item : await this.getRuleset(Number(item.id)));
      }
      path = nextPage(response.headers);
    }
    return result;
  }

  public async listWorkflowCheckNames(ref = "HEAD"): Promise<string[]> {
    const names = new Set<string>();
    let path: string | undefined = this.path(
      `/commits/${encodeURIComponent(ref)}/check-runs?per_page=100&page=1`
    );
    while (path) {
      const response = await this.transport.request<unknown>("GET", path);
      if (!isRecord(response.body) || !Array.isArray(response.body.check_runs)) {
        throw new GitHubApiError("GitHub returned a malformed check-runs response", 502);
      }
      for (const run of response.body.check_runs) {
        if (!isRecord(run) || typeof run.name !== "string") {
          throw new GitHubApiError("GitHub returned a malformed check-run", 502);
        }
        names.add(run.name);
      }
      path = nextPage(response.headers);
    }
    return [...names].sort();
  }

  public async createRuleset(desired: GitHubRuleset): Promise<GitHubRuleset> {
    const response = await this.transport.request<unknown>(
      "POST",
      this.path("/rulesets"),
      stripRulesetId(desired)
    );
    if (!isRuleset(response.body)) {
      throw new GitHubApiError("GitHub returned a malformed created ruleset", 502);
    }
    return response.body;
  }

  public async updateRuleset(id: number, desired: GitHubRuleset): Promise<GitHubRuleset> {
    const response = await this.transport.request<unknown>(
      "PUT",
      this.path(`/rulesets/${String(id)}`),
      stripRulesetId(desired)
    );
    if (!isRuleset(response.body)) {
      throw new GitHubApiError("GitHub returned a malformed updated ruleset", 502);
    }
    return response.body;
  }

  public async deleteRuleset(id: number): Promise<void> {
    await this.transport.request("DELETE", this.path(`/rulesets/${String(id)}`));
  }
}

export function stripRulesetId(ruleset: GitHubRuleset): Omit<GitHubRuleset, "id"> {
  const { id, ...body } = ruleset;
  void id;
  return body;
}
