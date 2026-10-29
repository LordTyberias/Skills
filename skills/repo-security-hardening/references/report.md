# Phase 8: Report, proposals, and final check

The report is what the user reads at the end and carries over into the ticket or planning. It must therefore be understandable without follow-up questions: what was checked, what was found, how bad it is, what to do, what remained open. Write concisely and factually, without promoting your own approach.

Contents: report structure, severities, findings table, proposal files, ticket comment, final check, chat output.

## Report structure (`artifacts/security-report.md`)

You already wrote sections 1 to 8 during the phases. Add at the top and bottom:

```
# Security report <repo name>
As of: <date> · Mode: <report|implement> · Branch: <branch> · HEAD at start/end: <short hash>

## Summary (10 lines)
## Findings table
## Recommended order
## Not checked
## Open points
## Deliberate decisions in the repo

(Sections 1 to 8 as written during the phases:
 1 GitHub · 2 Analyzers · 3 Dependencies · 4 Static analysis ·
 5 Secrets · 6 CI · 7 Attack surface · 8 Requirements for planned features)
```

Inactive modules do not appear as empty sections in the report, but as a single line under "Not checked" with the reason (e.g. "npm: no manifest", "secret history scan: not chosen").

## Severities

| Level | Meaning |
|---|---|
| critical | Exploitable without special preconditions with severe damage (code execution via a foreign file, exposed credentials with effect). Act immediately |
| high | Realistically exploitable with limited preconditions, or high damage when exploited |
| medium | Exploitation requires special circumstances, or the damage is limited |
| low | Hardening gap without a direct attack path |
| info | Note, hygiene, or deliberate decision with residual risk |

The rating depends on the **data path**: a weakness only reachable through your own trusted input is rated lower than the same weakness with data from foreign files, the network, or user input. Describe this path in the finding in one sentence.

## Findings table

One row per finding, sorted by severity, with sequential IDs `SEC-001`, `SEC-002`, ... Columns:

| ID | Title | Location (file:line) | Severity | Source (rule, tool, or manual) | Classification (real, false positive, unclear) | Effort S/M/L | Fix risk | Recommendation |
|---|---|---|---|---|---|---|---|---|

- The same cause in several places is one finding with several locations.
- False positives belong in the respective phase section with a justification, not in the findings table.
- "Fix risk" means the regression risk of the change (patch update, minor, breaking change, behavior change).

## Recommended order

Sort by severity, then by effort (cheap measures with high impact first). Name dependencies between measures (e.g. fix findings first, then lock in the rule as an error).

## Proposal files (`artifacts/proposals/`)

Create only what applies:

| File | Content |
|---|---|
| `Directory.Build.props.snippet` | NuGet audit settings, `AnalysisLevel` and `AnalysisModeSecurity` |
| `analyzer-rules.md` | Rules, justification, number of findings, starting severity, collisions with convention tests |
| `BannedSymbols.additions.txt` | Text proposals for banned APIs |
| `global.json` | SDK pin proposal |
| `dependabot.proposed.yml` | Extended Dependabot configuration |
| `ci-sast.md` | Sketch of a PR check with code scanning |
| `follow-up-tickets.md` | Proposals for separate tickets including SEC requirements from phase 7 |
| `ticket-comment.md` (in the `artifacts/` folder) | Draft, see below |

Each proposal states what it does, what it may cost, and how to verify it. Proposals change nothing in the repo; they are files.

## Ticket comment (`artifacts/ticket-comment.md`)

Draft for the ticket belonging to this review, in the ticket's language, at most 25 lines: what was checked, number of findings by severity, the three most important findings, recommended next steps, pointer to the report. **No host names, customer names, paths containing user names, or secrets.** The skill posts nothing itself.

## Final check

1. Search **all** files under `artifacts/` for secret patterns: the pattern from `Hide-Secrets`, token formats (long Base64 or hex strings, `ghp_`, `sk-`, `AKIA`, `-----BEGIN`), credentials in URLs. Clean up hits and check again. Report the result in the chat in one sentence.
2. Compare `git log -3 --oneline` and `git status --short` with the state from phase 0. Name deviations (new commits from a parallel session).
3. Update `artifacts/security-state.md` (phase 8 done).

## Chat output at the end

At most 20 lines: number of findings by severity, the three most important, notes on unchecked areas, paths of the report, proposals, and ticket draft, result of the final check. Then stop 2 from `SKILL.md`.

For reports you pass on or recommend sharing: point out that they may contain internal information (product, customer, and host names, feed URLs) that should be redacted before sharing outside the team.
