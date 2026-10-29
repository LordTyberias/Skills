# Skills

A collection of agent skills. This glossary holds the terms the skills share or that would be
ambiguous without a fixed meaning.

## Language

### repo-security-hardening

**Plan mode**:
The Claude Code session state in which nothing but the plan file may be edited until the user
approves the plan. A run of the skill spans from its first action to the plan approval at stop 2.
_Avoid_: planning mode, read-only mode

**Working mode**:
The user's choice at stop 2 whether the selected changes are implemented (`implement`) or only
kept as proposals (`report`).
_Avoid_: mode (alone), run mode

**Work dir**:
The folder outside the reviewed repo that holds every result of a run: inventory, report,
progress file, raw data, and proposals.
_Avoid_: artifacts folder, output folder
