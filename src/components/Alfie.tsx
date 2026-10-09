"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { rangeLabel } from "@/lib/calendar";
import { client, CURRENT_WEEK, getWorker } from "@/lib/data";
import { actionable, agentContext, localAgent, NEEDS_CONFIRM, type AgentAction, type AgentReply, type AgentRole } from "@/lib/engine/agent";
import { adminAgent, adminContext, employeeAgent, employeeContext, nextWorkingDay } from "@/lib/engine/agent-roles";
import { leaveLabel } from "@/lib/engine/leave";
import { prefillWeek } from "@/lib/engine/time";
import { useDemo } from "@/lib/store";
import type { AnyRequest, LeaveType } from "@/lib/types";
import { Button, cx, SparkIcon } from "./ui";

type ActionState = "done" | "confirm" | "cancelled" | "failed";
interface RanAction {
  action: AgentAction;
  state: ActionState;
  /** What happened, e.g. "OT-3101 · waiting on your manager". */
  result?: string;
  note?: string;
}
interface Turn {
  role: "user" | "agent";
  text: string;
  actions?: RanAction[];
  source?: "claude" | "built-in";
}

const STATUS: Record<string, string> = {
  approved: "approved",
  awaiting_admin: "waiting on your manager",
  hr_review: "with Pebl HR",
  needs_fix: "back with you to fix",
  info_requested: "waiting on an answer",
  denied: "declined",
  withdrawn: "withdrawn",
  changes_suggested: "other dates suggested",
};

/**
 * Alfie: an AI agent that's always open beside the work, for Pebl HR, employees and client admins.
 * It answers questions and completes tasks for that role. Denials and declines wait for the
 * person to confirm, because only people say no.
 */
