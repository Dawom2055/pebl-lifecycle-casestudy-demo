import { client, DEMO_TODAY, getWorker, hrSpecialist, workers } from "../data";
import { rangeLabel } from "../calendar";
import { titleOf, valueOf } from "../describe";
import type { AnyRequest, ClientPolicy, Combination } from "../types";
import { chatContext, fallbackAnswer } from "./chat-context";
import { guardrails } from "./guardrails";
import { leaveLabel } from "./leave";
import { pct, primarySignal, similarCases } from "./precedents";

/**
 * The Workforce Agent for Pebl HR: it answers questions and completes work. Actions run in the
 * browser against the demo's store. Messaging the employee and sending a request to the client
 * admin happen straight away; a denial is drafted by the agent and confirmed by HR, because only
 * people deny requests.
 */
export type AgentRole = "hr" | "employee" | "admin";

export type AgentActionType =
  // Pebl HR
  | "message_employee"
  | "send_to_admin"
  | "deny"
  // Employee
  | "submit_overtime"
  | "submit_leave"
  | "confirm_timesheet"
  | "go_to"
  // Client admin
  | "approve"
  | "decline"
  | "contact_hr"
  // Anyone
  | "open_request";

/** Actions that wait for the person to confirm before they run. */
export const NEEDS_CONFIRM: AgentActionType[] = ["deny", "decline"];

export interface AgentAction {
  type: AgentActionType;
  requestId?: string;
  /** A message, a note, a reason, or (for overtime) the reason for the hours. */
  text?: string;
  date?: string;
  hours?: number;
  leaveType?: string;
  start?: string;
  end?: string;
  section?: string;
}

export interface AgentReply {
  reply: string;
  actions: AgentAction[];
}

/** Requests the agent can act on: the ones with HR right now. */
export const actionable = (r: AnyRequest) => r.status === "hr_review";

/** One line per request for the queue overview. */
function brief(r: AnyRequest, requests: AnyRequest[], combinations: Combination[]) {
  const w = getWorker(r.workerId);
  const reason = primarySignal(r);
  const s = similarCases(r, requests, combinations);
  return {
    id: r.id,
    employee: w.name,
    country: w.country,
    type: r.kind,
    title: titleOf(r),
    value: valueOf(r),
    status: r.status,
    reason: reason ? `${reason.label}: ${reason.detail}` : r.routing.shadowWould ? `Shadow mode for ${r.routing.combination}` : null,
    similarCases: s ? (s.type === "shadow" ? `Shadow mode: HR agreed with the system in ${s.agreements} of ${s.cases}` : s.cases ? `${s.cases} similar, ${pct(s.cleared, s.cases)} cleared` : null) : null,
    aiSuggestedAction: r.explanations.hr?.suggestedAction ?? null,
  };
}

/** Everything the agent is given: the HR queue, the request in focus (if any), and the law-vs-policy checks. */
export function agentContext(opts: { focus?: AnyRequest | null; policy: ClientPolicy; requests: AnyRequest[]; combinations: Combination[] }) {
  const { focus, policy, requests, combinations } = opts;
  return {
    role: "hr" as const,
    today: DEMO_TODAY,
    you: `${hrSpecialist.name}, ${hrSpecialist.title}`,
    client: client.name,
    queue: requests.filter(actionable).map((r) => brief(r, requests, combinations)),
    waitingOnEmployee: requests.filter((r) => r.status === "info_requested").map((r) => ({ id: r.id, employee: getWorker(r.workerId).name, title: titleOf(r) })),
    focusRequest: focus ? chatContext(focus, policy, requests, combinations, "hr") : null,
    policyAgainstLaw: guardrails(policy).map((g) => ({ country: g.country, setting: g.setting, law: g.law, company: g.company, status: g.status })),
  };
}

export type AgentContext = ReturnType<typeof agentContext>;

