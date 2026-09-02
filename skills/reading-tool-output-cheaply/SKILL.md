---
name: reading-tool-output-cheaply
description: Use before any Bash, Read or fetch whose output could exceed a screen — trim at the source so a 60k-character result never becomes a permanent passenger in the context
---

# Reading tool output cheaply

A large tool result lands once, then rides along in every later turn until the session ends. One careless `cat` of a lockfile can cost more than the model's reasoning for the whole task.

## Habits

- **Shell**: `| head -50`, `| tail -50`, `| grep -n pattern`, `| wc -l` first when size is unknown. Never `cat` a lockfile, a bundle, a build log or a large JSON file.
- **Tests**: ask for the failing test only (`--reporter=dot`, `-x`, `grep -A20 FAIL`), not the whole run.
- **Files**: read by line range. Locate first (`grep -n`), then read the 40 lines around the match.
- **Web/API**: fetch with a question ("extract the pricing table") rather than the whole page.
- **Bulk**: anything over a handful of files goes to a subagent (see `delegate-bulk-reading`).

## Thresholds

If a single result would exceed roughly 10k tokens (about 40k characters), do not read it into the conversation. Trim it, write it to a file and read a slice, or delegate.

## After the fact

If a large result already landed, say so and offer `/compact` once the task that needed it is done.
