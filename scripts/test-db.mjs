// Quick connectivity/schema check for the research database.
// Usage: RESEARCH_DATABASE_URL=postgres://... node scripts/test-db.mjs
import postgres from "postgres";

const url = process.env.RESEARCH_DATABASE_URL;
if (!url) {
  console.error("RESEARCH_DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, idle_timeout: 20 });
try {
  const r = await sql`SELECT current_user AS u, current_database() AS d, 1 AS ok`;
  console.log(`connect ok — user: ${r[0].u}, db: ${r[0].d}`);

  // Same DDL the app runs on demand (sessions + messages + indexes).
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id          TEXT PRIMARY KEY,
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
  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id            BIGSERIAL PRIMARY KEY,
      session_id    TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
      seq           INTEGER NOT NULL,
      role          TEXT NOT NULL,
      content       TEXT NOT NULL,
      mode          TEXT NOT NULL DEFAULT 'guest',
      locale        TEXT,
      model         TEXT,
      input_tokens  INTEGER,
      output_tokens INTEGER,
      latency_ms    INTEGER,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  console.log("schema ok (sessions + messages)");

  await sql`INSERT INTO sessions (session_id, mode, locale, device) VALUES ('conn-test', 'guest', 'en', 'desktop')`;
  await sql`
    INSERT INTO messages (session_id, seq, role, content)
    VALUES ('conn-test', 1, 'user', '__connectivity_check__'),
           ('conn-test', 2, 'assistant', 'ok')
  `;
  await sql`DELETE FROM messages WHERE session_id = 'conn-test'`;
  await sql`DELETE FROM sessions WHERE session_id = 'conn-test'`;
  console.log("write/read ok (test rows removed)");
} catch (e) {
  console.error("ERR:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}