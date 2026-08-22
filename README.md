# Skills

Agent skills for Claude Code.

## Installation

```bash
npx skills add LordTyberias/Skills
```

## Included skills

| Skill | Purpose |
| --- | --- |
| [review-agents-setup](skills/review-agents-setup/SKILL.md) | Generates a mandatory pre-pull-request review loop tailored to the repository it runs in. |

### review-agents-setup

Run in the repository you want to protect. The skill first inspects the project — stack, module
manifests, rule documents, real build/test/lint commands, default branch, and any review setup that
already exists — asks about everything it cannot determine, and only then writes files whose rules
are quoted from that repository. Nothing is generic, and no existing file is overwritten without a
decision.

It installs one orchestrator command and three reviewer agents:

| File | Role |
| --- | --- |
| `.claude/commands/review-loop.md` | The orchestrator. Collects the full branch diff including uncommitted and untracked work, spawns every configured reviewer in parallel each iteration, parses their JSON verdicts, applies only justified fixes, runs the project's real verification commands, and repeats until every reviewer approves or the iteration limit is hit. It is the only participant allowed to change files or ask the user. |
| `.claude/agents/architect-reviewer.md` | Architecture and structure: module assignment of new code, dependency direction down to the manifest level, technology boundaries, established patterns, persistence boundaries, new dependencies, and the ADR obligation. Every finding must quote a real rule location; findings have no severity — they all block. |
| `.claude/agents/code-reviewer.md` | Correctness, readability, duplication, error handling, async and cancellation, logging, tests, documentation, migrations, and breaking changes — judged against the project's own documented conventions. Severities `must-fix` / `should-fix` / `nice-to-have`. |
| `.claude/agents/security-reviewer.md` | Secrets, sensitive data in logs, injection, path traversal, authentication and authorization gaps, TLS and crypto, unvalidated input, unsafe migration or restore behavior, insecure storage, and dependency risk — each finding naming a concrete attack path. `critical` and `high` block unconditionally. |

Two further reviewers are written only if you opt in:

| File | Role |
| --- | --- |
| `.claude/agents/performance-reviewer.md` | Structurally certain performance defects only — query patterns that scale with row count, work on the wrong thread, allocation growth in hot paths, unbounded concurrency. Every finding names the input that makes it hurt; speculative micro-optimization is not a finding. |
| `.claude/agents/requirements-reviewer.md` | Checks the diff against the specification it claims to implement: missing or contradicted specified behavior, quoting the document and section. Offered only when the repository actually has a binding specification to cite. |

The reviewers are read-only and cannot modify anything or talk to the user. Their scopes are kept
disjoint so two of them never demand opposite edits on the same line, and the loop declares two
explicit orders: authority (`security > architect > requirements > code > performance`) decides who
wins a contradiction, application (`architect → requirements → security → performance → code`)
decides the sequence fixes are applied in.

Finally the skill anchors the loop as a hard rule in the repository's `CLAUDE.md` — edited
surgically, never rewritten — so the next agent that opens the project cannot skip it: `/review-loop`
is mandatory before every pull request, the local agents may not be substituted by generic ones, and
security `critical` / `high` findings can never be waived.
