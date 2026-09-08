import postgres from "postgres";

const url = "postgresql://neondb_owner:npg_eIWm4PDBiE0R@ep-wild-term-b1pyg4u5-pooler.c-5.eu-central-1.aws.neon.tech/sinister_db?sslmode=require&channel_binding=require";

console.log("Connecting to sinister_db...");
const sql = postgres(url, { max: 1, idle_timeout: 20 });

try {
  // Test 1: Check current user & database
  const [{ user, db }] = await sql`SELECT current_user AS user, current_database() AS db`;
  console.log(`✓ Connected as ${user} to database ${db}`);

  // Test 2: Check if tables exist
  const tables = await sql`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name IN ('sessions', 'messages')
    ORDER BY table_name
  `;
  console.log(`✓ Found tables: ${tables.map(t => t.table_name).join(", ") || "(none yet — will auto-create)"}`);

  // Test 3: Create schema
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      browser TEXT, os TEXT, device TEXT,
      country TEXT, region TEXT, city TEXT,
      referrer TEXT, language TEXT, screen TEXT, path TEXT,
      message_count INTEGER DEFAULT 0,
      total_input_tokens BIGINT DEFAULT 0,
      total_output_tokens BIGINT DEFAULT 0,
      first_seen TIMESTAMPTZ DEFAULT NOW(),
      last_seen TIMESTAMPTZ DEFAULT NOW(),
      user_agent TEXT, mode TEXT, locale TEXT
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id),
      seq INTEGER, role TEXT, content TEXT,
      mode TEXT, locale TEXT, model TEXT,
      input_tokens INTEGER, output_tokens INTEGER,
      latency_ms INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log("✓ Schema ensured");

  // Test 4: Insert test session + message
  const sessionId = "test-" + Date.now();
  await sql`
    INSERT INTO sessions (id, browser, os, device, message_count, total_input_tokens, total_output_tokens, mode, locale)
    VALUES (${sessionId}, 'test-browser', 'test-os', 'desktop', 1, 100, 50, 'public', 'en')
    ON CONFLICT (id) DO UPDATE SET last_seen = NOW()
  `;
  await sql`
    INSERT INTO messages (session_id, seq, role, content, mode, locale, input_tokens, output_tokens, latency_ms)
    VALUES (${sessionId}, 1, 'user', 'Test message from diagnostic script', 'public', 'en', 100, 50, 1234)
  `;
  console.log("✓ Test row inserted");

  // Test 5: Verify
  const [{ count: sessionCount }] = await sql`SELECT COUNT(*)::int AS count FROM sessions`;
  const [{ count: messageCount }] = await sql`SELECT COUNT(*)::int AS count FROM messages`;
  console.log(`✓ DB now has ${sessionCount} sessions, ${messageCount} messages`);

  // Cleanup test data
  await sql`DELETE FROM messages WHERE session_id = ${sessionId}`;
  await sql`DELETE FROM sessions WHERE id = ${sessionId}`;
  console.log("✓ Test data cleaned up");

  console.log("\n✅ ALL CHECKS PASSED — sinister_db is ready");
} catch (err) {
  console.error("\n❌ ERROR:", err.message);
  console.error("Full:", err);
  process.exit(1);
} finally {
  await sql.end();
}