import { createOpenAI } from "@ai-sdk/openai";

/**
 * Groq via the OpenAI-compatible provider.
 * Groq exposes an OpenAI-compatible API at this base URL, and Groq's free tier
 * requires no credit card. Swap `baseURL` for OpenRouter later if needed.
 */
export const groq = createOpenAI({
  baseURL: "https://api.groq.com/openai/v1",
  apiKey: process.env.GROQ_API_KEY,
});

export const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

/**
 * Model factory. `.chat(...)` forces the Chat Completions API — the default
 * Responses API path breaks multi-turn conversations on Groq (it replays
 * assistant items in a format Groq rejects with "unsupported content fields").
 * Configurable via .env.local (GROQ_MODEL=...); verified against Groq's live
 * catalog via GET /api/models.
 */
export const groqModel = () => groq.chat(GROQ_MODEL);