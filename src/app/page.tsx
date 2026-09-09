"use client";

import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { diffLines } from "diff";
import type { Change } from "diff";

/** ── Phase 4: the local bridge ─────────────────────────────────────────── */

type BridgeConfig = { url: string; key: string };
const BRIDGE_STORAGE_KEY = "sinister-bridge";
const SESSION_STORAGE_KEY = "sinister-session";

/** Anonymous per-browser session id the research store anchors rows on. */
function loadSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_STORAGE_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

/**
 * Lazy extra request body — the anonymous per-browser session anchor the
 * research store logs rows on (feature-flagged by RESEARCH_DATABASE_URL).
 * Declared as a `Resolvable` function so it's resolved at fetch time on the
 * client; SSR never touches `navigator`/`window`.
 */
function sessionBody(): object {
  return {
    sessionId: loadSessionId(),
    locale: navigator.language,
    path: window.location.pathname,
    screen: `${window.screen.width}x${window.screen.height}`,
  };
}

function loadBridge(): BridgeConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(BRIDGE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as BridgeConfig) : null;
  } catch {
    return null;
  }
}

function BridgeModal({
  current,
  onSave,
  onClose,
}: {
  current: BridgeConfig | null;
  onSave: (config: BridgeConfig | null) => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState(current?.url ?? "");
  const [key, setKey] = useState(current?.key ?? "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="rave-border rave-glow w-[min(90vw,28rem)] rounded-2xl p-[1.5px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rave-panel rounded-[calc(1rem-1px)] p-5">
          <h2 className="rave-text font-mono text-sm font-bold tracking-widest">
            ⚡ LOCAL BRIDGE
          </h2>
          <p className="mt-2 font-mono text-[11px] text-zinc-400">
            Route chat to your own machine through its Cloudflare Tunnel.
            Requests will carry your secret key — only enable this from a
            device you trust.
          </p>
          <label className="mt-4 block font-mono text-[10px] uppercase tracking-widest text-cyan-300/80">
            Tunnel URL
          </label>
          <input
            className="mt-1 w-full rounded-lg border border-fuchsia-500/40 bg-black/80 px-3 py-2 font-mono text-xs text-lime-200 outline-none focus:border-cyan-300/70"
            placeholder="https://your-tunnel.trycloudflare.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <label className="mt-3 block font-mono text-[10px] uppercase tracking-widest text-cyan-300/80">
            Agent key
          </label>
          <input
            className="mt-1 w-full rounded-lg border border-fuchsia-500/40 bg-black/80 px-3 py-2 font-mono text-xs text-lime-200 outline-none focus:border-cyan-300/70"
            placeholder="AGENT_KEY from local .env.local"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <div className="mt-4 flex gap-2">
            <button
              className="rave-btn flex-1 rounded-lg px-4 py-2 font-mono text-xs font-bold uppercase tracking-widest transition-transform"
              onClick={() => {
                if (!url.trim()) return;
                onSave({ url: url.trim(), key: key.trim() });
                onClose();
              }}
            >
              Connect
            </button>
            <button
              className="rave-btn rave-btn-deny rounded-lg px-4 py-2 font-mono text-xs font-bold uppercase tracking-widest text-white transition-transform"
              onClick={() => {
                onSave(null);
                onClose();
              }}
            >
              Disconnect
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Discriminated union of every tool-result part the UI may receive. */
type ToolPartStateType =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error"
  | "approval-requested"
  | "approval-responded";

type ApprovalInfo = {
  id: string;
  isAutomatic?: boolean;
  requestReason?: string;
};

/** Base fields shared by every tool-result part. */
interface BaseToolPart {
  type: string;
  toolCallId: string;
  state: ToolPartStateType;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: ApprovalInfo;
  toolName?: string;
  summary?: string;
}

/** Tool-result parts only (excludes `"text"` parts). */
type ToolResultPart =
  | (BaseToolPart & { type: "tool-write_file" })
  | (BaseToolPart & { type: "tool-edit_file" })
  | (BaseToolPart & { type: "tool-run_command" })
  | (BaseToolPart & { type: "tool-get_directory_structure" })
  | (BaseToolPart & { type: "tool-read_file" })
  | (BaseToolPart & { type: "tool-search_code" })
  | (BaseToolPart & { type: "tool-scratchpad" });

/** Text parts in the UI message stream. */
type TextPart = { type: "text"; text: string };

const TOOL_PART_STATES: readonly ToolPartStateType[] = [
  "input-streaming",
  "input-available",
  "output-available",
  "output-error",
  "approval-requested",
  "approval-responded",
];

/** Narrows an unknown part to a text part. */
function isTextPart(part: unknown): part is TextPart {
  if (typeof part !== "object" || part === null) return false;
  const p = part as Record<string, unknown>;
  return p.type === "text" && typeof p.text === "string";
}

/**
 * Type guard: narrows an unknown part to a tool-result part.
 * Replaces the previous loose `as unknown as …` cast.
 */
function isToolResultPart(part: unknown): part is ToolResultPart {
  if (typeof part !== "object" || part === null) return false;
  const p = part as Record<string, unknown>;
  if (typeof p.type !== "string") return false;
  if (!p.type.startsWith("tool-")) return false;
  return (
    typeof p.toolCallId === "string" &&
    typeof p.state === "string" &&
    TOOL_PART_STATES.includes(p.state as ToolPartStateType)
  );
}

/** Every message part the UI may receive (tool or text) — the render loop
 * narrows with `isTextPart` / `isToolResultPart` above.
 */
export type ToolPart = ToolResultPart | TextPart;

/**
 * Narrow an unknown message part to a tool-result part or text part.
 * Replaces the previous loose `as unknown as …` cast.
 */
export function isToolPart(part: unknown): part is ToolPart {
  return isToolResultPart(part) || isTextPart(part);
}

type Mood = "neutral" | "hyperfixation" | "deadpan" | "competence" | "snark";

/** Lightweight mood classifier for the assistant's persona volatility. */
function detectMood(text: string): Mood {
  const t = text.toLowerCase();
  // The persona explicitly tags its own modes in the system prompt; honour
  // those first when present.
  if (/〔\s*hyperfixation\s*〕/i.test(t) || /〔\s*hyperfixation\s*〕/.test(text))
    return "hyperfixation";
  if (/〔\s*deadpan\s*〕/i.test(t)) return "deadpan";
  if (/〔\s*snark\s*off\s*〕/i.test(t) || /〔\s*competence\s*〕/i.test(t))
    return "competence";
  if (/〔\s*snark\s*〕/i.test(t)) return "snark";

  // Heuristic fallbacks based on punctuation/volume.
  const allCaps = text.replace(/[^A-Z]/g, "").length;
  const alphaCount = text.replace(/[^A-Za-z]/g, "").length;
  const capsRatio = alphaCount > 0 ? allCaps / alphaCount : 0;

  if (capsRatio > 0.35 && text.length > 40) return "hyperfixation";
  if (/^(!?|…|\s*)$/.test(text.trim()) && text.length < 60) return "deadpan";
  return "neutral";
}

const MOOD_LABEL: Record<Mood, string> = {
  neutral: "",
  hyperfixation: "〔HYPERFIXATION〕",
  deadpan: "〔DEADPAN〕",
  competence: "〔SNARK OFF〕",
  snark: "〔SNARK〕",
};

const MOOD_CLASS: Record<Mood, string> = {
  neutral: "",
  hyperfixation: "text-cyan-300",
  deadpan: "text-zinc-500",
  competence: "text-lime-300",
  snark: "text-fuchsia-300",
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
  const parts: Change[] = diffLines(oldContent, newContent);
  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border border-fuchsia-500/40 bg-black/70 font-mono text-[11px] leading-5">
      {parts.map((part: Change, i: number) =>
        part.value
          .split("\n")
          .filter(
            (l: string, j: number, arr: string[]) =>
              !(l === "" && j === arr.length - 1),
          )
          .map((line: string, j: number) => (
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

function parseWriteInput(input: unknown): WriteInput {
  if (typeof input !== "object" || input === null) return { path: "" };
  const rec = input as Record<string, unknown>;
  const parsed: WriteInput = {
    path: typeof rec.path === "string" ? rec.path : "",
  };
  if (typeof rec.content === "string") parsed.content = rec.content;
  if (typeof rec.find === "string") parsed.find = rec.find;
  if (typeof rec.replace === "string") parsed.replace = rec.replace;
  if (typeof rec.replaceAll === "boolean") parsed.replaceAll = rec.replaceAll;
  return parsed;
}

/** The Phase-1 Approval Gate UI: diff preview + Approve / Deny. */
function ApprovalBox({
  part,
  onRespond,
}: {
  part: ToolResultPart;
  onRespond: (id: string, approved: boolean) => void;
}) {
  const input = parseWriteInput(part.input);
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

/** Quick-start prompts shown above the textarea on an empty conversation. */
const PROMPT_CHIPS = [
  "What can you actually do?",
  "How does the local bridge work?",
  "What makes the approval gate safe?",
] as const;

function readOutputCount(output: object): number | undefined {
  const rec = output as Record<string, unknown>;
  const matchCount = typeof rec.matchCount === "number" ? rec.matchCount : undefined;
  const totalLines = typeof rec.totalLines === "number" ? rec.totalLines : undefined;
  return matchCount ?? totalLines;
}

function ToolPartView({
  part,
  onRespond,
}: {
  part: ToolResultPart;
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
      ? readOutputCount(part.output)
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
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [aboutOpen, setAboutOpen] = useState(false);
  // Reads localStorage lazily so SSR renders `null` and hydration matches —
  // no post-mount setState-in-effect needed.
  const [bridge, setBridge] = useState<BridgeConfig | null>(loadBridge);
  const [bridgeOpen, setBridgeOpen] = useState(false);
  // `bridgeAlive` is null until the first heartbeat completes. It is read by
  // the header badge below.
  const [bridgeAlive, setBridgeAlive] = useState<boolean | null>(null);

  // Heartbeat: while a bridge is configured, ping its /api/health every 30s
  // so a dead tunnel (restarted laptop, rotated URL) surfaces instead of
  // failing silently on the next chat message.
  useEffect(() => {
    if (!bridge?.url) return;
    let cancelled = false;
    const base = bridge.url.replace(/\/+$/, "");
    const ping = async () => {
      try {
        const res = await fetch(`${base}/api/health`, {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!cancelled) setBridgeAlive(res.ok);
      } catch {
        if (!cancelled) setBridgeAlive(false);
      }
    };
    // Warm-start liveness so the header badge isn't stale after a URL change;
    // the interval below re-verifies every 30s.
    void ping();
    const id = setInterval(() => void ping(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [bridge?.url]);

  // Hidden toggle: Ctrl+Shift+E (or Cmd+Shift+E) opens the bridge dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "e"
      ) {
        e.preventDefault();
        setBridgeOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const saveBridge = (config: BridgeConfig | null) => {
    setBridgeAlive(null); // reset liveness; the heartbeat effect re-verifies
    setBridge(config);
    if (config) {
      localStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(config));
    } else {
      localStorage.removeItem(BRIDGE_STORAGE_KEY);
    }
  };

  // Manual dark/light toggle — the widget defaults to dark (rave) and a
  // `data-theme="light"` ancestor flips the CSS variables in globals.css so
  // the widget can sync with the host portfolio site's theme engine.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // When bridged, chat requests go to the local machine through the tunnel;
  // otherwise they hit the same-origin /api/chat. The session anchor rides on
  // the transport-level `body` (resolved per request, client-side).
  const transport = useMemo(() => {
    if (bridge?.url) {
      return new DefaultChatTransport({
        api: `${bridge.url.replace(/\/+$/, "")}/api/chat`,
        headers: bridge.key ? { "x-sinister-key": bridge.key } : undefined,
        body: sessionBody,
      });
    }
    return new DefaultChatTransport({ api: "/api/chat", body: sessionBody });
  }, [bridge]);

  const {
    messages,
    sendMessage,
    status,
    error,
    addToolApprovalResponse,
  } = useChat({
    transport,
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
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
            <h1 className="rave-text rave-title font-mono text-lg font-extrabold tracking-widest">
              SINISTER
              <span className="ml-3 text-xs font-normal tracking-normal text-cyan-300/70">
                local-first coding agent
              </span>
              {bridge && (
                <span className="rave-btn ml-3 rounded-md px-2 py-0.5 align-middle font-mono text-[10px] font-bold">
                  ⚡ LOCAL BRIDGE
                  {bridgeAlive === true
                    ? " · ONLINE"
                    : bridgeAlive === false
                      ? " · OFFLINE"
                      : ""}
                </span>
              )}
            </h1>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                title="Toggle dark / light"
                aria-label="Toggle dark / light theme"
                className="rounded-lg border border-cyan-400/40 bg-black/60 px-2.5 py-1 font-mono text-xs text-cyan-200 transition hover:border-cyan-300"
                onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              >
                {theme === "dark" ? "☾" : "☀"}
              </button>
              <button
                type="button"
                title="About SINISTER"
                aria-label="About SINISTER"
                aria-expanded={aboutOpen}
                className="rounded-lg border border-fuchsia-500/40 bg-black/60 px-2.5 py-1 font-mono text-xs text-fuchsia-200 transition hover:border-fuchsia-400"
                onClick={() => setAboutOpen((o) => !o)}
              >
                ⓘ
              </button>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {messages.length === 0 && (
              <>
                <p className="rave-text mt-16 text-center font-mono text-sm">
                  ✦ welcome to the trip ✦ ask anything about your project —
                  non-trivial tasks get a plan first, and every write needs your
                  approval before it lands ✦
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {PROMPT_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      className="rounded-full border border-fuchsia-500/40 bg-black/60 px-3.5 py-1.5 font-mono text-[11px] text-fuchsia-200 transition hover:border-fuchsia-400 hover:bg-black/80"
                      onClick={() => {
                        if (isStreaming) return;
                        sendMessage({ text: chip });
                      }}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "rave-border ml-auto max-w-[85%] rounded-2xl rounded-br-md p-[1.5px]"
                    : theme === "light"
                      ? "max-w-[85%] rounded-2xl rounded-bl-md border border-fuchsia-500/40 bg-white/90 text-sm shadow-[0_0_12px_rgba(255,0,234,0.12)]"
                      : "max-w-[85%] rounded-2xl rounded-bl-md border border-cyan-400/40 bg-black/70 text-sm shadow-[0_0_12px_rgba(0,229,255,0.15)]"
                }
              >
                {message.role === "user" ? (
                  <div className="rave-panel whitespace-pre-wrap rounded-[calc(1rem-1px)] px-4 py-2.5 text-sm text-fuchsia-200">
                    {message.parts
                      .filter(isTextPart)
                      .map((p) => p.text)
                      .join("")}
                  </div>
                ) : (
                  <div
                    className={`flex flex-col gap-2 whitespace-pre-wrap px-4 py-2.5 ${
                      theme === "light" ? "text-zinc-900" : "text-zinc-100"
                    }`}
                  >
                    {message.parts.map((part, i) => {
                      if (isTextPart(part)) {
                        const mood = detectMood(part.text);
                        const label = MOOD_LABEL[mood];
                        return (
                          <div key={`${message.id}-${i}`}>
                            {label && (
                              <span
                                className={`font-mono text-[10px] tracking-widest mb-1 block ${MOOD_CLASS[mood]}`}
                              >
                                {label}
                              </span>
                            )}
                            {part.text}
                          </div>
                        );
                      }
                      if (isToolResultPart(part)) {
                        return (
                          <ToolPartView
                            key={`${message.id}-${i}`}
                            part={part}
                            onRespond={respondToApproval}
                          />
                        );
                      }
                      return null;
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
              className={`max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-fuchsia-500/50 px-3.5 py-2.5 font-mono text-sm outline-none focus:border-cyan-300/70 ${
                theme === "light"
                  ? "bg-white/90 text-zinc-900 placeholder:text-zinc-400"
                  : "bg-black/80 text-lime-200 placeholder:text-zinc-600"
              }`}
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

      {/* About drawer: explains guest vs bridged mode + privacy posture. */}
      {aboutOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center"
          onClick={() => setAboutOpen(false)}
        >
          <div
            className="rave-border w-[min(92vw,26rem)] rounded-2xl p-[1.5px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rave-panel rounded-[calc(1rem-1px)] p-5">
              <h2 className="rave-text font-mono text-sm font-bold tracking-widest">
                WHO IS SINISTER?
              </h2>
              <p className="mt-3 text-xs leading-relaxed text-zinc-300">
                SINISTER is a snarky, local-first AI coding agent. Right now it
                runs in <strong>guest mode</strong>: it can chat and answer
                questions about this site and its work, but it has{" "}
                <strong>no tool access</strong> — it cannot read your files or
                run anything.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                Connect your own machine via the local bridge (Ctrl+Shift+E)
                and it gains a sandboxed toolbelt: read-only filesystem tools,
                an allowlisted terminal, and a write gate where every file
                change needs your explicit approval before it lands.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                Privacy: messages are processed by the Groq API to generate
                replies; nothing is stored unless the operator enables the
                research database.
              </p>
              <button
                type="button"
                className="rave-btn mt-4 rounded-lg px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-transform"
                onClick={() => setAboutOpen(false)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {bridgeOpen && (
        <BridgeModal current={bridge} onSave={saveBridge} onClose={() => setBridgeOpen(false)} />
      )}
    </div>
  );
}
