---
name: context-hygiene
description: Use on every task in a session longer than a few turns — keeps the conversation small so each turn stays cheap; when to compact, when to start fresh, what never to paste into context
---

# Context hygiene

Every turn resends the whole conversation. On a 500k-token session, each turn re-reads 500k tokens before it does any work. Keeping the context small is the single biggest lever on cost and on speed.

## Rules

- **Finish a task, then close the loop.** When a task is done and verified, offer the user `/compact` or a fresh session with a handoff (see the `handoff-between-sessions` skill) before starting the next one. Do not silently carry a finished investigation into the next task.
- **Never paste large outputs into the conversation.** Logs, lockfiles, build output, JSON dumps and generated files enter through tool results only when trimmed: `head`, `tail`, `grep`, line ranges, or a subagent's summary (see `reading-tool-output-cheaply`).
- **Read a file once.** After editing, re-read only the changed lines. Edit and Write already confirm their own result.
- **Prefer conclusions over transcripts.** When a subagent or a long command finishes, keep the conclusion and drop the raw material.
- **Say the size when it matters.** If the session has grown past roughly 200k tokens, tell the user once, with the per-turn consequence, and offer the two exits: compact, or handoff to a fresh session.

## What compaction keeps

Compaction keeps decisions, file paths touched, verified outcomes and open questions. It drops the exploration that produced them. Trigger it after milestones, not mid-investigation.

## Anti-patterns

- Continuing a 3,000-turn session "because the context is warm". Warm is cheaper than cold, but a fresh 10k-token session is cheaper than both.
- Re-running a whole test suite into the conversation to see one failure. Filter for the failing test.
- Reading a directory of files to "get oriented" when a `grep` or an Explore subagent would return the two lines that matter.