// ---------------------------------------------------------------------------
// Drafts. Plain, friendly, specific to why the request is with HR.
// ---------------------------------------------------------------------------

export function draftEmployeeMessage(r: AnyRequest): string {
  const w = getWorker(r.workerId);
  const first = w.name.split(" ")[0];
  const what = r.kind === "expense" ? `expense at ${r.data.merchant} (${valueOf(r)})` : r.kind === "overtime" ? `overtime request for ${rangeLabel(r.data.date, r.data.date)}` : `${titleOf(r)} (${valueOf(r)})`;
  const s = primarySignal(r);
  const id = s?.id;
  const sign = `\n\nThanks,\n${hrSpecialist.name}, Pebl HR`;

  if (r.kind === "expense") {
    if (id === "duplicate") return `Hi ${first}, your ${what} matches a claim from a colleague: same merchant, date and amount. Could you confirm who paid, so we can withdraw one of the claims?${sign}`;
    if (id === "cross_check") return `Hi ${first}, the amount or date you confirmed for your ${what} doesn't match the receipt. Could you check the receipt and confirm the right figures?${sign}`;
    if (id === "low_confidence") return `Hi ${first}, part of the receipt for your ${what} was hard to read. Could you upload a clearer photo?${sign}`;
    if (id === "repeat_fix") return `Hi ${first}, the receipt for your ${what} still doesn't show the supplier's tax number. Could you ask the supplier for a full tax invoice and upload it?${sign}`;
    return `Hi ${first}, thanks for submitting your ${what}. Before we send it on for approval, could you tell us the business purpose and who the expense covered?${sign}`;
  }
  if (r.kind === "leave") {
    const when = rangeLabel(r.data.start, r.data.end);
    const type = leaveLabel[r.data.type].toLowerCase();
    if (id === "tier") return `Hi ${first}, we're processing your ${type} for ${when}. Could you upload the supporting document and confirm the start date, so we can set up the right statutory pay?${sign}`;
    if (id === "no_rule") return `Hi ${first}, to check your entitlement for your ${type} on ${when}, could you confirm which province you work in?${sign}`;
    if (id === "rules_fail") return `Hi ${first}, your ${type} for ${when} clashes with a company rule: ${s!.detail} Could you move the dates, or would you like us to ask your manager for an exception?${sign}`;
    if (id === "duration") return `Hi ${first}, your ${type} for ${when} is a longer absence, so we review it before it goes ahead. Is there anything we should know, such as a handover plan?${sign}`;
    return `Hi ${first}, we're reviewing your ${type} for ${when}. Is there anything you'd like us to know before we process it?${sign}`;
  }
  if (r.kind === "timesheet") {
    const week = rangeLabel(r.data.weekStart, r.data.weekStart);
    return `Hi ${first}, your timesheet for the week of ${week} ${s ? `was flagged (${s.label.replace(/^Rule failed: /, "").toLowerCase()})` : "needs a quick review"}. All hours you worked will be paid. Could you tell us what happened that week, so we can review the workload with your manager?${sign}`;
  }
  return `Hi ${first}, we're reviewing your ${what}. Could you tell us a bit more about why the overtime is needed?${sign}`;
}

/** The note HR usually sends to the client admin for this kind of case, or a plain default. */
export function draftAdminNote(r: AnyRequest, requests: AnyRequest[], combinations: Combination[]): string {
  const s = similarCases(r, requests, combinations);
  if (s?.type === "history" && s.usualAction === "clear" && s.usualNote) return s.usualNote;
  return `Reviewed by Pebl HR: compliant under ${getWorker(r.workerId).country} rules. Sent on for your decision.`;
}

// ---------------------------------------------------------------------------
// The agent without Claude: common commands and questions, answered from the data.
// ---------------------------------------------------------------------------

const ID_RE = /\b(EXP|LV|OT|TS)-\d+\b/i;

