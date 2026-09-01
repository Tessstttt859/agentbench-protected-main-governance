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
});
