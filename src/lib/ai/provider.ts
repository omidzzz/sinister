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

/**
 * Model is configurable via .env.local (GROQ_MODEL=...) so we can swap models
 * without code changes. Verified against Groq's live catalog via /api/models;
 * run `GET /api/models` locally to see what your key can access.
 */
export const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";