import { client, countryRules, getWorker, leaveRules, timeRules } from "../data";
import { titleOf, valueOf } from "../describe";
import { money } from "../format";
import type { AnyRequest, ClientPolicy, Combination } from "../types";
import { pct, PRECEDENT_WINDOW_DAYS, similarCases } from "./precedents";
import { leaveLabel } from "./leave";

export type ChatReader = "hr" | "admin";

/**
 * Everything the chat knows about one request: the request itself, the worker, every rule check
 * and routing signal, the audit trail, the country's law and the client's policy for this request
 * type, and the worker's other requests. Pebl HR also gets its own analysis and similar past
 * cases; the client admin gets its own AI summary instead. Built in the browser (where the demo's
 * state lives) and sent to the chat route as data.
 */
export function chatContext(req: AnyRequest, policy: ClientPolicy, requests: AnyRequest[], combinations: Combination[] = [], reader: ChatReader = "hr") {
  const worker = getWorker(req.workerId);
  const similar = reader === "hr" ? similarCases(req, requests, combinations) : null;
  const country = worker.country;
  const others = requests.filter((r) => r.workerId === worker.id && r.id !== req.id);

  return {
    reader,
    request: {
      id: req.id,
      type: req.kind,
      title: titleOf(req),
      value: valueOf(req),
      status: req.status,
      submittedAt: req.submittedAt,
      details: details(req),
    },
    worker: { name: worker.name, title: worker.title, team: worker.team, country: countryRules[country].name, payrollCurrency: worker.currency, classification: worker.classification, startDate: worker.startDate },
    client: client.name,
    rulesEngine: {
      result: req.evaluation.result,
      checks: req.evaluation.checks.map((c) => ({ check: c.label, layer: c.layer, status: c.status, detail: c.detail, rule: c.ruleId ? `${c.ruleId} v${c.ruleVersion}` : undefined, workerCanFix: !!c.fixable })),
      payroll: req.evaluation.payroll.lines,
    },
    routing: {
      outcome: req.routing.outcome,
      combination: req.routing.combination,
      unlocked: req.routing.unlocked,
      shadowModeWouldHave: req.routing.shadowWould ?? null,
      signals: req.routing.signals.map((s) => `${s.label}: ${s.detail}`),
      disclaimersForClientAdmin: (req.routing.advisories ?? []).map((s) => `${s.label}: ${s.detail}`),
    },
    aiAnalysisForHr: reader === "hr" && req.explanations.hr ? { text: req.explanations.hr.text, suggestedAction: req.explanations.hr.suggestedAction } : null,
    aiSummaryForAdmin: reader === "admin" && req.explanations.admin ? { suggestion: req.explanations.admin.headline ?? null, text: req.explanations.admin.text } : null,
    auditTrail: req.history.map((h) => `${h.at} · ${h.actor} (${h.role}): ${h.action}${h.note ? ` · "${h.note}"` : ""}`),
    countryLaw: countryLaw(req),
    companyPolicy: companyPolicy(req, policy),
    similarCases: similar
      ? similar.type === "shadow"
        ? { reason: "Shadow mode", combination: similar.combination, hrAgreedWithSystem: `${similar.agreements} of ${similar.cases}`, systemWouldHave: similar.would }
        : {
            reason: similar.reason,
            windowDays: PRECEDENT_WINDOW_DAYS,
            cases: similar.cases,
            cleared: similar.cleared,
            askedForInfo: similar.askedInfo,
            denied: similar.denied,
            medianMinutesToResolve: similar.medianMinutes,
            usualNote: similar.usualNote,
            decidedThisSession: similar.inSession,
          }
      : null,
    workerHistory: {
      otherRequests: others.length,
      approved: others.filter((r) => r.status === "approved").length,
      declinedOrDenied: others.filter((r) => r.status === "denied").length,
      recent: others.slice(0, 8).map((r) => `${r.id} · ${titleOf(r)} · ${valueOf(r)} · ${r.status}`),
    },
  };
}

export type ChatContext = ReturnType<typeof chatContext>;

