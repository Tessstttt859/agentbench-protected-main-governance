import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { main } from "../src/cli.js";

describe("CLI", () => {
  function handlers() {
    return {
      plan: vi.fn(async () => ({ actions: [] })),
      apply: vi.fn(async () => undefined),
      verify: vi.fn(async () => undefined),
      restore: vi.fn(async () => undefined)
    };
  }
  it("returns usage status for an unknown command", async () => {
    const output = { log: vi.fn(), error: vi.fn() };
    await expect(main(["destroy"], output)).resolves.toBe(2);
    expect(output.error).toHaveBeenCalledWith(
      "usage: repository-policy <plan|apply|verify|restore>"
    );
  });

  it("returns usage status when extra positional arguments are supplied", async () => {
    const output = { log: vi.fn(), error: vi.fn() };
    await expect(main(["plan", "extra"], output)).resolves.toBe(2);
  });

  it.each([
    ["plan", "0 managed change(s) planned"],
    ["apply", "managed policy applied"],
    ["verify", "managed policy matches the contract"],
    ["restore", "managed policy restored from the recovery snapshot"]
  ])("returns success for %s", async (command, message) => {
    const output = { log: vi.fn(), error: vi.fn() };
    await expect(main([command], output, handlers())).resolves.toBe(0);
    expect(output.log).toHaveBeenCalledWith(message);
    expect(output.error).not.toHaveBeenCalled();
  });

  it("returns failure with a redacted, stack-free error", async () => {
    const output = { log: vi.fn(), error: vi.fn() };
    const commandHandlers = handlers();
    commandHandlers.verify.mockRejectedValueOnce(
      new Error(`Authorization: Bearer ${["ghp", "secretvalue"].join("_")}`)
    );
    await expect(main(["verify"], output, commandHandlers)).resolves.toBe(1);
    expect(output.error).toHaveBeenCalledWith("Authorization: Bearer [REDACTED]");
  });

  it("executes main when launched through tsx", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "destroy"], {
      encoding: "utf8"
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage: repository-policy");
  });
});
