import { addDays, isWeekend, rangeLabel, weekday } from "../calendar";
import { client, countryRules, CURRENT_WEEK, DEMO_TODAY, getWorker, workers } from "../data";
import { titleOf, valueOf } from "../describe";
import { money } from "../format";
import type { AnyRequest, ClientPolicy, Combination, LeaveType, Worker } from "../types";
import type { AgentReply } from "./agent";
import { guardrails } from "./guardrails";
import { leaveBalances, leaveLabel } from "./leave";
import { nudgesFor } from "./nudges";
import { evaluateOvertime, overtimeBlockers, overtimeStatus, sheetFor } from "./time";

// ---------------------------------------------------------------------------
// Reading dates out of a sentence: "tomorrow", "next Tuesday", "Dec 14", "2026-12-14".
// ---------------------------------------------------------------------------

export function nextWorkingDay(iso: string) {
  let d = addDays(iso, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE_RE = new RegExp(
  `\\b(\\d{4}-\\d{2}-\\d{2}|today|tomorrow|(?:next |this )?(?:${DAYS.join("|")})|(?:${MONTHS.join("|")})[a-z]*\\.? \\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS.join("|")})[a-z]*)\\b`,
  "gi",
);

/** Every date mentioned, in order, as ISO strings. */
export function datesIn(text: string, today = DEMO_TODAY): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(DATE_RE)) {
    const t = m[1];
    if (/^\d{4}-/.test(t)) out.push(t);
    else if (t === "today") out.push(today);
    else if (t === "tomorrow") out.push(addDays(today, 1));
    else if (DAYS.some((d) => t.endsWith(d))) {
      const want = DAYS.findIndex((d) => t.endsWith(d));
      let d = addDays(today, 1);
      while (weekday(d) !== want) d = addDays(d, 1);
      if (t.startsWith("next ") && weekday(today) !== 0 && want > weekday(today)) d = addDays(d, 7);
      out.push(d);
    } else {
      const mon = MONTHS.findIndex((mm) => t.includes(mm));
      const day = Number(t.match(/\d{1,2}/)![0]);
      let year = Number(today.slice(0, 4));
      const iso = (y: number) => `${y}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (iso(year) < today) year += 1;
      out.push(iso(year));
    }
  }
  return out;
}

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
const ID_RE = /\b(EXP|LV|OT|TS)-\d+\b/i;

// ===========================================================================
// Employee
// ===========================================================================

export function employeeContext(opts: { worker: Worker; policy: ClientPolicy; requests: AnyRequest[] }) {
  const { worker, policy, requests } = opts;
  const cur = worker.currency;
  const ot = overtimeStatus(worker, requests, policy);
  const sheet = sheetFor(worker.id, requests);
  return {
    role: "employee" as const,
    today: DEMO_TODAY,
    nextWorkingDay: nextWorkingDay(DEMO_TODAY),
    you: { name: worker.name, title: worker.title, team: worker.team, country: countryRules[worker.country].name, classification: worker.classification },
    leaveBalances: leaveBalances(worker, requests, policy).map((b) => ({ type: b.type, label: b.label, entitlement: b.entitlement, used: b.used, pending: b.pending, available: b.available })),
    overtime: { eligible: ot.eligible, switchedOn: ot.switchedOn, monthlyLimit: ot.limit, committed: ot.committed, remaining: ot.remaining, forecastByMonthEnd: ot.forecast },
    timesheet: { weekStart: CURRENT_WEEK, status: sheet ? sheet.status : "not submitted" },
    reminders: nudgesFor(worker, requests, policy).map((n) => `${n.title}. ${n.text}`),
    myRequests: requests.filter((r) => r.workerId === worker.id).slice(0, 10).map((r) => ({ id: r.id, title: titleOf(r), value: valueOf(r), status: r.status, whatHappensNext: r.explanations.worker?.text ?? null })),
    policy: {
      mealCapPerPerson: money(policy.expenses.mealCapPerPerson[cur], cur),
      submitExpensesWithinDays: policy.expenses.submitWithinDays,
      leaveNoticeDays: policy.leave.noticeDays,
      vacationDays: policy.leave.vacationDays[worker.country],
      workingHours: policy.workingHours[worker.country],
      overtime: policy.overtime[worker.country],
    },
    law: guardrails(policy)
      .filter((g) => g.country === worker.country)
      .map((g) => ({ setting: g.setting, law: g.law })),
  };
}

export type EmployeeAgentContext = ReturnType<typeof employeeContext>;

const LEAVE_WORDS: [RegExp, LeaveType][] = [
  [/\bsick|ill|unwell\b/, "sick"],
  [/\bbirthday\b/, "birthday"],
  [/\bfloating\b/, "floating"],
  [/\bvolunteer/, "volunteer"],
  [/\bbereavement|funeral\b/, "bereavement"],
  [/\bunpaid\b/, "unpaid"],
  [/\bpaternity\b/, "paternity"],
  [/\bparental\b/, "parental"],
];

export function employeeAgent(prompt: string, ctx: EmployeeAgentContext, data: { worker: Worker; policy: ClientPolicy; requests: AnyRequest[] }): AgentReply {
  const p = prompt.toLowerCase();
  const { worker, policy, requests } = data;
  const wants = (re: RegExp) => re.test(p);
  const asks = wants(/\b(how many|how much|what|when|which|do i|can i|am i|is my|\?)/);

  // ---- Overtime request.
  if (wants(/\bovertime\b/) && !asks) {
    if (!ctx.overtime.eligible) return { reply: "Your role is exempt from overtime, so there's nothing to request.", actions: [] };
    const hours = Number(p.match(/(\d+(?:\.\d)?)\s*(?:h\b|hrs?\b|hours?\b)/)?.[1] ?? 2);
    const date = datesIn(prompt)[0] ?? ctx.nextWorkingDay;
    const reason = cap(prompt.match(/\b(?:for|because|to)\s+(?!\d)(.+?)[.!]?$/i)?.[1]?.replace(/\b(on|next|this)\s+\w+day\b.*$/i, "").trim() || "Requested through Alfie");
    if (hours > 12) return { reply: "Overtime requests are capped at 12 hours for one day. Split it across days, or ask your manager.", actions: [] };
    if (date <= DEMO_TODAY) return { reply: "Overtime is requested before the hours are worked. For hours you've already done, log them on your timesheet instead.", actions: [] };
    const check = evaluateOvertime({ date, hours, reason }, worker, policy, requests);
    const blockers = overtimeBlockers(check.evaluation);
    if (blockers.length) return { reply: `I can't submit that: ${blockers.map((b) => b.detail).join(" ")}`, actions: [] };
    return { reply: `Submitted. Here's your overtime request:`, actions: [{ type: "submit_overtime", date, hours, text: reason }] };
  }

  // ---- Leave request.
  if (wants(/\b(vacation|holiday|time off|day off|days off|leave|pto|sick|birthday|floating|volunteer|bereavement|unpaid|off work)\b/) && wants(/\b(book|request|take|need|submit|log|i'?m|i am|off|out)\b/) && !wants(/\b(how many|left|balance)\b/)) {
    const type = LEAVE_WORDS.find(([re]) => re.test(p))?.[1] ?? "vacation";
    const dates = datesIn(prompt);
    const start = dates[0] ?? (type === "sick" ? DEMO_TODAY : null);
    if (!start) return { reply: `Which dates? For example: "Book ${leaveLabel[type].toLowerCase()} from Dec 14 to Dec 18".`, actions: [] };
    const end = dates[1] && dates[1] >= start ? dates[1] : start;
    return { reply: `Submitted. Here's your ${leaveLabel[type].toLowerCase()} request:`, actions: [{ type: "submit_leave", leaveType: type, start, end, text: "" }] };
  }

  // ---- Timesheet.
  if (wants(/\b(timesheet|my hours|my week)\b/) && wants(/\b(confirm|submit|send|file|log|do)\b/)) {
    if (ctx.timesheet.status !== "not submitted") return { reply: `Your timesheet for the week of ${rangeLabel(CURRENT_WEEK, CURRENT_WEEK)} is already submitted (${ctx.timesheet.status.replace(/_/g, " ")}).`, actions: [] };
    return { reply: `Submitted your timesheet for the week of ${rangeLabel(CURRENT_WEEK, CURRENT_WEEK)}, pre-filled from your schedule, approved overtime and leave:`, actions: [{ type: "confirm_timesheet", text: "" }] };
  }

  // ---- Expenses need a receipt photo.
  if (wants(/\b(expense|receipt|reimburs|claim)\b/) && wants(/\b(submit|file|add|new|claim|log|upload)\b/)) {
    return { reply: "Expenses need a receipt photo, so I've opened New expense. Upload the receipt and the AI fills in the rest for you to check.", actions: [{ type: "go_to", section: "new", text: "" }] };
  }

  // ---- Questions.
  if (wants(/\b(overtime)\b/)) {
    const o = ctx.overtime;
    if (!o.eligible) return { reply: "Your role is exempt from overtime.", actions: [] };
    return { reply: `You've used ${o.committed} of ${o.monthlyLimit} overtime hours this month, so ${o.remaining} are left. At your current pace you'd reach about ${o.forecastByMonthEnd} by month-end.`, actions: [] };
  }
  if (wants(/\b(balance|days (do i have|left)|how many (vacation|days|sick)|vacation left|pto left)\b/)) {
    const rows = ctx.leaveBalances.filter((b) => b.available !== null).map((b) => `• ${b.label}: ${b.available} left${b.pending ? ` (${b.pending} pending)` : ""}`);
    return { reply: `Your balances:\n${rows.join("\n")}`, actions: [] };
  }
  if (wants(/\b(meal|expense polic|cap|limit)\b/)) return { reply: `${client.name}'s meal cap is ${ctx.policy.mealCapPerPerson} per person, and expenses are submitted within ${ctx.policy.submitExpensesWithinDays} days.`, actions: [] };
  if (wants(/\bnotice\b/)) return { reply: `${client.name} asks for ${ctx.policy.leaveNoticeDays} days' notice for planned leave. Shorter notice still goes to your manager, flagged for their decision.`, actions: [] };
  if (wants(/\b(remind|to ?do|due|anything i need|what should i)\b/)) return { reply: ctx.reminders.length ? `Here's what's coming up:\n${ctx.reminders.map((r) => `• ${r}`).join("\n")}` : "Nothing's due right now.", actions: [] };
  if (wants(/\b(status|my requests|where is|what('?s| is) happening)\b/)) {
    return { reply: ctx.myRequests.length ? ctx.myRequests.map((r) => `• ${r.id} · ${r.title} · ${r.status.replace(/_/g, " ")}`).join("\n") : "You haven't submitted anything yet.", actions: [] };
  }

  return {
    reply: `I can submit things for you or answer questions. Try:\n• "Request 2 hours of overtime tomorrow for the release"\n• "Book vacation from Dec 14 to Dec 18"\n• "I'm sick today"\n• "Confirm my timesheet"\n• "How many vacation days do I have?"\n\nClaude isn't connected, so I understand these common requests; with Claude I can handle anything you ask.`,
    actions: [],
  };
}

// ===========================================================================
// Client admin
// ===========================================================================

export function adminContext(opts: { policy: ClientPolicy; requests: AnyRequest[]; combinations: Combination[] }) {
  const { policy, requests } = opts;
  const in30 = addDays(DEMO_TODAY, 30);
  return {
    role: "admin" as const,
    today: DEMO_TODAY,
    you: `${client.admin.name}, ${client.admin.title}`,
    waitingForYou: requests
      .filter((r) => r.status === "awaiting_admin")
      .map((r) => ({
        id: r.id,
        employee: getWorker(r.workerId).name,
        type: r.kind,
        title: titleOf(r),
        value: valueOf(r),
        disclaimers: (r.routing.advisories ?? []).map((a) => a.label),
        aiSuggestion: r.explanations.admin?.headline ?? null,
        aiSummary: r.explanations.admin?.text ?? null,
      })),
    team: workers.map((w) => employeeProfile(w, policy, requests)),
    awayNext30Days: requests
      .filter((r) => r.kind === "leave" && ["approved", "awaiting_admin", "hr_review"].includes(r.status) && r.data.end >= DEMO_TODAY && r.data.start <= in30)
      .map((r) => (r.kind === "leave" ? { employee: getWorker(r.workerId).name, dates: rangeLabel(r.data.start, r.data.end), status: r.status } : null)),
  };
}

export type AdminAgentContext = ReturnType<typeof adminContext>;

function employeeProfile(w: Worker, policy: ClientPolicy, requests: AnyRequest[]) {
  const bal = leaveBalances(w, requests, policy);
  const vac = bal.find((b) => b.type === "vacation");
  const sick = bal.find((b) => b.type === "sick");
  const ot = overtimeStatus(w, requests, policy);
  const mine = requests.filter((r) => r.workerId === w.id);
  return {
    id: w.id,
    name: w.name,
    title: w.title,
    team: w.team,
    country: countryRules[w.country].name,
    startDate: w.startDate,
    classification: w.classification,
    vacation: vac ? { used: vac.used, available: vac.available, entitlement: vac.entitlement } : null,
    sickDaysUsed: sick?.used ?? 0,
    overtime: ot.eligible ? { used: ot.committed, limit: ot.limit, forecast: ot.forecast, spent: money(ot.spent, w.currency) } : "exempt",
    openRequests: mine.filter((r) => ["awaiting_admin", "hr_review", "info_requested", "needs_fix"].includes(r.status)).map((r) => `${r.id} ${titleOf(r)} (${r.status.replace(/_/g, " ")})`),
    recent: mine.slice(0, 5).map((r) => `${r.id} ${titleOf(r)} · ${valueOf(r)} · ${r.status.replace(/_/g, " ")}`),
  };
}

export function adminAgent(prompt: string, ctx: AdminAgentContext, data: { requests: AnyRequest[] }): AgentReply {
  const p = prompt.toLowerCase();
  const { requests } = data;
  const wants = (re: RegExp) => re.test(p);
  const id = prompt.match(ID_RE)?.[0].toUpperCase();
  const waiting = requests.filter((r) => r.status === "awaiting_admin");
  const person = ctx.team.find((t) => p.includes(t.name.toLowerCase()) || p.includes(t.name.split(" ")[0].toLowerCase()));

  // ---- Approve.
  if (wants(/\b(approve|accept|sign off|confirm|ok)\b/)) {
    if (wants(/\ball\b/)) {
      const clean = waiting.filter((r) => r.kind === "expense" && !(r.routing.advisories ?? []).length);
      if (!clean.length) return { reply: "There are no clean expenses waiting. Anything with a disclaimer needs a look first.", actions: [] };
      return { reply: `Approved ${clean.length} expense${clean.length === 1 ? "" : "s"} with no disclaimers. Anything flagged is still on your card.`, actions: clean.map((r) => ({ type: "approve" as const, requestId: r.id, text: "" })) };
    }
    const target = id ? requests.find((r) => r.id === id) : waiting.length === 1 ? waiting[0] : null;
    if (!target) return { reply: waiting.length ? `Which one? Waiting for you: ${waiting.map((r) => r.id).join(", ")}.` : "Nothing is waiting for your approval.", actions: [] };
    return { reply: `Approved ${target.id}.`, actions: [{ type: "approve", requestId: target.id, text: "" }] };
  }

  // ---- Decline: drafted here, confirmed by the admin.
  if (wants(/\b(decline|reject|deny|refuse)\b/)) {
    const target = id ? requests.find((r) => r.id === id) : waiting.length === 1 ? waiting[0] : null;
    if (!target) return { reply: `Which request? Waiting for you: ${waiting.map((r) => r.id).join(", ") || "none"}.`, actions: [] };
    if (target.kind === "timesheet") return { reply: "Hours already worked must be paid, so a timesheet can't be declined. You can confirm it and add a note instead.", actions: [] };
    const reason = cap(prompt.match(/\b(?:because|reason:?)\s+(.+)$/i)?.[1] ?? "Not approved under our policy.");
    return { reply: `I've drafted the decline for ${target.id}. Confirm it below and the employee sees your reason.`, actions: [{ type: "decline", requestId: target.id, text: reason }] };
  }

  // ---- Contact Pebl HR.
  if (wants(/\b(ask hr|contact hr|check with hr|loop in hr|pebl hr)\b/)) {
    const target = id ? requests.find((r) => r.id === id) : null;
    if (!target) return { reply: `Which request should I ask Pebl HR about? For example: "Ask HR about ${waiting[0]?.id ?? "EXP-2001"}: is this compliant?"`, actions: [] };
    const q = prompt.match(/["“](.+?)["”]/)?.[1] ?? prompt.split(/:\s*/)[1] ?? "Can you check this against local law before I decide?";
    return { reply: `Sent your question to Pebl HR. ${target.id} is with them until they answer.`, actions: [{ type: "contact_hr", requestId: target.id, text: cap(q.trim()) }] };
  }

  // ---- Open a request.
  if (wants(/\b(open|show|pull up)\b/) && id) return { reply: `Opening ${id}.`, actions: [{ type: "open_request", requestId: id, text: "" }] };

  // ---- Who's away.
  if (wants(/\b(away|out of office|on leave|off)\b/) && wants(/\b(who|team|anyone)\b/)) {
    const away = ctx.awayNext30Days.filter(Boolean);
    return { reply: away.length ? `Away in the next 30 days:\n${away.map((a) => `• ${a!.employee}: ${a!.dates} (${a!.status.replace(/_/g, " ")})`).join("\n")}` : "No one has leave booked in the next 30 days.", actions: [] };
  }

  // ---- Overtime across the team.
  if (wants(/\bovertime\b/) && !person) {
    const rows = ctx.team.filter((t) => t.overtime !== "exempt").map((t) => (typeof t.overtime === "object" ? `• ${t.name}: ${t.overtime.used} of ${t.overtime.limit} hrs (forecast ${t.overtime.forecast}) · ${t.overtime.spent}` : ""));
    return { reply: `Overtime this month:\n${rows.join("\n")}`, actions: [] };
  }

  // ---- An employee's profile.
  if (person) {
    const v = person.vacation;
    const ot = person.overtime;
    return {
      reply: [
        `${person.name} · ${person.title}, ${person.team} · ${person.country} · since ${person.startDate}`,
        v ? `• Vacation: ${v.available} of ${v.entitlement} days left (${v.used} used)` : null,
        `• Sick days used this year: ${person.sickDaysUsed}`,
        typeof ot === "object" ? `• Overtime this month: ${ot.used} of ${ot.limit} hrs, forecast ${ot.forecast} (${ot.spent})` : "• Overtime: exempt",
        `• Open requests: ${person.openRequests.length ? person.openRequests.join("; ") : "none"}`,
        person.recent.length ? `• Recent: ${person.recent.join("; ")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      actions: [],
    };
  }

  // ---- What's waiting.
  if (wants(/\b(waiting|pending|decision|queue|summar|what needs|to do|my card)\b/)) {
    if (!ctx.waitingForYou.length) return { reply: "Nothing is waiting for your decision.", actions: [] };
    return {
      reply: `${ctx.waitingForYou.length} waiting for you:\n${ctx.waitingForYou.map((r) => `• ${r.id} · ${r.employee} · ${r.title} · ${r.value}${r.aiSuggestion ? ` · Suggestion: ${r.aiSuggestion}` : ""}${r.disclaimers.length ? ` · Disclaimer: ${r.disclaimers.join(", ").toLowerCase()}` : ""}`).join("\n")}`,
      actions: [],
    };
  }

  return {
    reply: `I can look things up or act for you. Try:\n• "Tell me about Priya Shah"\n• "What's waiting for me?"\n• "Approve all clean expenses"\n• "Who's away in the next month?"\n• "How much overtime is the team using?"\n• "Decline LV-4101 because the launch is that week"\n\nClaude isn't connected, so I understand these common requests; with Claude I can handle anything you ask.`,
    actions: [],
  };
}
