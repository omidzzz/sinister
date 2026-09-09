// In-memory rate limiter for the chat endpoint.

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();
const MAX_ENTRIES = 10000;

const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 30);
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000);

export function extractClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const vercelInfo = req.headers.get('x-vercel-ip-info');
  if (vercelInfo) {
    const ip = vercelInfo.split(',')[0]?.trim();
    if (ip) return ip;
  }
  return 'unknown';
}

function cleanup(): void {
  const cutoff = Date.now() - WINDOW_MS;
  if (store.size > MAX_ENTRIES) {
    const sorted = Array.from(store.entries())
      .sort((a, b) => a[1].timestamps[0] - b[1].timestamps[0]);
    const toDelete = sorted.slice(0, Math.floor(sorted.length / 2));
    for (const [key] of toDelete) store.delete(key);
  }
  for (const [key, entry] of store.entries()) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}

export function checkRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
} {
  const normalizedIp = ip.trim() || "unknown";
  if (MAX_REQUESTS <= 0) {
    return {
      allowed: true,
      remaining: Number.POSITIVE_INFINITY,
      resetAt: Date.now() + WINDOW_MS,
      retryAfterMs: 0,
    };
  }

  cleanup();

  const now = Date.now();
  const entry = store.get(normalizedIp) ?? { timestamps: [] };
  store.set(normalizedIp, entry);

  entry.timestamps = entry.timestamps.filter((t) => t > now - WINDOW_MS);

  const remaining = Math.max(0, MAX_REQUESTS - entry.timestamps.length);
  const allowed = entry.timestamps.length < MAX_REQUESTS;

  const oldestInWindow =
    entry.timestamps.length > 0 ? entry.timestamps[0] : now;
  const resetAt = oldestInWindow + WINDOW_MS;
  const retryAfterMs = allowed ? 0 : resetAt - now;

  if (allowed) {
    entry.timestamps.push(now);
  }

  return { allowed, remaining, resetAt, retryAfterMs };
}
