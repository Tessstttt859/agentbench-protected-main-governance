# Protected Main Governance Rollout

This repository contains a typed Node.js CLI for reconciling a narrowly owned set of GitHub
repository rulesets with `governance-contract.json`. It was recovered from an interrupted rollout;
the checked-in implementation is incomplete and the supplied tests describe the required safety
boundary.

## Requirements

- Node.js 22
- npm 10 or newer
- Git 2.40 or newer
- a credential-free HTTPS or SSH `origin` URL

Install dependencies with `npm ci`.

## Commands

```text
npm run policy -- plan
npm run policy -- apply
npm run policy -- verify
npm run policy -- restore
```

`plan` writes a JSON plan and a Markdown summary under `artifacts/`. `apply` reconciles only
rulesets whose names begin with the configured managed prefix. `verify` compares live managed state
to the contract. `restore` uses a validated pre-change snapshot when a rollout must be recovered.

The CLI reads a token at runtime from `GITHUB_TOKEN_FILE`, defaulting to
`~/.config/agent-eval/github-governance-token.txt`. Token material must never appear in remotes,
generated artifacts, logs, snapshots, or error output.

## Development

```text
npm run format:check
npm run lint
npm run typecheck
npm test
npm run coverage
npm run package:check
```

Tests use fake GitHub transports and temporary repositories. They must not read a live token or
write live GitHub state.

## Managed scope

The contract owns only rulesets matching `managedNamePrefix`. Repository visibility,
collaborators, organization membership, Actions permissions, secrets, variables, environments,
webhooks, deploy keys, issue settings, and unmanaged rulesets are outside its scope.

The recovery snapshot is a local operational artifact and is intentionally ignored by Git. It must
contain no credential, authorization header, absolute local path, or unredacted remote response.
