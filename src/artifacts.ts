import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { stableJson } from "./stable-json.js";
import type { GovernancePlan } from "./types.js";

export function planMarkdown(plan: GovernancePlan): string {
  const lines = [
    "# Governance plan",
    "",
    `Repository: \`${plan.repository}\``,
    `Default branch: \`${plan.defaultBranch}\``,
    `Default branch head: \`${plan.defaultBranchSha}\``,
    "",
    "## Managed changes",
    ""
  ];
  if (plan.actions.length === 0) {
    lines.push("No changes required.");
  } else {
    for (const action of plan.actions) {
      lines.push(`- ${action.kind}: \`${action.name}\``);
    }
  }
  lines.push("", "## Preserved unmanaged rulesets", "");
  if (plan.preservedUnmanagedRulesets.length === 0) {
    lines.push("None observed.");
  } else {
    for (const name of plan.preservedUnmanagedRulesets) lines.push(`- \`${name}\``);
  }
  lines.push("", "## Workflow checks", "");
  if (plan.missingWorkflowChecks.length === 0) {
    lines.push("All contract-required workflow checks were observed.");
  } else {
    for (const name of plan.missingWorkflowChecks) lines.push(`- missing: \`${name}\``);
  }
  return `${lines.join("\n")}\n`;
}

export async function writePlanArtifacts(
  plan: GovernancePlan,
  jsonPath = "artifacts/governance-plan.json",
  markdownPath = "artifacts/governance-plan.md"
): Promise<void> {
  await mkdir(dirname(jsonPath), { recursive: true });
  await mkdir(dirname(markdownPath), { recursive: true });
  await Promise.all([
    writeFile(jsonPath, stableJson(plan), { encoding: "utf8", mode: 0o600 }),
    writeFile(markdownPath, planMarkdown(plan), { encoding: "utf8", mode: 0o600 })
  ]);
}
