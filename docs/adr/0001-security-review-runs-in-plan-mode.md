# repo-security-hardening runs in plan mode and writes outside the repo

The skill enters plan mode as its first action and stays there until the user approves the selected
changes at stop 2, so the approval dialog of Claude Code is the start signal for implementation
and the read-only phases are held back by the harness, not only by a rule in the prompt. Plan mode
blocks file edits everywhere except the plan file, so every result of a run goes to a work dir
outside the reviewed repo (`~/security-reviews/<repo>/<YYYY-MM-DD>-<branch>/`) via shell writes,
once per phase to keep harness prompts few. The working mode (`report` or `implement`) is decided
only at stop 2. Without plan mode (declined, or the tool is unavailable) the skill does not run.

## Considered Options

- **Keep writing to `artifacts/` in the repo via the shell**: rejected, it contradicts plan mode and
  depends on classifier decisions and prompts.
- **Put everything into the plan file**: rejected, the plan file grows too large and raw data
  (SARIF, logs) is lost.
- **Fall back to the old flow without plan mode**: rejected, a run without the harness guarantee
  should not look like a normal run.

## Consequences

- In terminal sessions where bypass permissions are available, plan mode is instruction-only; the
  skill's ground rules remain the actual protection there.
- A run that ends with "proposals only" ends inside plan mode without `ExitPlanMode`; its results
  stay in the work dir.
