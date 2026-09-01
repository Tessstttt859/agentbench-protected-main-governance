import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writePlanArtifacts } from "../src/artifacts.js";
import { buildPlan } from "../src/planner.js";
import { contract, state } from "./helpers.js";

describe("plan artifacts", () => {
  it("writes byte-identical output for identical inputs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-plan-"));
    const json = join(directory, "plan.json");
    const markdown = join(directory, "plan.md");
    await writePlanArtifacts(buildPlan(contract(), state([])), json, markdown);
    const first = [await readFile(json, "utf8"), await readFile(markdown, "utf8")];
    await writePlanArtifacts(buildPlan(contract(), state([])), json, markdown);
    const second = [await readFile(json, "utf8"), await readFile(markdown, "utf8")];
    expect(second).toEqual(first);
  });

  it("contains no absolute local path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "governance-plan-"));
    const json = join(directory, "plan.json");
    const markdown = join(directory, "plan.md");
    await writePlanArtifacts(buildPlan(contract(), state([])), json, markdown);
    expect(await readFile(json, "utf8")).not.toContain(directory);
    expect(await readFile(markdown, "utf8")).not.toContain(directory);
  });
});
