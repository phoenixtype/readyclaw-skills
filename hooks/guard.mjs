#!/usr/bin/env node
// ReadyClaw guard (plugin copy). Reads the hook event on stdin and, when the live
// session has grown past the threshold, tells the model so it can offer /compact or a
// fresh session. Never blocks, never rewrites anything. No dependencies.
import { readFileSync, openSync, readSync, fstatSync, closeSync } from "node:fs";

const THRESHOLD = Number(process.env.READYCLAW_GUARD_THRESHOLD || 200000);
const event = process.argv[2] || "";

function lastContext(transcriptPath) {
  let fd;
  try {
    fd = openSync(transcriptPath, "r");
    const size = fstatSync(fd).size;
    const len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    for (const line of buf.toString("utf8").split("\n").reverse()) {
      if (!line.includes('"assistant"')) continue;
      try {
        const o = JSON.parse(line);
        const u = o && o.message && o.message.usage;
        if (u) return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      } catch {}
    }
  } catch {} finally { if (fd !== undefined) closeSync(fd); }
  return 0;
}

let input = {};
try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}

if (event === "session-start") {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext:
    "ReadyClaw guard is on. Keep tool output small (head/tail/grep, line ranges, subagents for bulk reading), read each file once, and offer /compact or a fresh session with a handoff when a task finishes." } }));
} else if (event === "prompt") {
  const ctx = input.transcript_path ? lastContext(input.transcript_path) : 0;
  if (ctx > THRESHOLD) {
    const k = Math.round(ctx / 1000);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext:
      "ReadyClaw guard: this session's context is about " + k + "k tokens, above the " + Math.round(THRESHOLD / 1000) + "k threshold. Every turn re-reads all of it. Before continuing, tell the user the size and offer to run /compact or to start a fresh session from a short handoff (/handoff); then proceed with their request." } }));
  }
}
process.exit(0);