export function Alfie({ role, focus, onOpen, className }: { role: AgentRole; focus?: AnyRequest | null; onOpen?(id: string): void; className?: string }) {
  const demo = useDemo();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const worker = getWorker(demo.actingWorkerId);

  const context = useMemo(() => {
    if (role === "employee") return employeeContext({ worker, policy: demo.policy, requests: demo.requests });
    if (role === "admin") return adminContext({ policy: demo.policy, requests: demo.requests, combinations: demo.combinations });
    return agentContext({ focus, policy: demo.policy, requests: demo.requests, combinations: demo.combinations });
  }, [role, worker, focus, demo.policy, demo.requests, demo.combinations]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);

  // Switching employee starts a fresh conversation.
  const [forWorker, setForWorker] = useState(worker.id);
  if (role === "employee" && forWorker !== worker.id) {
    setForWorker(worker.id);
    setTurns([]);
  }

  const find = (id?: string) => (id ? demo.requests.find((r) => r.id === id) : undefined);
  const outcome = (r: AnyRequest) => `${r.id} · ${STATUS[r.status] ?? r.status}`;

  /** Runs one action against the demo's store. */
  function run(a: AgentAction): Omit<RanAction, "action"> {
    if (a.type === "open_request") {
      if (!find(a.requestId)) return { state: "failed", note: `${a.requestId} doesn't exist.` };
      onOpen?.(a.requestId!);
      return { state: "done" };
    }

    if (role === "employee") {
      if (a.type === "submit_overtime") {
        const r = demo.submitOvertime(worker.id, { date: a.date!, hours: Number(a.hours) || 2, reason: a.text || "Requested through Alfie" });
        return { state: "done", result: `${outcome(r)}. ${r.explanations.worker?.text ?? ""}` };
      }
      if (a.type === "submit_leave") {
        const r = demo.submitLeave(worker.id, { type: (a.leaveType as LeaveType) || "vacation", start: a.start!, end: a.end || a.start!, halfDay: false, note: a.text ?? "" });
        return { state: "done", result: `${outcome(r)}. ${r.explanations.worker?.text ?? ""}` };
      }
      if (a.type === "confirm_timesheet") {
        const r = demo.submitTimesheet(worker.id, { weekStart: CURRENT_WEEK, days: prefillWeek(worker, demo.requests, demo.policy), note: "" });
        return { state: "done", result: `${outcome(r)}. ${r.explanations.worker?.text ?? ""}` };
      }
      if (a.type === "go_to") {
        demo.setSection("employee", a.section || "home");
        return { state: "done" };
      }
      return { state: "failed", note: "That isn't something I can do for an employee." };
    }

    const r = find(a.requestId);
    if (!r) return { state: "failed", note: `${a.requestId ?? "That request"} doesn't exist.` };

    if (role === "admin") {
      if (r.status !== "awaiting_admin") return { state: "failed", note: `${r.id} isn't waiting for you (${STATUS[r.status] ?? r.status}).` };
      if (a.type === "approve") {
        demo.adminApprove(r.id);
        return { state: "done" };
      }
      if (a.type === "decline") return r.kind === "timesheet" ? { state: "failed", note: "Hours already worked must be paid." } : { state: "confirm" };
      if (a.type === "contact_hr") {
        demo.adminContactHr(r.id, a.text || "Can you check this before I decide?");
        return { state: "done" };
      }
      return { state: "failed", note: "That isn't something I can do for a client admin." };
    }

    // Pebl HR
    if (!actionable(r)) return { state: "failed", note: `${r.id} isn't with HR right now (${r.status.replace(/_/g, " ")}).` };
    if (a.type === "deny") return r.kind === "timesheet" ? { state: "failed", note: "Timesheets can't be denied: hours worked must be paid." } : { state: "confirm" };
    if (a.type === "message_employee") demo.hrRequestInfo(r.id, a.text ?? "");
    else if (a.type === "send_to_admin") demo.hrClear(r.id, a.text ?? "");
    else return { state: "failed", note: "That isn't something I can do for Pebl HR." };
    return { state: "done" };
  }

  function resolveConfirm(ti: number, ai: number, ok: boolean) {
    setTurns((ts) =>
      ts.map((t, i) => {
        if (i !== ti || !t.actions) return t;
        return {
          ...t,
          actions: t.actions.map((x, j) => {
            if (j !== ai || x.state !== "confirm") return x;
            if (!ok) return { ...x, state: "cancelled" };
            const r = find(x.action.requestId);
            const stillOpen = r && (role === "admin" ? r.status === "awaiting_admin" : actionable(r));
            if (!r || !stillOpen) return { ...x, state: "failed", note: "It's no longer waiting on you." };
            if (x.action.type === "deny") demo.hrDeny(r.id, x.action.text ?? "");
            else demo.adminDecline(r.id, x.action.text ?? "");
            return { ...x, state: "done" };
          }),
        };
      }),
    );
  }

  async function ask(prompt: string) {
    const p = prompt.trim();
    if (!p || pending) return;
    const history: Turn[] = [...turns, { role: "user", text: p }];
    setTurns(history);
    setInput("");

    let out: AgentReply | null = null;
    let source: Turn["source"] = "built-in";
    if (demo.aiConnected) {
      setPending(true);
      try {
        const res = await fetch("/api/ai/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context,
            messages: history.map((t) => ({
              role: t.role === "user" ? "user" : "assistant",
              content: t.role === "user" ? t.text : `${t.text}${t.actions?.length ? `\n[Actions: ${t.actions.map((a) => `${a.action.type} ${a.action.requestId ?? ""} (${a.state})`).join("; ")}]` : ""}`,
            })),
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        out = body as AgentReply;
        source = "claude";
      } catch (err) {
        console.warn("Alfie couldn't reach Claude; using the built-in agent", err);
      } finally {
        setPending(false);
      }
    }
    if (!out) {
      if (context.role === "employee") out = employeeAgent(p, context, { worker, policy: demo.policy, requests: demo.requests });
      else if (context.role === "admin") out = adminAgent(p, context, { requests: demo.requests });
      else out = localAgent(p, focus ?? null, context, { policy: demo.policy, requests: demo.requests, combinations: demo.combinations });
    }
    const actions = out.actions.map((action) => ({ action, ...run(action) }));
    setTurns([...history, { role: "agent", text: out.reply, actions, source }]);
  }

  // ---- Per-role copy.
  const queue = demo.requests.filter(actionable);
  const waiting = demo.requests.filter((r) => r.status === "awaiting_admin");
  const nwd = nextWorkingDay(context.today);
  const nwdName = new Date(`${nwd}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const first = focus ? getWorker(focus.workerId).name.split(" ")[0] : null;

  const subtitle =
    role === "employee"
      ? `Your assistant · ${worker.name}`
      : role === "admin"
        ? `${client.name} · ${waiting.length} waiting for you`
        : focus
          ? `Working on ${focus.id} · ${getWorker(focus.workerId).name} · ${focus.status.replace(/_/g, " ")}`
          : `Your queue · ${queue.length} waiting on you`;

  const intro =
    role === "employee"
      ? "I can submit overtime, leave and your timesheet for you, open a new expense, and answer questions about your balances, hours and the rules."
      : role === "admin"
        ? "I can look up any employee, tell you what's waiting, approve requests, draft a decline for you to confirm, ask Pebl HR a question, and show who's away."
        : focus
          ? `I can message ${first}, send this to the client admin, draft a denial for you to confirm, or answer questions about the request, the policy and ${getWorker(focus.workerId).country} law.`
          : "Tell me what to do across your queue: summarize it, message an employee, send a request to the admin, or ask about any request, policy or country law. Mention a request by ID, like EXP-2001.";

  const chips =
    role === "employee"
      ? [`Request 2 hours of overtime on ${nwdName} for the release`, "Confirm my timesheet", "How many vacation days do I have?", "Book vacation from Dec 14 to Dec 18", "I'm sick today", "Submit an expense"]
      : role === "admin"
        ? ["What's waiting for me?", "Tell me about Priya Shah", "Approve all clean expenses", "Who's away in the next month?", "How much overtime is the team using?"]
        : focus
          ? [`Message ${first} asking for more detail`, "Send to the admin with the usual note", "Why is this here?", "What does the law say?", "How were similar cases handled?"]
          : ["Summarize my queue", ...(queue[0] ? [`Message the employee on ${queue[0].id}`, `Why is ${queue[0].id} here?`, `Send ${queue[0].id} to the admin`] : [])];

  const userBubble = role === "employee" ? "bg-worker" : role === "admin" ? "bg-admin" : "bg-hr";

  return (
    <section aria-label="Alfie" className={cx("flex min-h-0 flex-col overflow-hidden rounded-2xl border border-ai/40 bg-bg shadow-sm", className)}>
      <header className="border-b border-ai/30 bg-ai-bg px-4 py-3">
        <div className="flex items-center gap-1.5 font-display font-bold text-ai">
          <SparkIcon className="size-4" /> Alfie
          <span className="font-mono text-[10px] font-medium uppercase tracking-wide text-ai/70">AI agent</span>
        </div>
        <div className="truncate text-xs text-muted">{subtitle}</div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {turns.length === 0 && <p className="text-sm text-muted">{intro}</p>}
        {demo.aiConnected === false && turns.length === 0 && (
          <p className="mt-2 rounded-lg bg-sunken px-3 py-2 text-xs text-muted">Claude isn&apos;t connected, so I handle common requests with built-in templates. Connect Claude for anything else.</p>
        )}
        <ol className="mt-2 grid gap-3">
          {turns.map((t, ti) => (
            <li key={ti} className={cx("grid gap-2", t.role === "user" ? "justify-items-end" : "justify-items-start")}>
              <div className={cx("max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm", t.role === "user" ? cx(userBubble, "text-white") : "border border-line bg-surface")}>
                <p className="whitespace-pre-wrap">{t.text}</p>
                {t.role === "agent" && <p className="mt-1 font-mono text-[10.5px] uppercase tracking-wide text-faint">{t.source === "claude" ? "Alfie · Claude" : "Alfie · built-in"}</p>}
              </div>
              {t.actions?.map((a, ai) => (
                <ActionCard key={ai} ran={a} onConfirm={(ok) => resolveConfirm(ti, ai, ok)} onOpen={onOpen} />
              ))}
            </li>
          ))}
          {pending && <li className="shimmer h-10 w-2/3 rounded-2xl border border-line bg-surface" aria-label="Working" />}
        </ol>
        <div ref={bottom} />
      </div>

      <div className="border-t border-line bg-surface px-3 py-2.5">
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5">
          {chips.map((c) => (
            <button key={c} disabled={pending} onClick={() => ask(c)} className="shrink-0 rounded-full border border-ai/40 bg-bg px-2.5 py-1 text-[11.5px] font-semibold text-ai hover:border-ai disabled:opacity-50">
              {c}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={focus ? `Tell Alfie what to do with ${focus.id}…` : "Tell Alfie what to do…"}
            aria-label="Instruction for Alfie"
            className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-ai"
          />
          <button type="submit" disabled={!input.trim() || pending} className="rounded-lg bg-ai px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Go
          </button>
        </form>
      </div>
    </section>
  );
}

function headline(a: AgentAction, who: string): string {
  switch (a.type) {
    case "message_employee":
      return `Message sent to ${who} · ${a.requestId} now waiting on their answer`;
    case "send_to_admin":
      return `${a.requestId} cleared and sent on`;
    case "deny":
      return `Deny ${a.requestId}`;
    case "decline":
      return `Decline ${a.requestId}`;
    case "approve":
      return `${a.requestId} approved`;
    case "contact_hr":
      return `Question sent to Pebl HR about ${a.requestId}`;
    case "submit_overtime":
      return `Overtime submitted: ${a.hours} hrs on ${a.date ? rangeLabel(a.date, a.date) : ""}`;
    case "submit_leave":
      return `${leaveLabel[(a.leaveType as LeaveType) || "vacation"]} submitted: ${a.start ? rangeLabel(a.start, a.end || a.start) : ""}`;
    case "confirm_timesheet":
      return `Timesheet submitted for the week of ${rangeLabel(CURRENT_WEEK, CURRENT_WEEK)}`;
    case "go_to":
      return "Opened New expense";
    default:
      return `Opened ${a.requestId}`;
  }
}

function ActionCard({ ran, onConfirm, onOpen }: { ran: RanAction; onConfirm(ok: boolean): void; onOpen?(id: string): void }) {
  const demo = useDemo();
  const { action: a, state } = ran;
  const r = a.requestId ? demo.requests.find((x) => x.id === a.requestId) : undefined;
  const who = r ? getWorker(r.workerId).name.split(" ")[0] : "the employee";
  const tone = state === "done" ? "border-admin/40 bg-admin-bg" : state === "confirm" ? "border-danger/40 bg-danger-bg" : "border-line bg-sunken";
  const title =
    state === "failed"
      ? `Couldn't do it: ${ran.note}`
      : state === "cancelled"
        ? `${a.type === "deny" ? "Denial" : "Decline"} of ${a.requestId} cancelled`
        : NEEDS_CONFIRM.includes(a.type) && state === "done"
          ? `${a.requestId} ${a.type === "deny" ? "denied" : "declined"}`
          : headline(a, who);
  const body = a.type === "deny" || a.type === "decline" ? (a.text ? `Reason: ${a.text}` : "") : a.type === "submit_overtime" ? `Reason: ${a.text}` : a.type === "open_request" || a.type === "go_to" || a.type === "approve" ? "" : (a.text ?? "");
  const resultId = ran.result?.split(" · ")[0];

  return (
    <div className={cx("w-full max-w-[92%] rounded-xl border px-3 py-2.5 text-sm", tone)}>
      <div className="flex items-center gap-1.5 font-semibold">
        <span aria-hidden>{state === "done" ? "✓" : state === "confirm" ? "!" : state === "cancelled" ? "–" : "✕"}</span>
        {title}
      </div>
      {body && <p className="mt-1 whitespace-pre-wrap text-muted">{body}</p>}
      {ran.result && (
        <p className="mt-1 text-muted">
          {resultId && onOpen ? (
            <button onClick={() => onOpen(resultId)} className="font-semibold text-ink underline-offset-2 hover:underline">
              {resultId}
            </button>
          ) : (
            <b className="text-ink">{resultId}</b>
          )}
          {ran.result.slice(resultId?.length ?? 0)}
        </p>
      )}
      {state === "confirm" && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="danger" onClick={() => onConfirm(true)}>
            Confirm {a.type === "deny" ? "denial" : "decline"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onConfirm(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
