import postgres from "postgres";

/**
 * Research logging for guest chats — one row per user→assistant exchange.
 *
 * Feature-flagged by RESEARCH_DATABASE_URL: when unset, every call is a
 * no-op, so local dev and the public deployment are completely unaffected
 * until a database is wired up (Neon/Supabase/any Postgres — the driver is
 * serverless-safe with max:1 connections per lambda instance).
 *
 * Privacy posture: no IPs, no credentials, no cookies — just the
 * conversation content, an anonymous per-browser session id, the UI locale,
 * and a truncated user-agent for abuse triage. Text is length-capped so a
 * tampered client can't bloat rows.
 */

const sql = process.env.RESEARCH_DATABASE_URL
  ? postgres(process.env.RESEARCH_DATABASE_URL, { max: 1, idle_timeout: 20 })
  : null;

/** Runs once per lambda instance; creates the table if it doesn't exist. */
let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!sql) return Promise.resolve();
  schemaReady ??= sql`
    CREATE TABLE IF NOT EXISTS chat_logs (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      session_id TEXT,
      mode TEXT NOT NULL DEFAULT 'guest',
      locale TEXT,
      user_text TEXT NOT NULL,
      assistant_text TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      latency_ms INTEGER,
      user_agent TEXT
    )
  `.then(() => undefined);
  return schemaReady;
}

/** Pulls the last user message's text out of an incoming UIMessage array. */
export function extractLastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; parts?: Array<{ type: string; text?: string }> };
    if (m?.role !== "user" || !Array.isArray(m.parts)) continue;
    const text = m.parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

const MAX_TEXT = 8_000;

function cap(s: string | null | undefined, max = MAX_TEXT): string | null {
  if (typeof s !== "string" || s.length === 0) return null;
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

export type ChatExchange = {
  sessionId: string | null;
  mode: "public" | "local";
  locale: string | null;
  userText: string;
  assistantText: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  userAgent: string | null;
};

/** Fire-and-forget: logging failures must never break the chat stream. */
export async function logExchange(entry: ChatExchange): Promise<void> {
  if (!sql) return;
  try {
    await ensureSchema();
    await sql`
      INSERT INTO chat_logs
        (session_id, mode, locale, user_text, assistant_text,
         input_tokens, output_tokens, latency_ms, user_agent)
      VALUES (
        ${cap(entry.sessionId, 64)},
        ${entry.mode},
        ${cap(entry.locale, 8)},
        ${cap(entry.userText) ?? ""},
        ${cap(entry.assistantText)},
        ${entry.inputTokens},
        ${entry.outputTokens},
        ${entry.latencyMs},
        ${cap(entry.userAgent, 200)}
      )
    `;
  } catch (err) {
    console.error("[research] failed to log chat exchange:", err);
  }
}
