# Phases 2 and 5: GitHub, workflows, Dependabot, secret scan

Parts A and C belong to phase 2, part B to phase 5. Results in sections "1 GitHub", "5 Secrets", and "6 CI" of `<work>/security-report.md`.

Contents: A GitHub security status, B secret scan, C workflows and Dependabot.

## A. GitHub security status (read-only, `gh` with GET)

Active when the remote points to github.com and `gh` is present and logged in. Derive owner and repo from `git remote get-url origin` (never output credentials in the URL). Write calls are off limits. All output through `Hide-Secrets`.

Queries (endpoints under `repos/{owner}/{repo}/`):

- `dependabot/alerts?state=open`, `code-scanning/alerts?state=open`, `secret-scanning/alerts?state=open`: count by severity. For secret scanning, never output values.
- Whether Dependabot alerts, secret scanning, code scanning, and push protection are active (repo property `security_and_analysis`, as far as readable).
- `branches/{branch}/protection` for the default and main branch: required reviews, status checks, force push.
- `actions/permissions/workflow`: default workflow permissions (read or write).

HTTP 403 or 404 are a result (missing permissions or feature not available for the plan), not an error. Note them as such. The result helps decide whether a code scanning proposal (CodeQL) is an option: for private repos it requires a license depending on the plan. Do not test this by trying with write access.

## B. Secret scan (phase 5)

Always active. The scan has two parts: a targeted check of known locations, and a tool across history and working tree.

### B1. Tool

Check whether `gitleaks` or `trufflehog` is available locally. If neither is, the choice was already made at stop 1. Possible options: Docker image (if Docker is present), `winget` install, binary from the official release into `<work>/tools/`, `detect-secrets` via `uvx` (working tree only, no history), or skipping the history scan. Install or download nothing without the consent given there.

### B2. Configuration

Create `<work>/gitleaks.toml` (`useDefault = true`) with an allowlist for `bin/`, `obj/`, `node_modules/`, local cache folders, the checked-in minified bundle (false hits), and `.claude/settings.local.json`. Note in the report that this file is deliberately excluded because it is known to possibly contain local credentials.

### B3. Run with Docker (example, repo mounted read-only)

```powershell
# History
docker run --rm -v "${PWD}:/repo:ro" -v "${work}:/out" zricethezav/gitleaks:latest `
  git /repo --config /out/gitleaks.toml --redact --report-format sarif --report-path /out/gitleaks-history.sarif
# Working tree including untracked files
docker run --rm -v "${PWD}:/repo:ro" -v "${work}:/out" zricethezav/gitleaks:latest `
  dir /repo --config /out/gitleaks.toml --redact --report-format sarif --report-path /out/gitleaks-worktree.sarif
```

If the installed version does not know the `git` and `dir` subcommands, use `detect` and note the deviation. For large histories (thousands of commits) the run can take several minutes; that was in the plan. With a local binary the same options apply. `--redact` is mandatory.

### B4. Evaluation

- Per finding: file, short commit hash, rule, tracked or untracked, presumed kind (real key, test value, example). **No values.**
- Also check, without reading file contents: `git log --all --diff-filter=A --name-only` for paths that point to `.env`, keystores, certificates, provisioning profiles, or `.claude/`.
- For real findings, a recommendation to the user (rotate keys, clean up history if needed). **Rotate nothing, never rewrite history.**
- **Deliberately shipped credentials:** if `CLAUDE.md`, `ai-doc/`, or ADRs document deliberately shipped client credentials, match the secret assignment locations from the inventory against them without outputting values. Classification per location: shipped deliberately per docs, not in the docs, unclear. Assess whether these credentials are technically intended as non-secret (e.g. a public OAuth client) and whether PKCE is used.
- **Local token files.** If, per the inventory, `.claude/settings.local.json` contains a token (not versioned), that is not a repo finding, but a note: every tool that scans, copies, or uploads the working folder sees it. Recommendation: create a new token with minimal permissions and keep it as a user environment variable instead of in a file in the working folder. If the same token appears in several repos, rotate it once.

## C. Workflows and Dependabot (phase 2)

### C1. Workflows (active for `.github/workflows/`)

Read every workflow file and check:

- Triggers: `pull_request` versus `pull_request_target` (the latter with access to secrets is risky), manual triggers.
- `permissions`: least privilege, default permissions of the repo (part A).
- Secrets: where are they used (e.g. signing certificate in release), how are they passed, do they end up in logs?
- Script injection: expressions like `${{ github.event.* }}` directly in `run:` steps.
- Actions: pinned by commit SHA or only by tag? Name unpinned actions.
- Self-hosted runners: isolation, access to secrets, whether PRs from forks can run.
- Does the release workflow run outside code (downloaded scripts without hash verification)?

If `zizmor` is present or the `uvx` call was allowed at stop 1, run it over the workflows. Otherwise only the manual review. A pure structure or encoding check in CI is not a security check and is not counted as one in the report.

### C2. Dependabot

1. Check the current GitHub docs (name the source) for how Dependabot is configured for the repo's ecosystem: for NuGet with Central Package Management, with `packages.config`, with a **private feed** (`registries` section, secrets in the Dependabot settings). Whether and how the private feed is reached is often unresolved and belongs in the open points.
2. Evaluate an existing `.github/dependabot.yml`: ecosystems, directories (does it cover all projects?), schedule, `cooldown`, groups.
3. Put the proposal into `<work>/proposals/dependabot.proposed.yml`. Keep the existing configuration (including `cooldown`) and extend it: `github-actions` (only if workflows exist), missing directories, sensible groups (vendor suites, Microsoft packages, test packages, platform packages like MAUI/AndroidX), `ignore` entries for deliberate pins. Without an existing file, it is a new proposal.
4. Note in the report: Dependabot must be enabled in the repo's GitHub settings; only the user can do that. If there is no CI, Dependabot PRs are verified locally with the repo's gate.
5. Sketch `<work>/proposals/ci-sast.md`: concept for a PR check with code scanning (CodeQL or Semgrep), depending on part A (license). Concept only, no workflow file in the repo. If the repo deliberately has no CI, phrase the sketch as an option and leave the decision to the team.