export function localAgent(prompt: string, focus: AnyRequest | null, ctx: AgentContext, data: { policy: ClientPolicy; requests: AnyRequest[]; combinations: Combination[] }): AgentReply {
  const { policy, requests, combinations } = data;
  const p = prompt.toLowerCase();
  const mentioned = prompt.match(ID_RE)?.[0].toUpperCase();
  const queue = requests.filter(actionable);
  const target =
    (mentioned && requests.find((r) => r.id === mentioned)) ||
    focus ||
    (/\b(first|oldest|next|top)\b/.test(p) ? queue[0] : null) ||
    (queue.length === 1 ? queue[0] : null);

  const wants = (re: RegExp) => re.test(p);
  const needTarget = (verb: string): AgentReply => ({
    reply: queue.length ? `Which request should I ${verb}? For example: "${verb} ${queue[0].id}". Your queue has ${queue.map((r) => r.id).join(", ")}.` : "Your queue is empty, so there's nothing to act on right now.",
    actions: [],
  });

  // Queue overview.
  if (!mentioned && wants(/\b(summari[sz]e|overview|queue|what('?s| is) (waiting|pending|left)|my day|priorit)/)) {
    if (!ctx.queue.length) return { reply: `Your queue is clear.${ctx.waitingOnEmployee.length ? ` ${ctx.waitingOnEmployee.length} waiting on the employee: ${ctx.waitingOnEmployee.map((w) => w.id).join(", ")}.` : ""}`, actions: [] };
    const lines = ctx.queue.map((q) => `• ${q.id} · ${q.employee} (${q.country}) · ${q.title} · ${q.value}\n  ${q.reason ?? "Needs review"}${q.similarCases ? ` · ${q.similarCases}` : ""}`);
    return { reply: `${ctx.queue.length} request${ctx.queue.length === 1 ? "" : "s"} waiting on you:\n${lines.join("\n")}${ctx.waitingOnEmployee.length ? `\n\nWaiting on the employee: ${ctx.waitingOnEmployee.map((w) => w.id).join(", ")}.` : ""}\n\nAsk me to open, message, send on or deny any of them by ID.`, actions: [] };
  }

  // Open a request.
  if (wants(/\b(open|show|pull up|go to)\b/) && mentioned) return { reply: `Opening ${mentioned}.`, actions: [{ type: "open_request", requestId: mentioned, text: "" }] };

  // Message the employee.
  const names = workers.map((w) => w.name.split(" ")[0].toLowerCase());
  const messageIntent =
    wants(/\b(message|email|write to|contact|reach out|follow up|ping)\b/) || (wants(/\bask\b/) && (wants(/\b(employee|worker|them|for|about)\b/) || names.some((n) => p.includes(n))));
  if (messageIntent) {
    if (!target) return needTarget("message");
    if (!actionable(target)) return { reply: `${target.id} isn't with HR right now (${target.status.replace(/_/g, " ")}), so I can't message about it.`, actions: [] };
    const quoted = prompt.match(/["“](.+?)["”]/)?.[1];
    const text = quoted ?? draftEmployeeMessage(target);
    return { reply: `Done. I sent this to ${getWorker(target.workerId).name}, and ${target.id} is now waiting on their answer:`, actions: [{ type: "message_employee", requestId: target.id, text }] };
  }

  // Send on to the client admin (or clear leave).
  if (wants(/\b(send (it |this )?(on|to (the )?admin)|forward|clear|pass (it )?on|approve|resolve|sign off)\b/)) {
    if (!target) return needTarget("send on");
    if (!actionable(target)) return { reply: `${target.id} isn't with HR right now (${target.status.replace(/_/g, " ")}).`, actions: [] };
    const note = prompt.match(/["“](.+?)["”]/)?.[1] ?? draftAdminNote(target, requests, combinations);
    const leave = target.kind === "leave" && !target.routing.signals.some((s) => s.id === "admin_referral");
    return { reply: leave ? `Done. I cleared ${target.id}; the manager is notified and payroll is updated.` : `Done. I sent ${target.id} to the client admin with this note:`, actions: [{ type: "send_to_admin", requestId: target.id, text: note }] };
  }

  // Deny: drafted here, confirmed by HR.
  if (wants(/\b(deny|reject|decline|refuse)\b/)) {
    if (!target) return needTarget("deny");
    if (!actionable(target)) return { reply: `${target.id} isn't with HR right now (${target.status.replace(/_/g, " ")}).`, actions: [] };
    if (target.kind === "timesheet") return { reply: "Timesheets can't be denied: hours already worked must be paid. I can send it to the admin with a note, or message the employee instead.", actions: [] };
    const reason = prompt.match(/\b(?:because|reason:?|as)\s+(.+)$/i)?.[1] ?? target.evaluation.checks.find((c) => c.status === "fail")?.detail ?? "It doesn't meet the policy for this request.";
    return { reply: `I've drafted the denial for ${target.id}. Only people deny requests, so confirm it below and I'll send it.`, actions: [{ type: "deny", requestId: target.id, text: reason.replace(/^./, (c) => c.toUpperCase()) }] };
  }

  // Questions, answered from the request data.
  if (target) {
    const q = ctx.focusRequest?.request.id === target.id ? ctx.focusRequest : chatContext(target, policy, requests, combinations, "hr");
    const topic = wants(/\b(law|legal|statut|regulat)/)
      ? "law"
      : wants(/\b(similar|past|before|precedent|usually)/)
        ? "similar"
        : wants(/\b(history|previous|track record)/)
          ? "history"
          : wants(/\b(recommend|should i|what do i|suggest|next step)/)
            ? "recommend"
            : wants(/\b(polic)/)
              ? "policy"
              : wants(/\b(why|flag|reason|here)\b/)
                ? "why"
                : null;
    if (topic === "policy") return { reply: policyAnswer(q), actions: [] };
    if (topic) return { reply: `${q.request.id}: ${fallbackAnswer(topic, q)}`, actions: [] };
  }

  return {
    reply: `I can do the work or answer questions. Try:\n• "Message the employee asking for more detail"\n• "Send ${target?.id ?? "EXP-2001"} to the admin"\n• "Deny ${target?.id ?? "EXP-2001"} because …"\n• "Why is this here?", "What does the law say?", "How were similar cases handled?"\n• "Summarize my queue"\n\nClaude isn't connected, so I understand these common commands; with Claude I can handle anything you ask.`,
    actions: [],
  };
}

const POLICY_LABEL: Record<string, string> = {
  mealCapPerPerson: "Meal cap per person",
  borderlineBandPct: "Borderline band (% of the cap)",
  submitWithinDays: "Submit within (days)",
  preApprovalOverUSD: "Pre-approval over (USD)",
  noAlcohol: "No alcohol",
  autoClearThreshold: "Auto-clear limit",
  vacationDays: "Vacation days",
  sickPaidDays: "Paid sick days",
  carryoverMaxDays: "Carryover (days)",
  noticeDays: "Notice (days)",
  maxConsecutiveDays: "Max consecutive days",
  overtimeForThisCountry: "Overtime for this country",
};

function policyAnswer(q: ReturnType<typeof chatContext>): string {
  const p = q.companyPolicy as Record<string, unknown>;
  const pick = Object.entries(p)
    .filter(([k, v]) => !["version", "effectiveFrom"].includes(k) && (typeof v === "number" || typeof v === "boolean" || (typeof v === "object" && v !== null && !Array.isArray(v))))
    .slice(0, 6)
    .map(([k, v]) => `• ${POLICY_LABEL[k] ?? k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${typeof v === "object" ? JSON.stringify(v).replace(/[{}"]/g, "").replace(/:/g, " ").replace(/,/g, ", ") : String(v)}`);
  return `${q.client} ${q.request.type} policy, version ${String(p.version)}:\n${pick.join("\n")}`;
}
