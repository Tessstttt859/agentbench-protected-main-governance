import { resolve } from "node:path";
import { writePlanArtifacts } from "./artifacts.js";
import { readToken } from "./auth.js";
import { loadContract } from "./contract.js";
import { PolicyError } from "./errors.js";
import { FetchGitHubTransport, GitHubClient } from "./github.js";
import { buildPlan, isCompliant } from "./planner.js";
import { applyPlan, restoreSnapshot, type SnapshotStore } from "./reconciler.js";
import { resolveRepositoryFromOrigin } from "./remote.js";
import { readSnapshot, writeSnapshot } from "./snapshot.js";
import type { RepositoryState } from "./types.js";

export interface RuntimeOptions {
  cwd?: string;
  contractPath?: string;
  snapshotPath?: string;
}

async function liveContext(options: RuntimeOptions) {
  const cwd = options.cwd ?? process.cwd();
  const contractPath = options.contractPath ?? resolve(cwd, "governance-contract.json");
  const snapshotPath = options.snapshotPath ?? resolve(cwd, "artifacts", "recovery-snapshot.json");
  const coordinates = resolveRepositoryFromOrigin(cwd);
  const contract = await loadContract(contractPath);
  const token = await readToken();
  const client = new GitHubClient(
    coordinates.owner,
    coordinates.repository,
    new FetchGitHubTransport(token)
  );
  return { cwd, snapshotPath, coordinates, contract, client };
}

async function readState(
  owner: string,
  repository: string,
  client: GitHubClient
): Promise<RepositoryState> {
  const [defaultBranch, rulesets, workflowChecks] = await Promise.all([
    client.getDefaultBranch(),
    client.listRulesets(),
    client.listWorkflowCheckNames()
  ]);
  return { owner, repository, defaultBranch, rulesets, workflowChecks };
}

export async function plan(options: RuntimeOptions = {}) {
  const { cwd, coordinates, contract, client } = await liveContext(options);
  const state = await readState(coordinates.owner, coordinates.repository, client);
  const result = buildPlan(contract, state);
  await writePlanArtifacts(
    result,
    resolve(cwd, "artifacts", "governance-plan.json"),
    resolve(cwd, "artifacts", "governance-plan.md")
  );
  return result;
}

export async function apply(options: RuntimeOptions = {}): Promise<void> {
  const context = await liveContext(options);
  const state = await readState(
    context.coordinates.owner,
    context.coordinates.repository,
    context.client
  );
  const result = buildPlan(context.contract, state);
  const snapshotStore: SnapshotStore = {
    save: (snapshot) => writeSnapshot(context.snapshotPath, snapshot),
    load: () => readSnapshot(context.snapshotPath)
  };
  await applyPlan(context.client, context.contract, result, state.rulesets, snapshotStore);
}

export async function verify(options: RuntimeOptions = {}): Promise<void> {
  const context = await liveContext(options);
  const state = await readState(
    context.coordinates.owner,
    context.coordinates.repository,
    context.client
  );
  const result = buildPlan(context.contract, state);
  if (!isCompliant(result)) {
    throw new PolicyError(
      `live policy differs from the contract (${String(result.actions.length)} change(s) required)`,
      "POLICY_DRIFT"
    );
  }
}

export async function restore(options: RuntimeOptions = {}): Promise<void> {
  const context = await liveContext(options);
  const snapshot = await readSnapshot(context.snapshotPath);
  const current = await context.client.listRulesets();
  await restoreSnapshot(context.client, context.contract, snapshot, current);
}
