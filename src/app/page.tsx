"use client";

import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { diffLines } from "diff";
import { useEffect, useRef, useState } from "react";

/** Loose shape of a tool part in the UI message stream. */
type LooseToolPart = {
  type: string; // "tool-<name>"
  toolCallId: string;
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error"
    | "approval-requested"
    | "approval-responded";
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: {
    id: string;
    isAutomatic?: boolean;
    requestReason?: string;
  };
};

type WriteInput = {
  path: string;
  content?: string; // write_file
  find?: string; // edit_file
  replace?: string; // edit_file
  replaceAll?: boolean;
};

/** Computes old-vs-new content for write/edit approvals. */
function computeNewContent(input: WriteInput, oldContent: string): string {
  if (typeof input.content === "string") return input.content; // write_file
  if (typeof input.find === "string" && typeof input.replace === "string") {
    return input.replaceAll
      ? oldContent.split(input.find).join(input.replace)
      : oldContent.replace(input.find, input.replace);
  }
  return oldContent;
}

function DiffView({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const parts = diffLines(oldContent, newContent);
  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border border-fuchsia-500/40 bg-black/70 font-mono text-[11px] leading-5">
      {parts.map((part, i) =>
        part.value
          .split("\n")
          .filter((l, j, arr) => !(l === "" && j === arr.length - 1))
          .map((line, j) => (
            <div
              key={`${i}-${j}`}
              className={
                part.added
                  ? "bg-lime-400/15 text-lime-300"
                  : part.removed
                    ? "bg-pink-600/20 text-pink-400"
                    : "text-zinc-400"
              }
            >
              <span className="select-none opacity-60">
                {part.added ? "+ " : part.removed ? "- " : "  "}
              </span>
              {line || " "}
            </div>
          )),
      )}
    </div>
  );
}

