import { describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

describe("CLI", () => {
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
});
