// Research stats over logged guest chats. Usage:
//   RESEARCH_DATABASE_URL=postgres://... node scripts/research-stats.mjs [days]
// Prints volume, unique sessions, daily activity, latency/token averages,
// and the most recent questions. Read-only.
import postgres from "postgres";

const sql = postgres(process.env.RESEARCH_DATABASE_URL ?? "", { max: 1 });
const days = Math.max(1, Math.min(365, Number(process.argv[2] ?? 30)));

const [totals] = await sql`
  SELECT
    count(*)::int AS exchanges,
    count(DISTINCT session_id)::int AS sessions,
    count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS last_24h,
    round(avg(latency_ms))::int AS avg_latency_ms,
    round(avg(input_tokens))::int AS avg_input_tokens,
    round(avg(output_tokens))::int AS avg_output_tokens
  FROM chat_logs
  WHERE created_at > now() - (${days} || ' days')::interval
`;

const daily = await sql`
  SELECT date_trunc('day', created_at)::date::text AS day, count(*)::int AS n
  FROM chat_logs
  WHERE created_at > now() - (${days} || ' days')::interval
  GROUP BY 1 ORDER BY 1
`;

const locales = await sql`
  SELECT coalesce(locale, '(unknown)') AS locale, count(*)::int AS n
  FROM chat_logs
  WHERE created_at > now() - (${days} || ' days')::interval
  GROUP BY 1 ORDER BY n DESC
`;

const recent = await sql`
  SELECT created_at, session_id, locale, left(user_text, 110) AS question
  FROM chat_logs
  WHERE created_at > now() - (${days} || ' days')::interval
  ORDER BY created_at DESC LIMIT 20
`;

console.log(`── chat research (last ${days} days) ──`);
console.log(
  `exchanges: ${totals.exchanges} · sessions: ${totals.sessions} · last 24h: ${totals.last_24h}`,
);
console.log(
  `avg latency: ${totals.avg_latency_ms ?? "–"} ms · avg in/out tokens: ${totals.avg_input_tokens ?? "–"}/${totals.avg_output_tokens ?? "–"}`,
);
console.log("\nby locale:", locales.map((r) => `${r.locale}=${r.n}`).join("  "));
console.log("\ndaily volume:");
for (const r of daily) console.log(`  ${r.day}  ${"#".repeat(Math.min(r.n, 60))} ${r.n}`);
console.log("\nmost recent questions:");
for (const r of recent)
  console.log(`  [${r.created_at.toISOString?.() ?? r.created_at}] (${r.locale ?? "?"}) ${r.question}`);

await sql.end();
