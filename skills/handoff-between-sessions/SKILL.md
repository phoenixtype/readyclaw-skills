---
name: handoff-between-sessions
description: Use when a task is finished, when a session has grown past ~200k tokens, or when work will pause for more than an hour — write a short handoff so the next session starts at 10k tokens instead of 500k
---

# Handoff between sessions

A fresh session with a good handoff does the next task faster and far cheaper than a giant session resumed. Resuming after more than an hour also rewrites the whole context at the cache-write rate.

## The handoff note

Write it to `HANDOFF.md` at the repo root (or the path the user prefers), then tell the user to start a new session with "Read HANDOFF.md and continue". Keep it under 40 lines:

```
# Handoff — <date>

## Done (verified)
- <what changed, where, how it was verified: command + result>

## In progress
- <the one thing mid-flight, and its exact next step>

## Decisions
- <decisions made and why, so they are not relitigated>

## Open questions / blockers
- <anything waiting on the user>

## Useful context
- <commands, URLs, ids the next session will need; no secrets>
```

## Rules

- Facts only, no narrative. Verified outcomes are marked verified; guesses are marked as such.
- Never include secrets, tokens or credentials. Name where they live instead.
- Delete stale sections when a later handoff supersedes them; the file is the current state, not a diary.
- Offer the handoff unprompted when the session passes about 200k tokens or a milestone lands.
