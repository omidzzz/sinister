export async function GET() {
  const deployment = process.env.VERCEL ? "vercel" : "local";
  const mode = process.env.AGENT_MODE === "public" ? "public" : "local";
  const model = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
  const rateLimitMax = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 30);
  const rateLimitEnabled = Number.isFinite(rateLimitMax) && rateLimitMax > 0;

  return Response.json({
    status: "ok",
    deployment,
    mode,
    model,
    rateLimitEnabled,
    timestamp: new Date().toISOString(),
  });
}
