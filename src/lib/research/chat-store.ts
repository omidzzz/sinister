import { neon } from "@neondatabase/serverless";
import { GROQ_MODEL } from "@/lib/ai/provider";

/**
 * Research store for guest + local chats — a small relational schema so
 * conversations are reconstructable and sessions carry usable visitor data.
 *
 *   sessions  — one row per anonymous browser session (id is a UUID
 *               the widget keeps in localStorage). Stores what we can
 *               legitimately learn from the request: parsed OS/browser/device,
 *               geo (from Vercel's IP headers — never the raw IP), referrer,
 *               accept-language, screen size and entry path (sent by the UI).
 *   messages  — one row per turn (role = user|assistant), ordered by `seq`
 *               per session, so a full conversation can be replayed.
 *
 * Feature-flagged by RESEARCH_DATABASE_URL: when unset every call is a no-op,
 * so local dev / the public deployment are unaffected until a DB is wired up.
 *
 * Privacy posture: no raw IPs, no cookies, no credentials — only anonymous
 * session ids. Text and every free-form field are length-capped so a tampered
 * client can't bloat rows.
 */

const sql = process.env.RESEARCH_DATABASE_URL
  ? neon(process.env.RESEARCH_DATABASE_URL)
  : null;

/** Runs once per lambda instance; creates tables + indexes. */
let schemaReady: Promise<void> | null = null;
async function ensureSchemaImpl(): Promise<void> {
  if (!sql) return;
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id                  TEXT PRIMARY KEY,
      first_seen          TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen           TIMESTAMPTZ NOT NULL DEFAULT now(),
      mode                TEXT NOT NULL DEFAULT 'guest',
      locale              TEXT,
      browser             TEXT,
      os                  TEXT,
      device              TEXT,
      user_agent          TEXT,
      country             TEXT,
      region              TEXT,
      city                TEXT,
      referrer            TEXT,
      accept_language     TEXT,
      screen              TEXT,
      path                TEXT,
      message_count       INTEGER NOT NULL DEFAULT 0,
      total_input_tokens  INTEGER NOT NULL DEFAULT 0,
      total_output_tokens INTEGER NOT NULL DEFAULT 0
    )
  `;
  // Idempotent column additions for pre-existing tables (schema migrations).
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS accept_language TEXT`;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT`;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS screen TEXT`;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS path TEXT`;
  await sql`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS locale TEXT`;
  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id            BIGSERIAL PRIMARY KEY,
      session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq           INTEGER,
      role          TEXT,
      content       TEXT,
      mode          TEXT,
      locale        TEXT,
      model         TEXT,
      input_tokens  INTEGER,
      output_tokens INTEGER,
      latency_ms    INTEGER,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_last ON sessions(last_seen)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_country ON sessions(country)`;
  // Idempotent rating column for pre-existing messages tables.
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS rating INTEGER`;
}
function ensureSchema(): Promise<void> {
  schemaReady ??= ensureSchemaImpl();
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

/** Lightweight UA → browser / OS / device hints (no dependency). */
export function parseUserAgent(
  ua: string | null,
): { browser: string | null; os: string | null; device: string | null } {
  if (!ua) return { browser: null, os: null, device: null };
  const u = ua.toLowerCase();

  const os =
    /windows nt/.test(u) ? "Windows"
    : /mac os x|macintosh/.test(u) ? "macOS"
    : /iphone|ipod/.test(u) ? "iOS"
    : /ipad/.test(u) ? "iPadOS"
    : /android/.test(u) ? "Android"
    : /linux/.test(u) ? "Linux"
    : null;

  const browser =
    /edg\//.test(u) ? "Edge"
    : /opr\//.test(u) ? "Opera"
    : /chrome\//.test(u) ? "Chrome"
    : /firefox\//.test(u) ? "Firefox"
    : /safari\//.test(u) ? "Safari"
    : null;

  const device =
    /ipad|tablet/.test(u) ? "tablet"
    : /mobile|android|iphone|ipod/.test(u) ? "mobile"
    : "desktop";

  return { browser, os, device };
}

export type SessionProfile = {
  sessionId: string | null;
  mode: "public" | "local";
  locale: string | null;
  userAgent: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  referrer: string | null;
  acceptLanguage: string | null;
  screen: string | null;
  path: string | null;
};

export type ChatExchange = SessionProfile & {
  userText: string;
  assistantText: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
};

/** A visitor's quality signal on the most recent assistant reply. */
export type MessageRating = {
  sessionId: string;
  rating: 1 | -1;
};

export function normalizeSessionId(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** Upsert an anonymous session, then write the user → assistant pair. */
export async function logExchange(entry: ChatExchange): Promise<void> {
  if (!sql) return;
  try {
    await ensureSchema();

    const sid = cap(entry.sessionId, 64);
    if (!sid) return; // always need a session anchor
    const { browser, os, device } = parseUserAgent(entry.userAgent);

    // 1. Session upsert — refresh dynamic fields, keep first_seen.
    await sql`
      INSERT INTO sessions
        (id, first_seen, last_seen, mode, locale,
         browser, os, device, user_agent,
         country, region, city, referrer, accept_language, screen, path)
      VALUES
        (${sid}, now(), now(), ${entry.mode}, ${cap(entry.locale, 8)},
         ${browser}, ${os}, ${device}, ${cap(entry.userAgent, 300)},
         ${cap(entry.country, 64)}, ${cap(entry.region, 128)}, ${cap(entry.city, 128)},
         ${cap(entry.referrer, 300)}, ${cap(entry.acceptLanguage, 200)},
         ${cap(entry.screen, 24)}, ${cap(entry.path, 300)})
      ON CONFLICT (id) DO UPDATE SET
        last_seen = now(),
        mode = EXCLUDED.mode,
        locale = COALESCE(EXCLUDED.locale, sessions.locale),
        browser = COALESCE(EXCLUDED.browser, sessions.browser),
        os = COALESCE(EXCLUDED.os, sessions.os),
        device = COALESCE(EXCLUDED.device, sessions.device),
        country = COALESCE(EXCLUDED.country, sessions.country),
        region = COALESCE(EXCLUDED.region, sessions.region),
        city = COALESCE(EXCLUDED.city, sessions.city),
        screen = COALESCE(EXCLUDED.screen, sessions.screen),
        path = COALESCE(EXCLUDED.path, sessions.path)
    `;

    // 2. User turn, then assistant turn (each takes the next per-session seq).
    for (const [role, content, inT, outT, lat] of [
      ["user", entry.userText, null, null, null],
      [
        "assistant",
        entry.assistantText ?? "",
        entry.inputTokens,
        entry.outputTokens,
        entry.latencyMs,
      ],
    ] as const) {
      await sql`
        INSERT INTO messages
          (session_id, seq, role, content, mode, locale, model,
           input_tokens, output_tokens, latency_ms)
        VALUES
          (${sid},
           (SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE session_id = ${sid}),
           ${role}, ${cap(content, 16_000) ?? ""}, ${entry.mode},
           ${cap(entry.locale, 8)}, ${GROQ_MODEL},
           ${inT}, ${outT}, ${lat})
      `;
    }

    // 3. Roll session counters forward.
    await sql`
      UPDATE sessions SET
        message_count = message_count + 2,
        last_seen = now(),
        total_input_tokens = total_input_tokens + ${entry.inputTokens ?? 0},
        total_output_tokens = total_output_tokens + ${entry.outputTokens ?? 0}
      WHERE id = ${sid}
    `;
  } catch (err) {
    console.error("[research] failed to log chat exchange:", err);
  }
}

/**
 * Record a visitor's quality signal (1 = useful, -1 = not) on the most
 * recent assistant reply of the session. Best-effort: never throws.
 */
export async function logRating(entry: MessageRating): Promise<void> {
  if (!sql) return;
  const sid = cap(entry.sessionId, 64);
  if (!sid) return;
  try {
    await ensureSchema();
    await sql`
      UPDATE messages SET rating = ${entry.rating}
      WHERE id = (
        SELECT id FROM messages
        WHERE session_id = ${sid} AND role = 'assistant'
        ORDER BY seq DESC
        LIMIT 1
      )
    `;
  } catch (err) {
    console.error("[research] failed to log rating:", err);
  }
}
