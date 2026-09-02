#!/usr/bin/env node
// ReadyClaw guard (plugin copy). Three jobs, no dependencies:
//  1. Advisor: read the tail of the live transcript on every prompt and tell the model
//     which Claude Code feature the moment calls for: /compact past the threshold, a fresh
//     session after a cold resume, an Explore subagent after bulk reading, line ranges
//     after re-reads, a Sonnet subagent for tool-only loops, plan mode for big asks.
//     Each note is rate-limited per session so it is said once, not every turn.
//  2. Secrets: stop credentials leaving the machine. A prompt, a Bash command or a file
//     write that carries an API key / token / private key is blocked with a reason, before
//     it reaches the model. Mode via READYCLAW_GUARD_SECRETS=block|warn|off (default block).
//  3. Session start: a short brief on context hygiene.
// Never rewrites anything; the user can resend with the value replaced by an env reference.
import { readFileSync, writeFileSync, mkdirSync, openSync, readSync, fstatSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const THRESHOLD = Number(process.env.READYCLAW_GUARD_THRESHOLD || 200000);
const SECRETS_MODE = (process.env.READYCLAW_GUARD_SECRETS || "block").toLowerCase();

// Mirrors SECRET_KINDS in cli/src/core/secrets.ts (test keeps them in sync).
export const SECRET_PATTERNS = [
  ["anthropic-api-key", "Anthropic API key", /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ["openai-api-key", "OpenAI API key", /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g],
  ["stripe-live-key", "Stripe live secret key", /\b[sr]k_live_[A-Za-z0-9]{16,}/g],
  ["stripe-test-key", "Stripe test key", /\b[sr]k_test_[A-Za-z0-9]{16,}/g],
  ["aws-access-key", "AWS access key id", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["github-token", "GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/g],
  ["gitlab-token", "GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}/g],
  ["slack-token", "Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ["google-api-key", "Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["supabase-access-token", "Supabase access token", /\bsbp_[a-f0-9]{40}\b/g],
  ["supabase-secret-key", "Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{20,}/g],
  ["resend-api-key", "Resend API key", /\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,}/g],
  ["npm-token", "npm token", /\bnpm_[A-Za-z0-9]{36}\b/g],
  ["sendgrid-key", "SendGrid API key", /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g],
  ["private-key", "Private key block", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/g],
  ["database-url", "Database URL with password", /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/@]+:[^@\s/]{4,}@[^\s"']+/g],
  ["jwt", "JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ["generic-secret", "Assigned secret", /\b(?:api[_-]?key|secret(?:_key)?|access[_-]?token|auth[_-]?token|password|passwd)\b["']?\s*[:=]\s*["']?([A-Za-z0-9_\-./+=]{16,})/gi],
];
const PLACEHOLDER = /(x{5,}|0{6,}|\*{4,}|example|placeholder|your[_-]?|changeme|<[^>]+>|\$\{|\bredacted\b|dummy|sample)/i;
// sha256 of Supabase's local-dev keys (public, identical everywhere); no key-shaped literal lives in this file.
const KNOWN_PUBLIC = new Set(["c85debb55f2f204d868cc1552c42faa143b4c675f61363ab040dd50b5b5304cd", "9705102db0d5f99ee08daa19a73e510d9877a2a9add9369da247cbbe6c2a0140"]);
const sha = (v) => createHash("sha256").update(v).digest("hex");
const LOCAL_DB = /:\/\/[^@]+@(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal|db|postgres|supabase_db[^:/]*)(:|\/|$)/;

function jwtLongLived(token) {
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (typeof p.exp === "number" && typeof p.iat === "number" && p.exp - p.iat < 48 * 3600) return false;
    if (p.iss === "supabase-demo" || p.role === "anon") return false;
    return p.role === "service_role" || typeof p.exp !== "number" || p.exp - Date.now() / 1000 > 30 * 86400;
  } catch { return false; }
}

/** [{id,label,masked}] for every credential-looking value in text. Placeholders are ignored. */
export function findSecrets(text) {
  const out = [];
  if (!text || text.length < 12) return out;
  const seen = new Set();
  for (const [id, label, re] of SECRET_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const v = m[1] || m[0];
      if (PLACEHOLDER.test(v) || KNOWN_PUBLIC.has(sha(v)) || seen.has(v)) continue;
      if (id === "generic-secret" && (/^[a-z_.-]+$/i.test(v) || /^(true|false|null|undefined|process\.env|eyJ|sb_publishable_|pk_(live|test)_)/i.test(v))) continue;
      if (id === "jwt" && !jwtLongLived(v)) continue;
      if (id === "database-url" && LOCAL_DB.test(v)) continue;
      seen.add(v);
      out.push({ id, label, masked: /^[a-z+]+:\/\//i.test(v) ? v.replace(/:\/\/([^:]+):[^@]+@/, (_m, u) => `://${u.length > 10 ? u.slice(0, 8) + "…" : u}:…@`).slice(0, 60) : v.length <= 12 ? v.slice(0, 3) + "…" : v.slice(0, 6) + "…" + v.slice(-3) });
    }
  }
  const specific = out.filter((o) => o.id !== "generic-secret");
  return specific.length ? specific : out;
}

/** The last 512KB of a transcript as parsed records (main conversation only), oldest first. */
function tailRecords(transcriptPath) {
  let fd;
  try {
    fd = openSync(transcriptPath, "r");
    const size = fstatSync(fd).size;
    const len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    if (len < size) lines.shift(); // a partial first line
    return parseRecords(lines);
  } catch { return []; } finally { if (fd !== undefined) closeSync(fd); }
}

/** JSONL lines to the shape the advisor reads. Exported for tests. */
export function parseRecords(lines) {
  const out = [];
  for (const line of lines) {
    if (!line || !(line.includes('"assistant"') || line.includes("tool_result"))) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || o.isSidechain === true || !o.message) continue;
    const ts = Date.parse(o.timestamp || "") || 0;
    const content = Array.isArray(o.message.content) ? o.message.content : [];
    if (o.type === "assistant" && o.message.usage) {
      const u = o.message.usage;
      out.push({
        type: "assistant", ts, model: String(o.message.model || ""),
        ctx: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
        hasText: content.some((b) => b && b.type === "text" && String(b.text || "").trim()),
        tools: content.filter((b) => b && b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, path: b.name === "Read" && b.input && typeof b.input.file_path === "string" ? b.input.file_path : null })),
      });
    } else if (o.type === "user") {
      let chars = 0;
      for (const b of content) {
        if (!b || b.type !== "tool_result") continue;
        if (typeof b.content === "string") chars += b.content.length;
        else if (Array.isArray(b.content)) for (const part of b.content) if (part && typeof part.text === "string") chars += part.text.length;
      }
      if (chars) out.push({ type: "result", ts, chars });
    }
  }
  return out;
}

const MINUTE = 60000;
// How long each piece of advice stays quiet after it is given, per session.
const COOLDOWN_MS = { compact: 10 * MINUTE, "cold-resume": 6 * 60 * MINUTE, "bulk-reading": 20 * MINUTE, reread: 20 * MINUTE, "mechanical-loop": 30 * MINUTE, "plan-mode": 24 * 60 * MINUTE };
const RECENT = 6;
const k = (n) => Math.round(n / 1000) + "k";

/**
 * Which Claude Code feature this moment calls for, from recent activity. Pure: takes the
 * parsed tail, the prompt and the per-session state, returns [{key, text}] (at most two)
 * plus the state to persist. Exported for tests.
 */
export function advise({ records, prompt = "", nowMs = Date.now(), threshold = THRESHOLD, state = {} }) {
  const notes = [];
  const next = { ...state };
  const due = (key) => !(next[key] && nowMs - next[key] < COOLDOWN_MS[key]);
  const say = (key, text) => { if (due(key) && notes.length < 2) { notes.push({ key, text: "ReadyClaw advisor: " + text }); next[key] = nowMs; } };

  const turns = records.filter((r) => r.type === "assistant");
  const last = turns[turns.length - 1];
  const ctx = last ? last.ctx : 0;
  const model = last ? last.model : "";
  const topTier = /opus|fable|mythos/.test(model);

  if (ctx > threshold) {
    say("compact", "this session's context is about " + k(ctx) + " tokens, above the " + k(threshold) + " threshold. Every turn re-reads all of it. Before continuing, tell the user the size and offer to run /compact or to start a fresh session from a short handoff (/handoff); then proceed with their request.");
  }
  if (last && last.ts && nowMs - last.ts > 60 * MINUTE && ctx > 100000) {
    const hours = Math.round((nowMs - last.ts) / (60 * MINUTE) * 10) / 10;
    say("cold-resume", "the session was idle for " + hours + "h, so the prompt cache is cold and this turn re-uploads about " + k(ctx) + " tokens at the write rate. If this prompt starts a new task, suggest a fresh session from a short handoff instead of continuing here.");
  }
  const recent = turns.slice(-RECENT);
  const recentIdx = records.indexOf(recent[0]);
  const recentResults = recentIdx >= 0 ? records.slice(recentIdx).filter((r) => r.type === "result") : [];
  const resultChars = recentResults.reduce((s, r) => s + r.chars, 0);
  const reads = recent.reduce((n, t) => n + t.tools.filter((x) => x.name === "Read").length, 0);
  if (resultChars > 40000 || reads >= 4) {
    say("bulk-reading", "the last " + recent.length + " turns pulled about " + k(resultChars / 4) + " tokens of tool output into context" + (reads ? " (" + reads + " Read calls)" : "") + ", and every later turn re-reads it. For bulk reading use an Explore subagent (Agent tool, subagent_type Explore) and keep only its summary; for the rest use head, tail, grep, or line ranges.");
  }
  const counts = new Map();
  for (const t of turns) for (const x of t.tools) if (x.path) counts.set(x.path, (counts.get(x.path) || 0) + 1);
  const rereads = [...counts].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
  if (rereads.length) {
    const [path, n] = rereads[0];
    say("reread", path.split("/").slice(-2).join("/") + " has been read " + n + " times this session and is already in context. After an edit, re-read only the changed line range; Edit and Write confirm their own result.");
  }
  const loop = turns.slice(-8);
  if (topTier && loop.length >= 6 && loop.every((t) => t.tools.length > 0 && !t.hasText)) {
    say("mechanical-loop", "the last " + loop.length + " turns were tool-only (an edit, run, fix loop) on " + model.replace("claude-", "") + ". That work costs the same on a cheaper model: hand the loop to a Sonnet subagent (Agent tool with model sonnet) or tell the user they can switch model for this stretch and come back to the top tier for design and review.");
  }
  const p = String(prompt);
  if (p.length >= 400 && /\b(implement|build|add|create|refactor|migrate|redesign|rewrite)\b/i.test(p) && ctx < 60000) {
    say("plan-mode", "this looks like multi-file work. Plan before touching code (EnterPlanMode, or the user can press shift+tab into plan mode) so exploration and decisions are settled before edits pile into the context.");
  }
  return { notes, state: next };
}

const STATE_FILE = join(homedir(), ".readyclaw", "advisor-state.json");
function readState(sessionId) {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8"))[sessionId] || {}; } catch { return {}; }
}
function writeState(sessionId, state) {
  try {
    let all = {};
    try { all = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {}
    all[sessionId] = state;
    // Keep the file small: the 40 most recently advised sessions.
    const ids = Object.keys(all).sort((a, b) => Math.max(0, ...Object.values(all[b])) - Math.max(0, ...Object.values(all[a]))).slice(0, 40);
    const kept = {};
    for (const id of ids) kept[id] = all[id];
    mkdirSync(join(homedir(), ".readyclaw"), { recursive: true, mode: 0o700 });
    writeFileSync(STATE_FILE, JSON.stringify(kept));
  } catch {}
}

const describe = (found) => found.slice(0, 3).map((f) => `${f.label} (${f.masked})`).join(", ") + (found.length > 3 ? ` and ${found.length - 3} more` : "");

function main() {
  const event = process.argv[2] || "";
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
  const emit = (o) => process.stdout.write(JSON.stringify(o));

  if (event === "session-start") {
    emit({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext:
      "ReadyClaw guard is on. Keep tool output small (head/tail/grep, line ranges, subagents for bulk reading), read each file once, never print or paste credentials (reference env var names instead), and offer /compact or a fresh session with a handoff when a task finishes. Notes prefixed 'ReadyClaw advisor:' arrive with some prompts; act on them and mention the suggestion to the user in one sentence." } });
  } else if (event === "prompt") {
    const found = SECRETS_MODE === "off" ? [] : findSecrets(String(input.prompt || ""));
    if (found.length && SECRETS_MODE === "block") {
      emit({ decision: "block", reason: `ReadyClaw guard blocked this prompt: it contains ${describe(found)}. It was not sent. Rotate the credential if it is real, then resend with the value replaced by an env reference (e.g. $STRIPE_KEY). Set READYCLAW_GUARD_SECRETS=warn to only be warned.` });
      return;
    }
    const notes = [];
    if (found.length) notes.push(`ReadyClaw guard: the prompt contains ${describe(found)}. Do not echo it, do not write it to any file, and tell the user to rotate it and use an env reference instead.`);
    if (input.transcript_path && process.env.READYCLAW_ADVISOR !== "off") {
      const sessionId = String(input.session_id || input.transcript_path);
      const { notes: advice, state } = advise({ records: tailRecords(input.transcript_path), prompt: String(input.prompt || ""), state: readState(sessionId) });
      if (advice.length) {
        for (const a of advice) notes.push(a.text);
        writeState(sessionId, state);
      }
    }
    if (notes.length) emit({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: notes.join("\n\n") } });
  } else if (event === "pre-tool") {
    if (SECRETS_MODE === "off") return;
    const ti = input.tool_input || {};
    const text = [ti.command, ti.content, ti.new_string].filter((s) => typeof s === "string").join("\n");
    const found = findSecrets(text);
    if (!found.length) return;
    const reason = `ReadyClaw guard: this ${input.tool_name || "tool"} call carries ${describe(found)}. Credentials must not be written into commands or files; load them from the environment (e.g. "$STRIPE_KEY", process.env.STRIPE_KEY) and tell the user to rotate the value if it is real.`;
    if (SECRETS_MODE === "block") emit({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
    else emit({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: reason } });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
  process.exit(0);
}
