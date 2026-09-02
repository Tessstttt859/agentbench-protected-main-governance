import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readToken } from "../src/auth.js";

describe("token loading", () => {
  it("trims a runtime token without logging or persisting it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-auth-"));
    const path = join(directory, "token");
    await writeFile(path, "  test-value\n", { mode: 0o600 });
    await expect(readToken(path)).resolves.toBe("test-value");
  });

  it("rejects missing and empty token files with safe errors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-auth-"));
    await expect(readToken(join(directory, "missing"))).rejects.toThrow(/unable to read/i);
    const empty = join(directory, "empty");
    await writeFile(empty, " \n", { mode: 0o600 });
    await expect(readToken(empty)).rejects.toThrow(/empty/i);
  });
});
