# readyclaw — the Claude Code plugin

Skills, commands and a guard that cut token spend in Claude Code. Companion to [readyclaw.app](https://readyclaw.app), which measures the effect.

## Install

```
/plugin marketplace add phoenixtype/readyclaw-skills
/plugin install readyclaw@readyclaw
```

Or without the marketplace, copy any `skills/<name>/SKILL.md` into `~/.claude/skills/<name>/SKILL.md`. The CLI does this for you: `npx readyclaw toolkit install context-hygiene`.

## What's inside

| Piece | What it does |
|---|---|
| `context-hygiene` skill | Keeps the conversation small: when to compact, when to start fresh, what never to paste |
| `handoff-between-sessions` skill + `/handoff` | Writes HANDOFF.md so the next session starts at 10k tokens instead of 500k |
| `delegate-bulk-reading` skill | Sends sweeps and mechanical loops to a subagent on a cheaper model; only the conclusion comes back |
| `reading-tool-output-cheaply` skill | Trims tool output at the source so it never becomes a permanent passenger |
| `model-per-task` skill | The cheapest model that does the job; top tier for design, review, hard debugging |
| `/headroom` command | Runs the local ReadyClaw scan and shows where the tokens went |
| Guard hooks | Briefs the model at session start; past 200k tokens, asks it to offer /compact or a handoff before continuing. Blocks a prompt, a Bash command or a file write that carries a credential (API key, token, private key, database URL with password) and says why, so you can rotate it and resend with an env reference instead. Never rewrites anything |

Set `READYCLAW_GUARD_THRESHOLD` (tokens) to change the context guard's trigger. Set `READYCLAW_GUARD_SECRETS` to `block` (default), `warn` or `off` to change how the credential check responds. The hooks are plain Node with no dependencies.

## Privacy

The plugin reads the current session's transcript tail to compute its size, and scans each prompt, Bash command and file write for credential-shaped values before they reach the model. Matches are reported masked. Nothing leaves the machine. MIT licensed.