function details(req: AnyRequest) {
  switch (req.kind) {
    case "expense": {
      const d = req.data;
      return { merchant: d.merchant, amount: money(d.amount, d.currency), date: d.date, category: d.category, peopleCovered: d.attendees, taxNumber: d.taxId, businessPurpose: d.note, receipt: d.receipt.kind };
    }
    case "leave": {
      const i = req.insight;
      return { type: leaveLabel[req.data.type], start: req.data.start, end: req.data.end, workingDays: i.workingDays, balanceBefore: i.balanceBefore, balanceAfter: i.balanceAfter, payTreatment: i.payTreatment, noticeDays: i.noticeDays, teammatesAway: i.teamAway.map((a) => `${a.name} ${a.start} to ${a.end}`), expiringDays: i.expiring, note: req.data.note };
    }
    case "overtime": {
      const i = req.insight;
      return { date: req.data.date, hours: req.data.hours, reason: req.data.reason, monthlyHoursAfter: i.after, monthlyLimit: i.limit, legalCap: i.legalCap, forecastByMonthEnd: i.forecast, cost: money(i.cost, getWorker(req.workerId).currency), premiumPct: i.premiumPct };
    }
    case "timesheet": {
      const i = req.insight;
      return {
        weekStart: req.data.weekStart,
        days: req.data.days.map((d) => (d.off ? `${d.date}: ${d.off}` : `${d.date}: ${d.start}–${d.end}, ${d.breakMin} min break`)),
        totalHours: i.totalHours,
        overtimeHours: i.overtimeHours,
        preApprovedHours: i.preApproved,
        unapprovedHours: i.unapproved,
        monthToDate: `${i.monthAfter} of ${i.limit}`,
        longDays: i.longDays,
        note: req.data.note,
      };
    }
  }
}

function countryLaw(req: AnyRequest) {
  const c = getWorker(req.workerId).country;
  if (req.kind === "expense") return countryRules[c].expenses;
  if (req.kind === "leave") {
    const { publicHolidays, ...rest } = leaveRules[c];
    return { ...rest, publicHolidayCount: publicHolidays.length };
  }
  return timeRules[c];
}

function companyPolicy(req: AnyRequest, policy: ClientPolicy) {
  const c = getWorker(req.workerId).country;
  const base = { version: policy.version, effectiveFrom: policy.effectiveFrom };
  if (req.kind === "expense") return { ...base, ...policy.expenses };
  if (req.kind === "leave") return { ...base, ...policy.leave, vacationDaysForThisCountry: policy.leave.vacationDays[c] };
  return { ...base, overtimeForThisCountry: policy.overtime[c] };
}

// ---------------------------------------------------------------------------
// Answers to the suggested questions, built from the same context. Used when Claude isn't
// connected, so the chat still works in the demo.
// ---------------------------------------------------------------------------

const SUGGESTED: Record<ChatReader, { id: string; question: string }[]> = {
  hr: [
    { id: "why", question: "Why did this come to Pebl HR?" },
    { id: "law", question: "What does the country's law say here?" },
    { id: "recommend", question: "What would you recommend?" },
    { id: "similar", question: "How were similar cases handled?" },
    { id: "history", question: "What's this worker's history?" },
  ],
  admin: [
    { id: "why_admin", question: "Why is this on my card?" },
    { id: "recommend_admin", question: "Should I approve this?" },
    { id: "decline", question: "What happens if I decline?" },
    { id: "law", question: "What does the country's law say here?" },
    { id: "history", question: "What's this worker's history?" },
  ],
};

export const suggestedFor = (reader: ChatReader) => SUGGESTED[reader];

