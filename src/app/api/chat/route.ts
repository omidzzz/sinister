import {
  streamText,
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  isStepCount,
  type UIMessage,
} from "ai";
import { groq, GROQ_MODEL } from "@/lib/ai/provider";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { agentTools } from "@/lib/agent/tools";
import { agentWriteTools } from "@/lib/agent/write-tools";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!process.env.GROQ_API_KEY) {
    return Response.json(
      { error: "GROQ_API_KEY is not set. Add it to .env.local." },
      { status: 500 },
    );
  }

  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: groq(GROQ_MODEL),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: { ...agentTools, ...agentWriteTools },
    // The ReAct loop: after a tool result the model is called again to decide
    // its next step (Act & Observe), for at most 10 steps per user message.
    stopWhen: isStepCount(10),
    // Phase 1 "Approval Gate" (State 2): write tools pause entirely and wait
    // for an explicit Approve/Deny click in the UI before executing.
    toolApproval: {
      write_file: "user-approval",
      edit_file: "user-approval",
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