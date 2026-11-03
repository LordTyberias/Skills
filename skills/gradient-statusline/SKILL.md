---
name: gradient-statusline
description: Installs or adjusts a two-line truecolor Claude Code status line — gradient bars for context, 5-hour and weekly usage with reset times, model and effort level, repo, branch, changed lines and cost — with labels in the user's language and a user-chosen order of segments in the top and bottom row. Adapts an existing status line instead of silently replacing it. Use when the user wants this status line, wants to change its language or segment order, or invokes /gradient-statusline.
---

You install the status line script that ships next to this file (`statusline-command.sh`) for the
user, or adjust the copy they already have. Only the config block of the script changes per user;
everything below `# --- end config ---` is copied unchanged.

## What the status line shows

Two rows of segments, joined by a dim `|`. Default layout:

```text
top:    model  context  session  weekly
bottom: repo   branch   lines    cost
```

| Segment | Shows |
| --- | --- |
| `model` | `🤖 Model: <name> · 🧠 <effort>`; the effort part only when an effort level is set |
| `context` | `📊` context window usage as a 20-cell gradient bar, emoji and percentage |
| `session` | 5-hour rate limit as a bar with `↻ <reset time>`, or `n/a` when the plan reports none |
| `weekly` | 7-day rate limit, same format |
| `repo` | `📁 <repo name>`, or the project folder name outside a repo |
| `branch` | `🌿 (<branch>)`, or the "no branch" label |
| `lines` | `+added/-removed` this session; hidden while both are 0 |
| `cost` | `💰 $<session cost>` |

Reset times show `HH:MM` when the reset is today, otherwise `<weekday> HH:MM`. If the optional
`effort-statusline-bridge` plugin is installed, the effort shows the level auto-effort-picker holds
as `<level> (auto)`; without it the script falls back to the menu level.

## Step 1 — Prerequisites

Check that `bash`, `node`, `awk` and `git` are available. On Windows, bash means Git Bash: use
`C:\Program Files\Git\bin\bash.exe` if it exists, otherwise derive it from the location of `git.exe`
(`<Git>\cmd\git.exe` → `<Git>\bin\bash.exe`). Never use `C:\Windows\System32\bash.exe` — that is WSL
and cannot run the script against Windows paths. If something is missing, tell the user what and
stop.

## Step 2 — Find the existing status line

Read the `statusLine` entry from every settings file that can set it, highest priority first:
`.claude/settings.local.json` and `.claude/settings.json` in the current project, then
`~/.claude/settings.json`. Note which file wins. Then classify:

- **None** — no `statusLine` anywhere.
- **This one** — the command runs a script that contains both `# --- config ---` and `seg_model`.
  Read its config block; its current values are the starting point for Step 3.
- **Foreign** — anything else. Read the script (or the inline command) and summarize in one or two
  sentences what it shows today, so the user knows what they would give up.

If a project settings file sets the winning `statusLine`, tell the user: the change below goes to
the user settings, and that project would keep showing its own status line unless they also want
it changed there.

## Step 3 — Ask for language and layout

Determine the language: the `language` field in `~/.claude/settings.json` if set, otherwise the
language the user writes in. On a re-run (**This one**), the current labels are the default.

Ask everything in **one** `AskUserQuestion` round:

1. Language — only if it could not be determined or the user hinted at another one. Offer the
   detected language first.
2. Layout — show the current layout (default layout for a new install) and the segment list from the
   table above. Options: keep it (recommended), swap top and bottom row, or describe changes in free
   text (reorder, move segments between rows, hide segments, put everything in one row).
3. **Foreign** only — what happens to their current status line, as a multiple choice:
   - **Back up and replace (recommended)** — the old script is saved as described in Step 5 and the
     old `statusLine` value is kept for the report, so it can be restored.
   - **Overwrite** — the old script is overwritten without a backup.

   If they answer with something else (e.g. cancel), stop without changing anything.

## Step 4 — Fill the config block

