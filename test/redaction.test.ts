import { describe, expect, it } from "vitest";
import { redactSensitive, safeErrorMessage } from "../src/redaction.js";

describe("sensitive material redaction", () => {
  const fakeClassicToken = ["ghp", "supersecret123"].join("_");
  const fakeFineGrainedToken = ["github", "pat", "11AA", "supersecret123"].join("_");

  it.each([
    `Authorization: Bearer ${fakeClassicToken}`,
    `request failed?access_token=${fakeClassicToken}&mode=test`,
    ["https://octo:", fakeClassicToken, "@github.com/octo/repo.git"].join(""),
    JSON.stringify({ token: fakeClassicToken, message: "bad credentials" }),
    `remote returned ${fakeFineGrainedToken}`
  ])("does not retain known token forms", (value) => {
    const redacted = redactSensitive(value);
    expect(redacted).not.toContain("supersecret123");
    expect(redacted).toContain("REDACTED");
  });

  it("redacts error messages without returning stacks", () => {
    const error = new Error(`Authorization: Bearer ${["github", "pat", "secret"].join("_")}`);
    expect(safeErrorMessage(error)).toBe("Authorization: Bearer [REDACTED]");
  });
});
