import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Live post index for the guest persona.
 *
 * Tries to read a posts manifest from the portfolio site's filesystem so the
 * agent can cite posts newer than the baked-in dossier. When the portfolio
 * source isn't present in this repo (most deployments), the endpoint returns
 * an empty list and the dossier's evergreen baseline stays authoritative.
 *
 * Expected shapes (any one of these, JSON only):
 *   - <portfolioRoot>/posts/index.json  →  [{ title, slug, ... }]
 *   - <portfolioRoot>/content/posts/index.json
 *   - <portfolioRoot>/feed.json         →  RSS→JSON-converted array
 *
 * Each entry must have at least a `title` string; entries without one are
 * dropped. The result is capped at 40 posts and 4,000 characters total so a
 * tampered client can't blow the token budget when this gets injected into
 * the system prompt.
 */
const POST_SEARCH_PATHS = [
  "posts/index.json",
  "content/posts/index.json",
  "feed.json",
  "public/feed.json",
];

const MAX_POSTS = 40;
const MAX_TOTAL_CHARS = 4_000;

export async function GET() {
  const base = process.env.PROJECT_ROOT
    ? process.env.PROJECT_ROOT
    : process.cwd();

  for (const rel of POST_SEARCH_PATHS) {
    try {
      const abs = path.resolve(base, rel);
      // The manifest location is intentionally dynamic (the portfolio source
      // may or may not sit beside this app); opt out of output tracing.
      const content: string = await fs.readFile(
        /*turbopackIgnore: true*/ abs,
        "utf-8",
      );
      const parsed: unknown = JSON.parse(content) as unknown;

      const rawPosts: unknown = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null
          ? ((parsed as Record<string, unknown>).posts ??
            (parsed as Record<string, unknown>).items ??
            (parsed as Record<string, unknown>).entries ??
            [])
          : [];
      const posts: unknown[] = Array.isArray(rawPosts) ? rawPosts : [];

      const valid: { title: string; slug?: string; url?: string }[] = posts
        .filter(
          (p: unknown): p is { title: string; slug?: string; url?: string } =>
            typeof p === "object" &&
            p !== null &&
            "title" in p &&
            typeof (p as Record<string, unknown>).title === "string",
        )
        .slice(0, MAX_POSTS)
        .map(
          (p: { title: string; slug?: string; url?: string }): {
            title: string;
            slug?: string;
            url?: string;
          } => {
            const rec = p as unknown as Record<string, unknown>;
            return {
              title: String(p.title).trim().slice(0, 200),
              slug: rec.slug !== undefined ? String(rec.slug) : undefined,
              url: rec.url !== undefined ? String(rec.url) : undefined,
            };
          },
        );

      const rendered = valid
        .map((p) =>
          p.url ? `- ${p.title} — ${p.url}` : `- ${p.title}`,
        )
        .join("\n");

      if (rendered.length > MAX_TOTAL_CHARS) {
        return Response.json({
          posts: valid.slice(0, MAX_POSTS),
          note: "Truncated to keep under the token-budget cap.",
        });
      }

      return Response.json({ posts: valid, source: rel });
    } catch {
      continue;
    }
  }

  return Response.json({ posts: [], source: null });
}
