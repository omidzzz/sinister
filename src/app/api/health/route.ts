export async function GET() {
  const deployment = process.env.VERCEL ? "vercel" : "local";
  const mode = process.env.AGENT_MODE === "public" ? "public" : "local";
  const model = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

  // Mirrors the chat route's defaults (0 = off) so this readout can never
  // claim a limit that isn't actually being applied. 0 = no limit.
  const rateLimitMax = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 0);
  const tokenBudget = Number(process.env.TOKEN_BUDGET ?? 0);
  const requestTokenCap = Number(process.env.REQUEST_TOKEN_CAP ?? 0);

  return Response.json({
    status: "ok",
    deployment,
    mode,
    model,
    rateLimitEnabled: Number.isFinite(rateLimitMax) && rateLimitMax > 0,
    tokenBudget: Number.isFinite(tokenBudget) && tokenBudget > 0 ? tokenBudget : 0,
    requestTokenCap:
      Number.isFinite(requestTokenCap) && requestTokenCap > 0 ? requestTokenCap : 0,
    timestamp: new Date().toISOString(),
  });
}
