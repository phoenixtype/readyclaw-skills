---
name: delegate-bulk-reading
description: Use whenever a task needs to read more than two or three files, sweep a directory, or run a long investigation — delegate to a subagent with an explicit cheaper model so only the conclusion enters the main context
---

# Delegate bulk reading

Ten files read in the main session are re-read on every later turn. Ten files read by a subagent cost ten reads once; only its report comes back.

## When to delegate

- Sweeping a codebase for usages, conventions or naming.
- Reading logs, test output, or generated files to find a specific fact.
- Comparing several implementations before choosing one.
- Any mechanical loop: run tests → read failure → apply the obvious fix, repeated.

## How to brief a subagent

State, in this order: the goal, the files or directories in scope, what a finished answer looks like (a list, a yes/no with evidence, a diff), and the model. Ask for a conclusion, not a dump. Run independent subagents in parallel.

## Model choice for the subagent

- Search, rename, formatting, summarising: the cheapest tier (Haiku-class).
- Ordinary coding and test-fix loops: the mid tier (Sonnet-class).
- Design decisions, security review, hard debugging: keep in the main session on the top model.

Check `CLAUDE_CODE_SUBAGENT_MODEL` in `~/.claude/settings.json`: a superseded model pinned there silently makes every subagent slower and more expensive. Point it at the current mid-tier model or remove it.
