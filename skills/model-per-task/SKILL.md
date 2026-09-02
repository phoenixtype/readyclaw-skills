---
name: model-per-task
description: Use when starting a session or spawning a subagent — pick the cheapest model that can do the job and reserve the top tier for design, review and hard debugging
---

# Model per task

Price tiers are roughly an order of magnitude apart. A mechanical turn (run the tests, read the diff, apply the obvious fix) produces the same tool call on any of them.

## Split

- **Top tier** (Fable/Opus-class): architecture, a gnarly bug, a security review, a final review of a large change.
- **Mid tier** (Sonnet-class): the working loop — edits, test runs, refactors, ordinary features.
- **Cheap tier** (Haiku-class): searches, renames, summaries, formatting, extraction.

## Practice

- Open the session on the model the hardest part needs; hand the mechanical middle to subagents with an explicit model; come back to the top model to review.
- Say the model call in one line at the start of a task ("mid-tier work; delegating the sweep to a cheap subagent") so the user can override.
- Effort is a per-session dial: keep the global setting at medium and raise it for the hard session, not for every session.
- Watch for superseded pins in `~/.claude/settings.json` (`ANTHROPIC_DEFAULT_*_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`): an old default picks an older, sometimes pricier model on every tier switch.
