"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useState } from "react";

/** Loose shape of a tool part in the UI message stream. */
type LooseToolPart = {
  type: string; // "tool-<name>"
  toolCallId: string;
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error";
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const STATE_LABEL: Record<LooseToolPart["state"], string> = {
  "input-streaming": "running…",
  "input-available": "running…",
  "output-available": "done",
  "output-error": "error",
};

function ToolPartView({ part }: { part: LooseToolPart }) {
  const toolName = part.type.replace(/^tool-/, "");
  const summary =
    part.state === "output-available" &&
    typeof part.output === "object" &&
    part.output !== null
      ? (part.output as { matchCount?: number; totalLines?: number }).matchCount ??
        (part.output as { totalLines?: number }).totalLines
      : undefined;

  return (
    <details className="rounded-xl border border-black/[.08] bg-white px-3 py-2 text-xs dark:border-white/[.145] dark:bg-[#111]">
      <summary className="cursor-pointer list-none font-mono text-zinc-600 dark:text-zinc-400">
        <span
          className={
            part.state === "output-error"
              ? "mr-1.5 inline-block h-2 w-2 rounded-full bg-red-500"
              : part.state === "output-available"
                ? "mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500"
                : "mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400"
          }
        />
        {toolName} · {STATE_LABEL[part.state]}
        {summary !== undefined ? ` · ${summary}` : ""}
      </summary>
      <div className="mt-2 max-h-64 space-y-2 overflow-y-auto font-mono whitespace-pre-wrap text-[11px] text-zinc-500 dark:text-zinc-500">
        {part.input !== undefined && (
          <div>input: {JSON.stringify(part.input, null, 2)}</div>
        )}
        {part.state === "output-error" && part.errorText && (
          <div className="text-red-500">error: {part.errorText}</div>
        )}
        {part.state === "output-available" &&
          (() => {
            const text = JSON.stringify(part.output, null, 2);
            return text.length > 2000 ? (
              <div>
                {text.slice(0, 2000)}
                {"\n… (output truncated)"}
              </div>
            ) : (
              <div>output: {text}</div>
            );
          })()}
      </div>
    </details>
  );
}

export default function Chat() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat();

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const isStreaming = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-dvh flex-col bg-zinc-50 dark:bg-black">
      <header className="border-b border-black/[.08] px-4 py-3 dark:border-white/[.145]">
        <h1 className="text-sm font-semibold tracking-wide text-zinc-900 dark:text-zinc-50">
          Sinister
          <span className="ml-2 font-normal text-zinc-500">
            local-first coding agent
          </span>
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {messages.length === 0 && (
            <p className="mt-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
              Ask me anything about your project. Non-trivial tasks get a plan
              first — approve it before I write any code.
            </p>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={
                message.role === "user"
                  ? "ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-black/[.06] px-4 py-2.5 text-sm dark:bg-white/[.08]"
                  : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-black/[.08] bg-white px-4 py-2.5 text-sm dark:border-white/[.145] dark:bg-[#111]"
              }
            >
              {message.parts.map((part, i) => {
                if (part.type.startsWith("tool-")) {
                  return (
                    <ToolPartView
                      key={`${message.id}-${i}`}
                      part={part as unknown as LooseToolPart}
                    />
                  );
                }
                switch (part.type) {
                  case "text":
                    return <div key={`${message.id}-${i}`}>{part.text}</div>;
                  default:
                    return null;
                }
              })}
            </div>
          ))}

          {status === "submitted" && (
            <div className="text-xs text-zinc-500">Thinking…</div>
          )}
          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error.message}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <footer className="border-t border-black/[.08] px-4 py-3 dark:border-white/[.145]">
        <form
          className="mx-auto flex w-full max-w-3xl items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = input.trim();
            if (!text || isStreaming) return;
            sendMessage({ text });
            setInput("");
          }}
        >
          <textarea
            className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-black/[.08] bg-white px-3.5 py-2.5 text-sm outline-none placeholder:text-zinc-500 focus:border-black/30 dark:border-white/[.145] dark:bg-[#111] dark:focus:border-white/30"
            rows={1}
            value={input}
            placeholder={
              isStreaming ? "Waiting for response…" : "Say something…"
            }
            disabled={isStreaming}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const text = input.trim();
                if (!text || isStreaming) return;
                sendMessage({ text });
                setInput("");
              }
            }}
          />
          <button
            type="submit"
            className="rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            disabled={isStreaming || input.trim().length === 0}
          >
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}
