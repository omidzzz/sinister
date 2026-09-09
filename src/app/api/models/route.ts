import { GROQ_MODEL } from "@/lib/ai/provider";

/**
 * Dev helper: lists the model IDs your Groq key can actually access.
 * GET http://localhost:3000/api/models -> { model: string, models: string[] }
 * Phase 4: local-only — returns 404 on the public deployment.
 */
export async function GET() {
  if (process.env.AGENT_MODE === "public") {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  if (!process.env.GROQ_API_KEY) {
    return Response.json(
      { error: "GROQ_API_KEY is not set. Add it to .env.local." },
      { status: 500 },
    );
  }

  const res = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    cache: "no-store",
  });

  const data = (await res.json()) as {
    data?: Array<{ id: string }>;
    error?: { message: string };
  };

  if (!res.ok) {
    return Response.json(
      { error: data.error?.message ?? `Groq API returned ${res.status}` },
      { status: res.status },
    );
  }

  return Response.json({
    model: GROQ_MODEL,
    models: (data.data ?? []).map((m) => m.id).sort(),
  });
}