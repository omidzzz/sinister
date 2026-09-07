import {
  streamText,
  generateText,
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  isStepCount,
  type UIMessage,
  type ModelMessage,
} from "ai";
import { groqModel } from "@/lib/ai/provider";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { agentTools } from "@/lib/agent/tools";
import { agentWriteTools } from "@/lib/agent/write-tools";
import {
  terminalTool,
  isCommandAllowed,
  commandDenialReason,
} from "@/lib/agent/terminal";

export const maxDuration = 300;

/** Phase 5 "Token Budgeting": force a summary when history gets too big. */
const TOKEN_BUDGET = Number(process.env.TOKEN_BUDGET ?? 6_000);
const CHARS_PER_TOKEN = 4;
/**
 * Groq's free tier enforces an 8,000 tokens-per-minute limit on this model.
 * Keep the non-summarized part of every request comfortably below it.
 */
const REQUEST_TOKEN_CAP = 5_500;

function estimateTokens(messages: ModelMessage[]): number {
  return Math.ceil(
    messages.reduce((sum, m) => sum + JSON.stringify(m.content ?? "").length, 0) /
      CHARS_PER_TOKEN,
  );
}

async function applyTokenBudget(
  messages: ModelMessage[],
): Promise<{ messages: ModelMessage[]; summary?: string }> {
  const all = sanitizeForGroq(messages);

  // Take messages from the end until the request fits under the TPM cap.
  const recent: ModelMessage[] = [];
  let total = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const cost = estimateTokens([all[i]]);
    if (recent.length > 0 && total + cost > REQUEST_TOKEN_CAP) break;
    recent.unshift(all[i]);
    total += cost;
  }
  const older = all.slice(0, all.length - recent.length);

  if (estimateTokens(all) <= TOKEN_BUDGET || older.length === 0) {
    return { messages: all };
  }

  console.log(
    `[budget] ~${estimateTokens(all)} tokens exceeds budget ${TOKEN_BUDGET} - summarizing ${older.length} older messages`,
  );

  // The summarizer call must also fit under the TPM cap — keep the most
  // recent of the older messages and drop the rest.
  let summaryInput = older;
  while (summaryInput.length > 1 && estimateTokens(summaryInput) > REQUEST_TOKEN_CAP) {
    summaryInput = summaryInput.slice(1);
  }

  const { text: summary } = await generateText({
    model: groqModel(),
    system:
      "Summarize this coding-agent conversation segment concisely. Preserve: the user's goals, file paths touched, decisions made, current plan state, and any pending tasks. Output only the summary.",
    messages: summaryInput,
  });

  return { messages: recent, summary };
}

/**
 * Groq (gpt-oss models) rejects reasoning content replayed in the input, and
 * rejects assistant messages whose content is a bare text-part array. This
 * strips reasoning and flattens text-only assistant messages to plain strings
 * while preserving tool-call parts needed for the ReAct loop.
 */
function sanitizeForGroq(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((m) => {
    if (m.role !== "assistant" || !Array.isArray(m.content)) return m;
    const hasToolCalls = m.content.some((p) => p.type === "tool-call");
    if (hasToolCalls) {
      return { ...m, content: m.content.filter((p) => p.type !== "reasoning") };
    }
    const text = m.content
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("");
    return { ...m, content: text };
  });
}

export async function POST(req: Request) {
  if (!process.env.GROQ_API_KEY) {
    return Response.json(
      { error: "GROQ_API_KEY is not set. Add it to .env.local." },
      { status: 500 },
    );
  }

  const { messages }: { messages: UIMessage[] } = await req.json();
  const { messages: budgetedMessages, summary } = await applyTokenBudget(
    await convertToModelMessages(messages),
  );

  const result = streamText({
    model: groqModel(),
    system: summary
      ? `${SYSTEM_PROMPT}\n\nSummary of the earlier conversation (older messages were trimmed to stay under the token budget):\n${summary}`
      : SYSTEM_PROMPT,
    messages: budgetedMessages,
    tools: { ...agentTools, ...agentWriteTools, ...terminalTool },
    // The ReAct loop: after a tool result the model is called again to decide
    // its next step (Act & Observe), for at most 10 steps per user message.
    stopWhen: isStepCount(10),
    // Phase 1 "Approval Gate" + Phase 2 "Terminal Executor" security policy.
    toolApproval: ({ toolCall }) => {
      if (toolCall.toolName === "write_file" || toolCall.toolName === "edit_file") {
        return "user-approval";
      }
      if (toolCall.toolName === "run_command") {
        const command =
          typeof toolCall.input === "object" &&
          toolCall.input !== null &&
          "command" in toolCall.input
            ? String((toolCall.input as { command: unknown }).command)
            : "";
        if (!isCommandAllowed(command)) {
          return { type: "denied", reason: commandDenialReason(command) };
        }
        return undefined; // allowlisted safe commands auto-run
      }
      return undefined;
    },
    // HMAC-signs approval requests so a tampered client cannot forge an
    // approval (fail-closed verification on replay).
    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: (error) => {
        // Surface the real provider error to the client UI and server log
        // instead of the generic "An error occurred."
        console.error("[chat] streaming error:", error);
        return error instanceof Error ? error.message : String(error);
      },
    }),
  });
}