/** The Phase-1 Approval Gate UI: diff preview + Approve / Deny. */
function ApprovalBox({
  part,
  onRespond,
}: {
  part: LooseToolPart;
  onRespond: (id: string, approved: boolean) => void;
}) {
  const input = (part.input ?? {}) as WriteInput;
  const [old, setOld] = useState<{
    loading: boolean;
    content: string | null;
    error?: string;
  }>({ loading: true, content: null });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/file?path=${encodeURIComponent(input.path)}`)
      .then((r) => r.json())
      .then((data: { exists?: boolean; content?: string | null; error?: string }) => {
        if (!cancelled) {
          if (data.error) setOld({ loading: false, content: null, error: data.error });
          else setOld({ loading: false, content: data.exists ? (data.content ?? "") : "" });
        }
      })
      .catch((e) => {
        if (!cancelled) setOld({ loading: false, content: null, error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [input.path]);

  if (old.loading) {
    return <div className="font-mono text-xs text-cyan-300">loading diff…</div>;
  }
  if (old.error || old.content === null) {
    return (
      <div className="font-mono text-xs text-pink-400">
        diff unavailable: {old.error ?? "unknown error"}
      </div>
    );
  }

  const newContent = computeNewContent(input, old.content);
  const isEdit = typeof input.find === "string";

  return (
    <div className="rave-border rave-glow rounded-xl p-[1.5px]">
      <div className="rave-panel rounded-[calc(0.75rem-1px)] p-3">
        <div className="mb-2 font-mono text-xs text-fuchsia-300">
          ⚡ {isEdit ? "EDIT" : "WRITE"} · {input.path} · awaiting your approval
        </div>
        <DiffView oldContent={old.content} newContent={newContent} />
        <div className="mt-3 flex gap-2">
          <button
            className="rave-btn rounded-lg px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-transform"
            onClick={() => part.approval && onRespond(part.approval.id, true)}
          >
            ✔ Apply
          </button>
          <button
            className="rave-btn rave-btn-deny rounded-lg px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-white transition-transform"
            onClick={() => part.approval && onRespond(part.approval.id, false)}
          >
            ✖ Deny
          </button>
        </div>
      </div>
    </div>
  );
}

const STATE_LABEL: Record<string, string> = {
  "input-streaming": "running…",
  "input-available": "running…",
  "output-available": "done",
  "output-error": "error",
  "approval-requested": "awaiting approval",
  "approval-responded": "responded",
};

function ToolPartView({
  part,
  onRespond,
}: {
  part: LooseToolPart;
  onRespond: (id: string, approved: boolean) => void;
}) {
  const toolName = part.type.replace(/^tool-/, "");

  if (
    part.state === "approval-requested" &&
    part.approval &&
    !part.approval.isAutomatic
  ) {
    return <ApprovalBox part={part} onRespond={onRespond} />;
  }

  if (part.state === "approval-requested") {
    return (
      <div className="font-mono text-xs text-amber-300">
        ⏳ {toolName} · awaiting approval…
      </div>
    );
  }
  const summary =
    part.state === "output-available" &&
    typeof part.output === "object" &&
    part.output !== null
      ? (part.output as { matchCount?: number; totalLines?: number }).matchCount ??
        (part.output as { totalLines?: number }).totalLines
      : undefined;

  return (
    <details className="rounded-xl border border-lime-400/30 bg-black/70 px-3 py-2 text-xs">
      <summary className="cursor-pointer list-none font-mono text-lime-300/80">
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
      <div className="mt-2 max-h-64 space-y-2 overflow-y-auto font-mono whitespace-pre-wrap text-[11px] text-zinc-400">
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
  const {
    messages,
    sendMessage,
    status,
    error,
    addToolApprovalResponse,
  } = useChat({
    // Auto-send once the user has responded to every pending approval.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  const respondToApproval = (id: string, approved: boolean) => {
    addToolApprovalResponse({ id, approved });
  };

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const isStreaming = status === "submitted" || status === "streaming";

  return (
    <div className="relative min-h-dvh">
      {/* animated psychedelic backdrop */}
      <div className="rave-bg fixed inset-0 -z-10 opacity-25" />
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(2,0,10,0.92)_75%)]" />

      <div className="flex h-dvh flex-col">
        <header className="rave-panel border-b border-fuchsia-500/30 px-4 py-3 backdrop-blur">
          <h1 className="rave-text rave-title font-mono text-lg font-extrabold tracking-widest">
            SINISTER
            <span className="ml-3 text-xs font-normal tracking-normal text-cyan-300/70">
              local-first coding agent
            </span>
          </h1>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {messages.length === 0 && (
              <p className="rave-text mt-16 text-center font-mono text-sm">
                ✦ welcome to the trip ✦ ask anything about your project —
                non-trivial tasks get a plan first, and every write needs your
                approval before it lands ✦
              </p>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "rave-border ml-auto max-w-[85%] rounded-2xl rounded-br-md p-[1.5px]"
                    : "max-w-[85%] rounded-2xl rounded-bl-md border border-cyan-400/40 bg-black/70 text-sm shadow-[0_0_12px_rgba(0,229,255,0.15)]"
                }
              >
                {message.role === "user" ? (
                  <div className="rave-panel whitespace-pre-wrap rounded-[calc(1rem-1px)] px-4 py-2.5 text-sm text-fuchsia-200">
                    {message.parts
                      .filter((p) => p.type === "text")
                      .map((p) => (p as { text: string }).text)
                      .join("")}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 whitespace-pre-wrap px-4 py-2.5 text-zinc-100">
                    {message.parts.map((part, i) => {
                      if (part.type.startsWith("tool-")) {
                        return (
                          <ToolPartView
                            key={`${message.id}-${i}`}
                            part={part as unknown as LooseToolPart}
                            onRespond={respondToApproval}
                          />
                        );
                      }
                      switch (part.type) {
                        case "text":
                          return (
                            <div key={`${message.id}-${i}`}>{part.text}</div>
                          );
                        default:
                          return null;
                      }
                    })}
                  </div>
                )}
              </div>
            ))}

            {status === "submitted" && (
              <div className="rave-text font-mono text-xs">◐ tripping…</div>
            )}
            {error && (
              <div className="rave-border rounded-xl p-[1px]">
                <div className="rave-panel rounded-[calc(0.75rem-1px)] px-4 py-2.5 font-mono text-xs text-pink-400">
                  {error.message}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <footer className="rave-panel border-t border-cyan-400/30 px-4 py-3 backdrop-blur">
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
              className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-fuchsia-500/50 bg-black/80 px-3.5 py-2.5 font-mono text-sm text-lime-200 outline-none placeholder:text-zinc-600 focus:border-cyan-300/70"
              rows={1}
              value={input}
              placeholder={
                isStreaming ? "waiting for the drop…" : "speak to the machine…"
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
              className="rave-btn rounded-xl px-5 py-2.5 font-mono text-sm font-extrabold uppercase tracking-widest transition-transform disabled:opacity-40"
              disabled={isStreaming || input.trim().length === 0}
            >
              Send
            </button>
          </form>
        </footer>
      </div>
    </div>
  );
}
