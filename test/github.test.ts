import { describe, expect, it, vi } from "vitest";
import { FetchGitHubTransport, GitHubClient, type FetchLike } from "../src/github.js";
import { expectedRuleset, RecordingTransport } from "./helpers.js";

describe("GitHub client", () => {
  it("follows ruleset pagination until the final page", async () => {
    const transport = new RecordingTransport();
    transport.queue(
      Array.from({ length: 100 }, (_, index) => ({ ...expectedRuleset(index + 1) })),
      200,
      { link: '<https://api.github.com/repositories/1/rulesets?page=2>; rel="next"' }
    );
    transport.queue([{ ...expectedRuleset(101), name: "agentbench/second" }]);
    const client = new GitHubClient("octo", "repository", transport);

    const result = await client.listRulesets();

    expect(result).toHaveLength(101);
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[1]!.path).toContain("page=2");
  });

  it("rejects malformed list responses", async () => {
    const transport = new RecordingTransport();
    transport.queue({ unexpected: true });
    const client = new GitHubClient("octo", "repository", transport);
    await expect(client.listRulesets()).rejects.toThrow(/malformed/i);
  });

  it("uses only the minimum body when deleting a ruleset", async () => {
    const transport = new RecordingTransport();
    transport.queue(null, 204);
    const client = new GitHubClient("octo", "repository", transport);
    await client.deleteRuleset(72);
    expect(transport.calls).toEqual([
      { method: "DELETE", path: "/repos/octo/repository/rulesets/72" }
    ]);
  });

  it("loads details for summary rulesets and validates repository and branch responses", async () => {
    const transport = new RecordingTransport();
    transport.queue([{ id: 42, name: "agentbench/protected-main" }]);
    transport.queue(expectedRuleset(42));
    transport.queue({ default_branch: "main" });
    transport.queue({ commit: { sha: "abc123" } });
    const client = new GitHubClient("octo", "repository", transport);
    await expect(client.listRulesets()).resolves.toEqual([expectedRuleset(42)]);
    await expect(client.getDefaultBranch()).resolves.toBe("main");
    await expect(client.getBranchHead("main")).resolves.toBe("abc123");
  });

  it("paginates check runs and rejects malformed API shapes", async () => {
    const transport = new RecordingTransport();
    transport.queue({ check_runs: [{ name: "CI / test" }] }, 200, {
      link: '<https://api.github.com/repos/octo/repository/commits/main/check-runs?page=2>; rel="next"'
    });
    transport.queue({ check_runs: [{ name: "CI / package" }, { name: "CI / test" }] });
    const client = new GitHubClient("octo", "repository", transport);
    await expect(client.listWorkflowCheckNames("main")).resolves.toEqual([
      "CI / package",
      "CI / test"
    ]);

    const malformed = new RecordingTransport();
    malformed.queue({ default_branch: 12 });
    await expect(
      new GitHubClient("octo", "repository", malformed).getDefaultBranch()
    ).rejects.toThrow(/default_branch/i);
  });
});

describe("GitHub HTTP transport", () => {
  it("honors Retry-After for transient rate limits and then succeeds", async () => {
    const responses = [
      { status: 429, headers: { "retry-after": "0" }, body: "rate limited" },
      { status: 200, headers: {}, body: '{"ok":true}' }
    ];
    const fakeFetch = vi.fn(async () => {
      const next = responses.shift()!;
      return {
        status: next.status,
        headers: { entries: () => Object.entries(next.headers)[Symbol.iterator]() },
        text: async () => next.body
      };
    }) as unknown as FetchLike;
    const transport = new FetchGitHubTransport("test-token", fakeFetch);
    await expect(transport.request("GET", "/test")).resolves.toMatchObject({
      status: 200,
      body: { ok: true }
    });
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it("redacts secret-like fields from remote errors", async () => {
    const fakeToken = ["ghp", "supersecret123"].join("_");
    const fakeFetch = vi.fn(async () => ({
      status: 400,
      headers: { entries: () => [][Symbol.iterator]() },
      text: async () => JSON.stringify({ token: fakeToken, message: "bad credentials" })
    })) as unknown as FetchLike;
    const transport = new FetchGitHubTransport("test-token", fakeFetch);
    let message = "";
    try {
      await transport.request("GET", "/test");
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toContain("supersecret123");
    expect(message).toContain("REDACTED");
  });

  it("does not retry permanent authorization failures", async () => {
    const fakeFetch = vi.fn(async () => ({
      status: 401,
      headers: { entries: () => [][Symbol.iterator]() },
      text: async () => '{"message":"bad credentials"}'
    })) as unknown as FetchLike;
    const transport = new FetchGitHubTransport("test-token", fakeFetch);
    await expect(transport.request("GET", "/test")).rejects.toMatchObject({ status: 401 });
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("bounds network retries and rejects malformed successful JSON", async () => {
    const failingFetch = vi.fn(async () => {
      throw new TypeError("network unavailable");
    }) as unknown as FetchLike;
    const transport = new FetchGitHubTransport(
      "test-token",
      failingFetch,
      "https://api.github.com",
      {
        maxAttempts: 2,
        sleep: async () => undefined
      }
    );
    await expect(transport.request("GET", "/test")).rejects.toThrow(/bounded attempts/i);
    expect(failingFetch).toHaveBeenCalledTimes(2);

    const malformedFetch = vi.fn(async () => ({
      status: 200,
      headers: { entries: () => [][Symbol.iterator]() },
      text: async () => "not-json"
    })) as unknown as FetchLike;
    await expect(
      new FetchGitHubTransport("test-token", malformedFetch).request("GET", "/test")
    ).rejects.toThrow(/malformed JSON/i);
  });

  it("rejects empty tokens before making a request", () => {
    expect(() => new FetchGitHubTransport("   ")).toThrow(/empty/i);
  });
});
