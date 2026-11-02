# Privacy Policy: auto-effort-picker

Last updated: 2026-11-02

auto-effort-picker is a Claude Code plugin by Benjamin Strecker. It picks the effort level for each
prompt. This policy describes what data it handles.

## What it reads

- The text of each prompt you send in the main chat.
- The first and last 300 characters of Claude's previous reply, for context.
- For `/ticket` and `/repo-security-hardening` runs: the ticket text returned by the YouTrack tool and
  the plan approved with `ExitPlanMode`.
- `~/.claude/mods/switches.json`, to know whether the plugin is turned off in `/mods`.

These texts may contain personal data if you put it into your prompts or tickets.

## Where it sends data

The texts above are sent only to Claude (the Sonnet model), through Claude Code's own model call, to
choose an effort level. The plugin has no server of its own and sends nothing to any third party.
Anthropic's handling of that model call is covered by Anthropic's own terms and privacy policy.

## What it stores

The plugin keeps a log in its own storage inside Claude Code on your computer: the chosen levels, a
short reason for each pick, errors, and, for short approvals, the first 40 characters of the prompt.
The log is capped at the last 20 KB; older entries are overwritten. It never leaves your computer and
you can read it with `/auto-effort-picker log`.

The plugin writes no files.

## Contact

Questions: open an issue at https://github.com/LordTyberias/Skills/issues.
