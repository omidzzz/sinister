import { NextRequest, NextResponse } from "next/server";
import {
  logExchange,
  logRating,
  normalizeSessionId,
} from "@/lib/research/chat-store";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Explicit research-logging endpoint. The widget calls this after each
 * exchange instead of relying on streamText's onFinish (which is unreliable
 * in serverless — the function instance can freeze before the callback runs).
 *
 * The client sends user/assistant text + client-side latency; the server
 * enriches with UA, geo, and request headers, then writes the row.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = normalizeSessionId(body.sessionId);
    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "missing session id" },
        { status: 400 },
      );
    }

    // Reaction path: a bare quality signal on the latest assistant reply.
    if (body.rating === 1 || body.rating === -1) {
      await logRating({ sessionId, rating: body.rating });
      return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
    }

    await logExchange({
      sessionId,
      mode: body.mode === "local" ? "local" : "public",
      locale: typeof body.locale === "string" ? body.locale : null,
      userText: typeof body.userText === "string" ? body.userText : "",
      assistantText:
        typeof body.assistantText === "string" ? body.assistantText : null,
      inputTokens:
        typeof body.inputTokens === "number" ? body.inputTokens : null,
      outputTokens:
        typeof body.outputTokens === "number" ? body.outputTokens : null,
      latencyMs: typeof body.latencyMs === "number" ? body.latencyMs : null,
      userAgent: req.headers.get("user-agent") ?? null,
      country: req.headers.get("x-vercel-ip-country") ?? null,
      region: req.headers.get("x-vercel-ip-region") ?? null,
      city: req.headers.get("x-vercel-ip-city") ?? null,
      referrer: req.headers.get("referer") ?? null,
      acceptLanguage: req.headers.get("accept-language") ?? null,
      path: typeof body.path === "string" ? body.path : null,
      screen: typeof body.screen === "string" ? body.screen : null,
    });

    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
  } catch (err) {
    console.error("[log] failed:", err);
    // Never surface logging failures to the client.
    return NextResponse.json({ ok: false }, { status: 500, headers: CORS_HEADERS });
  }
}
