# Protected Main Governance Rollout

This repository contains a typed Node.js 22 CLI that reconciles a deliberately narrow set of
GitHub repository rulesets with the tracked `governance-contract.json`. The contract protects the
actual default branch, requires pull requests, requires the named CI checks to pass against a
current head, resolves review conversations, keeps history linear, and blocks force pushes and
branch deletion.

## Requirements

- Node.js 22 and npm 10 or newer
- Git 2.40 or newer
- an `origin` using credential-free GitHub HTTPS or SSH syntax
- a GitHub token supplied through a local file at runtime

Install the lockfile-pinned development dependencies with `npm ci`.

## Managed scope and safety boundary

Only repository rulesets whose names begin with the contract's `managedNamePrefix` are managed.
Rulesets outside that namespace are read and reported but never created, updated, deleted, or
restored. The CLI does not change repository visibility, the default branch, collaborators,
organization membership, Actions permissions, secrets, variables, environments, webhooks, deploy
keys, issue settings, or any other repository setting.

The contract is validated before remote access. Validation rejects unknown keys, unsupported
versions and rule types, duplicate managed names, conflicting branch policies, malformed or
wildcard selectors, empty or duplicate check names, invalid bypass actors, and unsupported merge
methods. The tracked contract currently permits only squash merging and declares no bypass actor.

## Commands

```text
npm run policy -- plan
npm run policy -- apply
npm run policy -- verify
npm run policy -- restore
```

`plan` is read-only with respect to GitHub. It inspects repository metadata, the actual default
branch head, every repository ruleset (following pagination), and check runs observed on the
default branch. It writes deterministic `artifacts/governance-plan.json` and
`artifacts/governance-plan.md`. Unchanged local and remote input produces byte-identical output;
artifacts contain no timestamps, request identifiers, absolute local paths, headers, tokens, or
remote error bodies.

`apply` calculates minimum changes and writes only contract-managed rulesets. Before its first
remote policy write it creates a mode-`0600` recovery snapshot at
`artifacts/recovery-snapshot.json`. It creates or updates and independently reads back every
replacement before deleting an obsolete or duplicate managed ruleset. A replacement that cannot
be verified is removed or rolled back while the last verified managed state is retained. A
successful repeated apply makes no policy write, deletion, or duplicate.

`verify` is read-only. It exits unsuccessfully if the default branch differs from the contract, a
required check has not been observed, a managed rule differs, an obsolete managed ruleset remains,
or a duplicate managed rule exists.

`restore` validates the local snapshot schema, repository identity, managed prefix, and every
recorded ruleset before writing. It restores only the managed rulesets recorded in that snapshot,
verifies restored replacements before cleanup, and leaves unmanaged rulesets and repository
settings untouched. Restore is for an actual failed rollout; it is not a routine post-deployment
demonstration.

## Recovery procedure

1. Stop other governance writers and retain `artifacts/recovery-snapshot.json` locally.
2. Run `npm run policy -- plan` and inspect the managed-only change set.
3. If the rollout must be reversed, run `npm run policy -- restore` from the same credential-free
   clone and contract.
4. Inspect live managed rulesets and run `npm run policy -- verify` only when the tracked contract
   is again intended to be authoritative.

An existing snapshot is never overwritten. A rerun may reuse it only when its repository identity
and managed prefix match. Missing, malformed, expanded-scope, duplicate, or cross-repository
snapshots are rejected.

## Credential handling and permissions

The CLI reads and trims a token from `GITHUB_TOKEN_FILE`, defaulting to
`~/.config/agent-eval/github-governance-token.txt`. The token is held only in process memory. Never
put it in a remote URL, command argument, Git configuration, credential helper configuration,
artifact, snapshot, log, commit, or generated file. Remote response details are bounded and
secret-like values are redacted.

For planning and verification, the credential needs read access to repository metadata, rulesets,
branches, Actions check runs, and contents. Applying or restoring additionally needs repository
administration permission to create, update, and delete repository rulesets. Publishing and the
protected pull-request workflow are separate operator actions that require permission to create
the tester-owned repository, push contents, manage pull requests, read checks, and merge with the
contract-allowed method. The tool does not request broader scopes or modify authentication state.

## Failure handling and limitations

HTTP requests have timeouts and bounded retries for network failures, transient server errors, and
rate limits, including valid `Retry-After` values. Permanent authentication and validation failures
are not retried indefinitely. A failure while deleting an obsolete policy can leave both the
verified replacement and obsolete policy active; this is intentionally safer than leaving the
default branch unprotected, and a later `apply` removes only the remaining managed drift.

Required check discovery uses check runs already observed on the default branch. A newly configured
workflow must run at least once before `apply`. The CLI cannot repair a missing workflow, change the
repository default branch, or reconcile settings outside managed rulesets.

## Development

```text
npm run format:check
npm run lint
npm run typecheck
npm test
npm run coverage
npm run package:check
```

Tests use mocked GitHub transports and temporary local repositories. They do not read the live
token or write live GitHub state. Coverage thresholds are enforced by the existing Vitest
configuration.
