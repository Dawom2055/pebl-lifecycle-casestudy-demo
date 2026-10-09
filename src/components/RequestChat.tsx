"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { chatContext, fallbackAnswer, suggestedFor, type ChatReader } from "@/lib/engine/chat-context";
import { useDemo } from "@/lib/store";
import type { AnyRequest } from "@/lib/types";
import { cx, SparkIcon } from "./ui";

interface Turn {
  role: "user" | "assistant";
  content: string;
  /** "facts": answered from the request data because Claude isn't connected. */
  source?: "claude" | "facts";
}

/**
 * "Ask Pebl AI": a chat about the open request, for Pebl HR or the client admin. It's given the
 * full request context (checks, signals, audit trail, country law, company policy, the worker's
 * history), plus what that reader needs. Without Claude, the suggested questions are still
 * answered from that context.
 */
export function RequestChat({ req, reader = "hr" }: { req: AnyRequest; reader?: ChatReader }) {
  const demo = useDemo();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const context = useMemo(() => chatContext(req, demo.policy, demo.requests, demo.combinations, reader), [req, demo.policy, demo.requests, demo.combinations, reader]);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);

  async function ask(question: string, suggestedId?: string) {
    const q = question.trim();
    if (!q || pending) return;
    const history: Turn[] = [...turns, { role: "user", content: q }];
    setTurns(history);
    setInput("");

    const facts = suggestedId ? fallbackAnswer(suggestedId, context) : "";
    if (!demo.aiConnected) {
      setTurns([
        ...history,
        facts
          ? { role: "assistant", content: facts, source: "facts" }
          : { role: "assistant", content: "Claude isn't connected, so I can only answer the suggested questions, from the request's own data. Add an Anthropic API key to ask anything.", source: "facts" },
      ]);
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setTurns([...history, { role: "assistant", content: body.reply, source: "claude" }]);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Couldn't reach Claude.";
      setTurns([...history, { role: "assistant", content: facts || `Sorry, I couldn't answer that (${reason}). Try again in a moment.`, source: "facts" }]);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {/* Always in view at the bottom of the request details. */}
      <div className="pointer-events-none sticky bottom-0 -mb-2 flex justify-end">
        <button
          onClick={() => setOpen(true)}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-ai bg-ai px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:brightness-110"
        >
          <SparkIcon className="size-4 text-white" />
          Ask Pebl AI about this request
        </button>
      </div>

      {open && (
        <aside role="dialog" aria-label="Pebl AI chat" className="fixed inset-y-0 right-0 z-[60] flex w-full flex-col border-l border-line bg-bg shadow-2xl sm:w-[420px]">
          <header className="flex items-start justify-between gap-3 border-b border-line bg-ai-bg px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 font-display font-bold text-ai">
                <SparkIcon className="size-4" /> Pebl AI
              </div>
              <div className="truncate text-xs text-muted">
                {context.request.id} · {context.worker.name} · {context.request.title}
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-md p-1 text-muted hover:bg-surface hover:text-ink" aria-label="Close chat">
              <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            <p className="text-sm text-muted">
              I&apos;ve read this request: every rule check, {reader === "admin" ? "any disclaimers" : "why it was routed here"}, the audit trail, {context.worker.country}&apos;s rules, {context.client}&apos;s policy and{" "}
              {context.worker.name.split(" ")[0]}&apos;s other requests. Ask me anything. You make the decision{reader === "admin" ? "; for legal questions, use Contact HR" : ""}.
            </p>
            {demo.aiConnected === false && (
              <p className="mt-2 rounded-lg bg-sunken px-3 py-2 text-xs text-muted">Claude isn&apos;t connected, so the suggested questions are answered straight from the request data.</p>
            )}

            <div className="mt-3 flex flex-wrap gap-1.5">
              {suggestedFor(reader).map((s) => (
                <button
                  key={s.id}
                  disabled={pending}
                  onClick={() => ask(s.question.replace("the country's", `${context.worker.country}'s`), s.id)}
                  className="rounded-full border border-ai/40 bg-surface px-3 py-1 text-xs font-semibold text-ai transition hover:border-ai disabled:opacity-50"
                >
                  {s.question.replace("the country's", `${context.worker.country}'s`)}
                </button>
              ))}
            </div>

            <ol className="mt-4 grid gap-3">
              {turns.map((t, i) => (
                <li key={i} className={cx("max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm", t.role === "user" ? cx("justify-self-end text-white", reader === "admin" ? "bg-admin" : "bg-hr") : "justify-self-start border border-line bg-surface")}>
                  <p className="whitespace-pre-wrap">{t.content}</p>
                  {t.role === "assistant" && <p className="mt-1 font-mono text-[10.5px] uppercase tracking-wide text-faint">{t.source === "claude" ? "Written by Claude" : "From the request data"}</p>}
                </li>
              ))}
              {pending && <li className="shimmer h-10 w-2/3 justify-self-start rounded-2xl border border-line bg-surface" aria-label="Pebl AI is thinking" />}
            </ol>
            <div ref={bottom} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex gap-2 border-t border-line bg-surface px-3 py-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={demo.aiConnected ? "Ask about this request…" : "Connect Claude to ask your own questions"}
              aria-label="Ask Pebl AI"
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-ai"
              autoFocus
            />
            <button type="submit" disabled={!input.trim() || pending} className="rounded-lg bg-ai px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50">
              Ask
            </button>
          </form>
        </aside>
      )}
    </>
  );
}