export function fallbackAnswer(id: string, ctx: ChatContext): string {
  const r = ctx.routing;
  switch (id) {
    case "why": {
      if (!r.signals.length) return `Nothing was flagged: every check passed and ${r.combination} is unlocked, so it went to ${r.outcome === "manager" ? "the manager" : "the client admin"}.`;
      const lines = r.signals.map((s) => `• ${s}`).join("\n");
      const shadow = r.shadowModeWouldHave ? `\n\n${r.combination} is in shadow mode, so HR decides. The system would have ${r.shadowModeWouldHave === "auto_clear" ? "cleared it automatically" : r.shadowModeWouldHave === "manager" ? "sent it to the manager" : "flagged it for HR anyway"}.` : "";
      return `It was routed to Pebl HR because of:\n${lines}${shadow}`;
    }
    case "law": {
      const country = ctx.rulesEngine.checks.filter((c) => c.layer === "country");
      if (!country.length) return `There are no verified ${ctx.worker.country} rules for this request type yet, so the decision rests on the company policy and your judgment.`;
      return `${ctx.worker.country} rules checked on this request:\n${country.map((c) => `• ${c.check} (${c.status}): ${c.detail}${c.rule ? ` [${c.rule}]` : ""}`).join("\n")}`;
    }
    case "recommend": {
      const a = ctx.aiAnalysisForHr;
      const fails = ctx.rulesEngine.checks.filter((c) => c.status === "fail");
      const base = a ? `${a.text}${a.suggestedAction ? `\n\nSuggested next step: ${a.suggestedAction}` : ""}` : "There's no AI analysis on this request yet.";
      const note = fails.length ? `\n\nFailing checks to resolve first: ${fails.map((f) => f.check.toLowerCase()).join(", ")}.` : "\n\nNo checks fail outright, so if the flagged reason checks out, it can be sent on.";
      return base + note;
    }
    case "similar": {
      const s = ctx.similarCases;
      if (!s) return "I don't have similar past cases for this one.";
      if ("hrAgreedWithSystem" in s) return `${s.combination} is in shadow mode. HR agreed with the system's call in ${s.hrAgreedWithSystem} past cases. Here, the system would have ${s.systemWouldHave}.`;
      if (!s.cases) return "No past cases on record for this flag yet.";
      return `${s.cases} requests reached HR for the same reason (${s.reason}) in the last ${s.windowDays} days: ${pct(s.cleared, s.cases)} cleared, ${pct(s.askedForInfo, s.cases)} needed more information, ${pct(s.denied, s.cases)} denied. They usually took ${s.medianMinutesToResolve} minutes.\n\nHR's usual note: "${s.usualNote}"`;
    }
    case "why_admin": {
      const disclaimers = r.disclaimersForClientAdmin;
      const hrReviewed = ctx.auditTrail.some((h) => h.includes("(hr)"));
      const lead =
        r.outcome === "manager"
          ? ctx.request.type === "timesheet" ? "It passed every legal check. It has overtime that wasn’t pre-approved, so you confirm it; the hours must be paid either way." : `It passed every legal check, and ${ctx.request.type === "leave" ? "the timing of planned leave" : "approving overtime"} is your call.`
          : hrReviewed
            ? "Pebl HR has reviewed it and sent it on: the business decision is yours."
            : "It passed every compliance check, so it's waiting on your approval.";
      return disclaimers.length ? `${lead}\n\nFor your decision, Pebl AI flagged:\n${disclaimers.map((d) => `• ${d}`).join("\n")}` : lead;
    }
    case "recommend_admin": {
      const a = ctx.aiSummaryForAdmin;
      const base = a ? `${a.suggestion ? `Suggestion: ${a.suggestion}. ` : ""}${a.text}` : "There's no AI summary on this request yet.";
      const flags = r.disclaimersForClientAdmin.length ? `\n\nIt's compliant, so the flags (${r.disclaimersForClientAdmin.map((d) => d.split(":")[0].toLowerCase()).join(", ")}) are about your own policy, not the law.` : "";
      return `${base}${flags}\n\nIf you're unsure about the law, use Contact HR before deciding.`;
    }
    case "decline": {
      switch (ctx.request.type) {
        case "expense":
          return "The employee sees your reason and isn't reimbursed. Write a reason they can act on, such as asking for a split bill or a business purpose.";
        case "leave":
          return "You'll need a reason, and you can suggest other dates instead. Managers decide when leave happens, not whether the employee is entitled to it. If declining would make the employee lose leave they're legally owed, the decline goes to Pebl HR rather than straight through.";
        case "overtime":
          return "The employee shouldn't work those hours. Give a reason, or approve fewer hours if that works.";
        default:
          return "Hours already worked must be paid, so a timesheet can't be refused. You can confirm it and add a note, for example asking for overtime to be requested in advance next time.";
      }
    }
    case "history": {
      const h = ctx.workerHistory;
      if (!h.otherRequests) return `${ctx.worker.name} has no other requests in the system.`;
      return `${ctx.worker.name} has ${h.otherRequests} other request${h.otherRequests === 1 ? "" : "s"}: ${h.approved} approved, ${h.declinedOrDenied} declined or denied.\n${h.recent.map((x) => `• ${x}`).join("\n")}`;
    }
    default:
      return "";
  }
}
