#!/usr/bin/env node
// ReadyClaw guard (plugin copy). Two jobs, no dependencies:
//  1. Context: when the live session has grown past the threshold, tell the model so it
//     can offer /compact or a fresh session.
//  2. Secrets: stop credentials leaving the machine. A prompt, a Bash command or a file
//     write that carries an API key / token / private key is blocked with a reason, before
//     it reaches the model. Mode via READYCLAW_GUARD_SECRETS=block|warn|off (default block).
// Never rewrites anything; the user can resend with the value replaced by an env reference.
import { readFileSync, openSync, readSync, fstatSync, closeSync } from "node:fs";
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

const describe = (found) => found.slice(0, 3).map((f) => `${f.label} (${f.masked})`).join(", ") + (found.length > 3 ? ` and ${found.length - 3} more` : "");

function main() {
  const event = process.argv[2] || "";
  let input = {};
  try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
  const emit = (o) => process.stdout.write(JSON.stringify(o));

  if (event === "session-start") {
    emit({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext:
      "ReadyClaw guard is on. Keep tool output small (head/tail/grep, line ranges, subagents for bulk reading), read each file once, never print or paste credentials (reference env var names instead), and offer /compact or a fresh session with a handoff when a task finishes." } });
  } else if (event === "prompt") {
    const found = SECRETS_MODE === "off" ? [] : findSecrets(String(input.prompt || ""));
    if (found.length && SECRETS_MODE === "block") {
      emit({ decision: "block", reason: `ReadyClaw guard blocked this prompt: it contains ${describe(found)}. It was not sent. Rotate the credential if it is real, then resend with the value replaced by an env reference (e.g. $STRIPE_KEY). Set READYCLAW_GUARD_SECRETS=warn to only be warned.` });
      return;
    }
    const notes = [];
    if (found.length) notes.push(`ReadyClaw guard: the prompt contains ${describe(found)}. Do not echo it, do not write it to any file, and tell the user to rotate it and use an env reference instead.`);
    const ctx = input.transcript_path ? lastContext(input.transcript_path) : 0;
    if (ctx > THRESHOLD) {
      const k = Math.round(ctx / 1000);
      notes.push("ReadyClaw guard: this session's context is about " + k + "k tokens, above the " + Math.round(THRESHOLD / 1000) + "k threshold. Every turn re-reads all of it. Before continuing, tell the user the size and offer to run /compact or to start a fresh session from a short handoff (/handoff); then proceed with their request.");
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
