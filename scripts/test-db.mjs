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

  await sql`
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
  `;
  console.log("table ready (CREATE TABLE IF NOT EXISTS ok)");

  const ins = await sql`
    INSERT INTO chat_logs (session_id, mode, locale, user_text, assistant_text)
    VALUES ('conn-test', 'guest', 'en', '__connectivity_check__', 'ok')
    RETURNING id
  `;
  console.log("insert ok — id", ins[0].id);
  await sql`DELETE FROM chat_logs WHERE id = ${ins[0].id}`;
  console.log("cleanup ok (test row removed)");
} catch (e) {
  console.error("ERR:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}