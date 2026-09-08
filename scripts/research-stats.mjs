// Research stats over logged chats. Usage:
//   RESEARCH_DATABASE_URL=postgres://... node scripts/research-stats.mjs [days]
// Prints volume, unique sessions, device/OS/locale/geo breakdowns, latency and
// token averages, and recent conversations (reconstructed from messages).
// Read-only.
import postgres from "postgres";

const sql = postgres(process.env.RESEARCH_DATABASE_URL ?? "", { max: 1 });
const days = Math.max(1, Math.min(365, Number(process.argv[2] ?? 30)));

const [totals] = await sql`
  SELECT
    count(*)::int AS msgs,
    count(*) FILTER (WHERE role = 'user')::int AS user_msgs,
    count(DISTINCT session_id)::int AS sessions,
    count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS last_24h,
    round(avg(latency_ms))::int AS avg_latency_ms,
    round(avg(input_tokens))::int AS avg_input_tokens,
    round(avg(output_tokens))::int AS avg_output_tokens
  FROM messages
  WHERE created_at > now() - (${days} || ' days')::interval
`;

const devices = await sql`
  SELECT coalesce(device, '(unknown)') AS k, count(*)::int AS n
  FROM sessions
  WHERE last_seen > now() - (${days} || ' days')::interval
  GROUP BY 1 ORDER BY n DESC
`;

const os = await sql`
  SELECT coalesce(os, '(unknown)') AS k, count(*)::int AS n
  FROM sessions
  WHERE last_seen > now() - (${days} || ' days')::interval
  GROUP BY 1 ORDER BY n DESC
`;

const locales = await sql`
  SELECT coalesce(locale, '(unknown)') AS k, count(*)::int AS n
  FROM sessions
  WHERE last_seen > now() - (${days} || ' days')::interval
  GROUP BY 1 ORDER BY n DESC
`;

const countries = await sql`
  SELECT coalesce(country, '(unknown)') AS k, count(*)::int AS n
  FROM sessions
  WHERE last_seen > now() - (${days} || ' days')::interval
  GROUP BY 1 ORDER BY n DESC
`;

const daily = await sql`
  SELECT date_trunc('day', created_at)::date::text AS day, count(*)::int AS n
  FROM messages
  WHERE created_at > now() - (${days} || ' days')::interval
  GROUP BY 1 ORDER BY 1
`;

// Most recent conversations, reconstructed in order.
const recentSessions = await sql`
  SELECT session_id, max(created_at) AS last
  FROM messages
  WHERE created_at > now() - (${days} || ' days')::interval
  GROUP BY session_id
  ORDER BY last DESC LIMIT 5
`;

console.log(`── chat research (last ${days} days) ──`);
console.log(
  `messages: ${totals.msgs} (${totals.user_msgs} user) · sessions: ${totals.sessions} · last 24h: ${totals.last_24h}`,
);
console.log(
  `avg latency: ${totals.avg_latency_ms ?? "–"} ms · avg in/out tokens: ${totals.avg_input_tokens ?? "–"}/${totals.avg_output_tokens ?? "–"}`,
);
const fmt = (rows) =>
  rows.length ? rows.map((r) => `${r.k}=${r.n}`).join("  ") : "–";
console.log("\nby device:", fmt(devices));
console.log("by OS:     ", fmt(os));
console.log("by locale: ", fmt(locales));
console.log("\nby country:", fmt(countries));
console.log("\ndaily message volume:");
for (const r of daily) console.log(`  ${r.day}  ${"#".repeat(Math.min(r.n, 60))} ${r.n}`);

for (const s of recentSessions) {
  const msgs = await sql`
    SELECT seq, role, left(content, 100) AS content, created_at
    FROM messages WHERE session_id = ${s.session_id}
    ORDER BY seq LIMIT 12
  `;
  console.log(`\nconversation ${s.session_id} (${s.last.toISOString?.() ?? s.last}):`);
  for (const m of msgs)
    console.log(`  [${m.seq}] ${m.role}: ${m.content}`);
}

await sql.end();