Start from `statusline-command.sh` next to this file (on a re-run you may keep the installed copy's
body only if it is identical; otherwise take the shipped one). Set the config block:

| Variable | Content |
| --- | --- |
| `TOP`, `BOTTOM` | Space-separated segment names in display order. A segment may appear in at most one row; leave one row `""` for a single-line status line. |
| `L_MODEL` | Word for "Model" (rendered as `<L_MODEL>: <name>`) |
| `L_SESSION` | Short label for the 5-hour window (rendered as `<L_SESSION>:`) |
| `L_WEEKLY` | Short label for the 7-day window |
| `L_NO_BRANCH` | Shown in parentheses when the folder is not a git repo |
| `L_NA` | Shown when a rate limit is not reported |
| `DAYS` | Seven weekday abbreviations, Sunday first, space-separated, each without spaces |

Translate the labels yourself, short and natural for a status line; terms that are usually left in
English in that language may stay English. Example, German: `Model`, `5-Stunden`, `Woche`,
`no branch`, `n/a`, `So Mo Di Mi Do Fr Sa`. Keep emoji, colors and the `$` cost format unchanged. Values sit inside
double quotes: do not use `"`, `$`, `` ` `` or `\` in them.

## Step 5 — Install

1. Target script: `~/.claude/statusline-command.sh`. If the user chose **Back up and replace** and
   a file exists there that is not this status line, copy it to
   `~/.claude/statusline-command.sh.bak-<YYYYMMDD-HHMMSS>` first. With **Overwrite**, no copy is
   made. A **Foreign** script at another path is left in place either way; only the settings entry
   stops pointing at it.
2. Write the filled script there with LF line endings.
3. In `~/.claude/settings.json`, set only the `statusLine` key — keep every other key untouched:
   - Windows: `{"type": "command", "command": "\"<Git Bash path>\" ~/.claude/statusline-command.sh"}`
     (JSON-escaped backslashes, e.g. `"\"C:\\Program Files\\Git\\bin\\bash.exe\" ~/.claude/statusline-command.sh"`)
   - macOS/Linux: `{"type": "command", "command": "bash ~/.claude/statusline-command.sh"}`

   On a re-run where the entry already points at the script, leave settings alone.

## Step 6 — Verify and report

Pipe a sample status line JSON through the installed script with the same bash the settings use:

```json
{"workspace":{"repo":{"name":"demo"},"project_dir":"."},"context_window":{"used_percentage":42},
 "rate_limits":{"five_hour":{"used_percentage":12,"resets_at":<now + 1 h, unix seconds>},
 "seven_day":{"used_percentage":88,"resets_at":<now + 3 days>}},"cost":{"total_cost_usd":1.23,
 "total_lines_added":10,"total_lines_removed":3},"model":{"display_name":"Opus"},
 "effort":{"level":"high"},"session_id":"test"}
```

It must exit 0 and print one line per non-empty row, with the translated labels, the segments in the
chosen order, and a weekday before the weekly reset time. Fix any failure before reporting.

Report in the user's language: the final layout, the language, the files written, and that the new
status line appears with the next update of Claude Code's status bar. To change language or layout
later, they run this skill again.

If the user chose **Back up and replace**, end the report with a short "How to get your old status
line back" section containing the concrete values from this run, not placeholders:

1. Where the old script is now: the backup path, or — if it lived elsewhere — its unchanged path.
2. If a backup was made, the command to put it back, for the user's shell, e.g.
   `cp ~/.claude/statusline-command.sh.bak-20261103-142501 ~/.claude/statusline-command.sh`
   (PowerShell: `Copy-Item "$HOME\.claude\statusline-command.sh.bak-20261103-142501" "$HOME\.claude\statusline-command.sh" -Force`).
3. The previous `statusLine` value as a ready-to-paste JSON snippet, and the settings file to paste
   it into (replacing the current `statusLine` key).
4. That they can also simply ask Claude to restore it from that backup.
