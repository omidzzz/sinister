// Stats endpoint - shows anonymous usage stats
// Feature-flagged by RESEARCH_DATABASE_URL

import { neon } from "@neondatabase/serverless";

const sql = process.env.RESEARCH_DATABASE_URL
  ? neon(process.env.RESEARCH_DATABASE_URL)
  : null;

export async function GET() {
  if (!sql) {
    return Response.json({
      sessions: 0,
      messages: 0,
      countries: [],
      topPaths: [],
      note: "Research database not configured.",
    });
  }

  try {
    const [sessionsResult, messagesResult, countriesResult, topPathsResult] =
      await Promise.all([
        sql`SELECT COUNT(*) AS count FROM sessions`,
        sql`SELECT COUNT(*) AS count FROM messages`,
        sql`SELECT country, COUNT(*) AS cnt
             FROM sessions
             WHERE country IS NOT NULL AND country != ''
             GROUP BY country
             ORDER BY cnt DESC
             LIMIT 10`,
        sql`SELECT path, COUNT(*) AS cnt
             FROM sessions
             WHERE path IS NOT NULL AND path != ''
             GROUP BY path
             ORDER BY cnt DESC
             LIMIT 10`,
      ]);

    type Row = { country?: string; path?: string; count?: number; cnt?: number };

    const sessions = Number((sessionsResult[0] as Row)?.count ?? 0);
    const messages = Number((messagesResult[0] as Row)?.count ?? 0);

    const countries = (countriesResult as Row[])
      .filter((r) => r.country)
      .map((r) => ({ country: r.country!, sessions: Number(r.cnt) }));

    const topPaths = (topPathsResult as Row[])
      .filter((r) => r.path)
      .map((r) => ({ path: r.path!, sessions: Number(r.cnt) }));

    return Response.json({ sessions, messages, countries, topPaths });
  } catch (error) {
    console.error("[stats] error:", error);
    return Response.json(
      { error: "Failed to fetch stats." },
      { status: 500 }
    );
  }
}
