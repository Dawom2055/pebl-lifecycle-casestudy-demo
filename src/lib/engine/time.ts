import { addDays, dayName, minutes, monthOf, rangeLabel, weekDays, workedHours, workingDaysBetween, endOfMonth } from "../calendar";
import { CURRENT_WEEK, DEMO_TODAY, leaveRules, timeRules, workerTime } from "../data";
import { money } from "../format";
import type {
  AnyRequest,
  ClientPolicy,
  Combination,
  Evaluation,
  LeaveRequest,
  OvertimeData,
  OvertimeInsight,
  OvertimeRequest,
  RuleCheck,
  Routing,
  RoutingSignal,
  TimesheetData,
  TimesheetDay,
  TimesheetInsight,
  TimesheetRequest,
  Worker,
} from "../types";

const COUNTS = new Set<AnyRequest["status"]>(["approved", "awaiting_admin", "hr_review", "info_requested"]);

// ---------------------------------------------------------------------------
// Limits: the stricter of the client's limit and the legal cap (TM-4)
// ---------------------------------------------------------------------------

export function overtimeLimits(worker: Worker, policy: ClientPolicy) {
  const law = timeRules[worker.country];
  const client = policy.overtime[worker.country];
  const legalCap = law.covered ? law.monthlyOvertimeCap : null;
  const prerequisiteMissing = !!law.prerequisite && worker.country === "JP" && !client.article36OnFile;
  const eligible = worker.classification === "salaried_overtime_eligible" || worker.classification === "hourly";
  const switchedOn = client.allowed && !prerequisiteMissing;
  const limit = !switchedOn ? 0 : legalCap === null ? client.monthlyLimit : Math.min(client.monthlyLimit, legalCap);
  const premiumPct = Math.max(client.premiumPct, law.covered ? law.statutoryPremiumPct : 0);
  return { law, client, legalCap, limit, eligible, switchedOn, prerequisiteMissing, premiumPct, rate: workerTime[worker.id].hourlyRate };
}

// ---------------------------------------------------------------------------
// Running totals and the AI forecast (TM-5, TM-8)
// ---------------------------------------------------------------------------

export interface OvertimeStatus {
  limit: number;
  clientLimit: number;
  legalCap: number | null;
  earlier: number;
  thisWeek: number;
  upcoming: number;
  pending: number;
  used: number;
  committed: number;
  remaining: number;
  forecast: number;
  pct: number;
  alerts: { level: "heads_up" | "manager" | "forecast"; text: string }[];
  budget: number;
  spent: number;
  eligible: boolean;
  switchedOn: boolean;
}

export function overtimeStatus(worker: Worker, requests: AnyRequest[], policy: ClientPolicy, opts: { excludeId?: string; asOf?: string } = {}): OvertimeStatus {
  const asOf = opts.asOf ?? DEMO_TODAY;
  const L = overtimeLimits(worker, policy);
  const wt = workerTime[worker.id];
  const month = monthOf(asOf);
  const ot = requests.filter((r): r is OvertimeRequest => r.kind === "overtime" && r.workerId === worker.id && r.id !== opts.excludeId && monthOf(r.data.date) === month);
  const sheet = requests.find(
    (r): r is TimesheetRequest => r.kind === "timesheet" && r.workerId === worker.id && r.id !== opts.excludeId && r.data.weekStart === CURRENT_WEEK && COUNTS.has(r.status),
  );

  const weekEnd = addDays(CURRENT_WEEK, 4);
  const approvedThisWeek = ot.filter((r) => r.status === "approved" && r.data.date >= CURRENT_WEEK && r.data.date <= weekEnd && r.data.date <= asOf).reduce((s, r) => s + r.data.hours, 0);
  const thisWeek = sheet ? sheet.insight.overtimeHours : approvedThisWeek;
  const upcoming = ot.filter((r) => r.status === "approved" && r.data.date > asOf && r.data.date > weekEnd).reduce((s, r) => s + r.data.hours, 0);
  const pending = ot.filter((r) => r.status === "awaiting_admin" || r.status === "hr_review").reduce((s, r) => s + r.data.hours, 0);
  const earlier = wt.overtimeEarlierThisMonth;
  const used = earlier + thisWeek;
  const committed = used + upcoming;
  const holidays = new Set(leaveRules[worker.country].publicHolidays.map((h) => h.date));
  const daysLeft = workingDaysBetween(addDays(asOf, 1), endOfMonth(asOf), holidays).length;
  const forecast = Math.round(committed + pending + wt.unplannedPerWeek * (daysLeft / 5));
  const pct = L.limit ? committed / L.limit : 0;

  const alerts: OvertimeStatus["alerts"] = [];
  if (L.limit && L.eligible) {
    if (forecast > L.limit) alerts.push({ level: "forecast", text: `On pace for ${forecast} of ${L.limit} hours by month-end. Pebl HR is alerted before the limit is crossed.` });
    if (pct >= 0.9) alerts.push({ level: "manager", text: `${committed} of ${L.limit} hours used. Stop or reschedule further overtime.` });
    else if (pct >= 0.8) alerts.push({ level: "heads_up", text: `${committed} of ${L.limit} hours used. Heads-up for the worker and manager.` });
  }

  const cost = (h: number) => h * L.rate * (1 + L.premiumPct / 100);
  return {
    limit: L.limit,
    clientLimit: L.client.monthlyLimit,
    legalCap: L.legalCap,
    earlier,
    thisWeek,
    upcoming,
    pending,
    used,
    committed,
    remaining: Math.max(0, L.limit - committed - pending),
    forecast,
    pct,
    alerts,
    budget: L.client.monthlyBudget,
    spent: cost(committed),
    eligible: L.eligible,
    switchedOn: L.switchedOn,
  };
}

// ---------------------------------------------------------------------------
// Before: overtime requests (TM-6, TM-7). Hard limits are checked before submit.
// ---------------------------------------------------------------------------

export function evaluateOvertime(
  data: OvertimeData,
  worker: Worker,
  policy: ClientPolicy,
  requests: AnyRequest[],
  selfId?: string,
  asOf = DEMO_TODAY,
): { evaluation: Evaluation; insight: OvertimeInsight } {
  const L = overtimeLimits(worker, policy);
  const law = L.law;
  const st = overtimeStatus(worker, requests, policy, { excludeId: selfId, asOf });
  const checks: RuleCheck[] = [];
  const sched = workerTime[worker.id].schedule;
  const cur = worker.currency;
  const hours = data.hours;

  checks.push({
    id: "eligible",
    label: "Overtime-eligible",
    layer: "system",
    status: L.eligible ? "pass" : "fail",
    detail: L.eligible
      ? `Classified by Pebl HR as ${worker.classification === "hourly" ? "hourly" : "salaried, overtime-eligible"}.`
      : worker.classification === "unclear"
        ? "Classification hasn't been confirmed by Pebl HR yet."
        : "Classified as exempt, so overtime doesn't apply.",
  });

  if (!law.covered) {
    checks.push({ id: "coverage", label: "Country rules", layer: "country", status: "info", detail: law.coverageNote ?? "No verified working-time rules yet." });
  }

  if (law.covered && law.prerequisite) {
    checks.push({
      id: "prerequisite",
      label: law.prerequisite,
      layer: "country",
      status: L.prerequisiteMissing ? "fail" : "pass",
      detail: L.prerequisiteMissing ? `No ${law.prerequisite} on file, so overtime stays switched off.` : `${law.prerequisite} on file.`,
      ruleId: law.id,
      ruleVersion: law.version,
    });
  }

  checks.push({
    id: "allowed",
    label: "Overtime allowed",
    layer: "client",
    status: L.client.allowed ? "pass" : "fail",
    detail: L.client.allowed ? "Lumen allows overtime in this country." : "Lumen doesn't allow overtime in this country.",
    ruleId: "LUMEN-TM-OT",
    ruleVersion: policy.version,
  });

  checks.push({
    id: "date",
    label: "Requested in advance",
    layer: "system",
    status: data.date > asOf ? "pass" : "fail",
    detail: data.date > asOf ? `For ${dayName(data.date)} ${rangeLabel(data.date, data.date)}, before the hours are worked.` : "Overtime is requested before the hours are worked. Log hours already worked on your timesheet.",
    fixable: true,
  });

  const before = st.committed + st.pending;
  const after = before + hours;
  const withinLimit = after <= L.limit;
  checks.push({
    id: "limit",
    label: "Monthly overtime limit",
    layer: "client",
    status: withinLimit ? "pass" : "fail",
    detail: withinLimit
      ? `Brings monthly overtime to ${after} of ${L.limit} hours (${L.legalCap !== null ? `company limit${L.client.monthlyLimit > L.legalCap ? " capped by law" : ""}; legal cap ${L.legalCap}` : "company limit"}).`
      : `Would bring monthly overtime to ${after} of ${L.limit}. Managers can't approve beyond the limit.`,
    ruleId: "LUMEN-TM-LIMIT",
    ruleVersion: policy.version,
    fixable: true,
  });

  if (law.covered && law.dailyMax) {
    const day = law.standardDailyHours + hours;
    checks.push({
      id: "daily_max",
      label: "Daily maximum",
      layer: "country",
      status: day <= law.dailyMax ? "pass" : "fail",
      detail: `${day} hours that day; the legal maximum is ${law.dailyMax}.`,
      ruleId: law.id,
      ruleVersion: law.version,
      fixable: true,
    });
  }

  if (law.covered && law.minRestHours) {
    const endMin = minutes(sched.end) + hours * 60;
    const rest = (24 * 60 - endMin + minutes(sched.start)) / 60;
    checks.push({
      id: "rest",
      label: "Rest period",
      layer: "country",
      status: rest >= law.minRestHours ? "pass" : "fail",
      detail: `${round1(rest)} hours' rest before the next shift; at least ${law.minRestHours} required.`,
      ruleId: law.id,
      ruleVersion: law.version,
      fixable: true,
    });
  }

  const cost = hours * L.rate * (1 + L.premiumPct / 100);
  const overBudget = st.spent + cost > L.client.monthlyBudget;
  checks.push({
    id: "budget",
    label: "Overtime budget",
    layer: "client",
    status: overBudget ? "borderline" : "pass",
    detail: `${money(cost, worker.currency)} against ${money(Math.max(0, L.client.monthlyBudget - st.spent), cur)} left of the ${money(L.client.monthlyBudget, cur)} monthly budget.`,
    ruleId: "LUMEN-TM-BUDGET",
    ruleVersion: policy.version,
  });

  const forecast = Math.round(st.forecast + hours);
  if (forecast > L.limit && withinLimit) {
    checks.push({ id: "forecast", label: "Month-end forecast", layer: "system", status: "info", detail: `At the current pace, forecast to reach ${forecast} hours by month-end.` });
  }

  const partial = forecast > L.limit && withinLimit ? Math.max(1, hours - (forecast - L.limit)) : null;
  const result = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "borderline") ? "borderline" : "pass";
  return {
    evaluation: {
      result,
      checks,
      payroll: {
        currency: cur,
        amount: round2(cost),
        taxableAmount: 0,
        lines: [`${hours} hours at a ${L.premiumPct}% premium = ${money(cost, cur)}`, "Paid in the month it's worked"],
      },
    },
    insight: {
      limit: L.limit,
      clientLimit: L.client.monthlyLimit,
      legalCap: L.legalCap,
      usedBefore: before,
      after,
      forecast,
      cost: round2(cost),
      premiumPct: L.premiumPct,
      remainingAfter: Math.max(0, L.limit - after),
      partialHours: partial !== null && partial < hours ? partial : null,
      overBudget,
      prerequisite: law.covered ? law.prerequisite : null,
    },
  };
}

/** Problems that block an overtime request before it's sent: it never becomes a request a manager could wrongly approve. */
export function overtimeBlockers(evaluation: Evaluation) {
  return evaluation.checks.filter((c) => c.status === "fail");
}

export function routeOvertime(worker: Worker, evaluation: Evaluation, policy: ClientPolicy, combinations: Combination[]): Routing {
  const combination = `${worker.country}:time:overtime`;
  const unlocked = combinations.find((c) => c.key === combination)?.status === "unlocked";
  const signals: RoutingSignal[] = [];
  if (!timeRules[worker.country].covered) signals.push({ id: "no_rule", label: "No verified rule", detail: `No verified working-time rules for ${worker.country} yet.` });
  for (const c of evaluation.checks.filter((x) => x.status === "fail")) signals.push({ id: "rules_fail", label: `Rule failed: ${c.label}`, detail: c.detail });

  // Over budget is a client-policy question, not a legal one: it stays with the client's manager.
  const would = signals.length ? "hr_exception" : policy.overtime[worker.country].mode === "auto_within_limit" ? "auto_clear" : "manager";
  if (!unlocked) {
    signals.push({ id: "not_unlocked", label: "Shadow mode", detail: `${combination} isn't unlocked yet, so HR still decides. The system records what it would have done.` });
    return { outcome: "hr_exception", signals, combination, unlocked, shadowWould: would };
  }
  return { outcome: would, signals, combination, unlocked, clientAutoApproved: would === "auto_clear" };
}

// ---------------------------------------------------------------------------
// After: timesheets (TM-9 to TM-13)
// ---------------------------------------------------------------------------

/** Pre-fills the week from the standard schedule plus approved overtime and approved leave (TM-9). */
export function prefillWeek(worker: Worker, requests: AnyRequest[], weekStart = CURRENT_WEEK): TimesheetDay[] {
  const sched = workerTime[worker.id].schedule;
  const holidays = new Map(leaveRules[worker.country].publicHolidays.map((h) => [h.date, h.name]));
  return weekDays(weekStart).map((date) => {
    const leave = requests.find((r): r is LeaveRequest => r.kind === "leave" && r.workerId === worker.id && r.status === "approved" && date >= r.data.start && date <= r.data.end);
    if (holidays.has(date)) return { date, start: sched.start, end: sched.start, breakMin: 0, off: holidays.get(date) };
    if (leave) return { date, start: sched.start, end: sched.start, breakMin: 0, off: leave.data.type === "sick" ? "Sick leave" : "Leave" };
    const ot = approvedOvertimeOn(worker.id, date, requests);
    return { date, start: sched.start, end: addMinutes(sched.end, ot * 60), breakMin: sched.breakMin };
  });
}

function approvedOvertimeOn(workerId: string, date: string, requests: AnyRequest[]) {
  return requests
    .filter((r): r is OvertimeRequest => r.kind === "overtime" && r.workerId === workerId && r.status === "approved" && r.data.date === date)
    .reduce((s, r) => s + r.data.hours, 0);
}

function addMinutes(hhmmStr: string, add: number) {
  const m = minutes(hhmmStr) + add;
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function evaluateTimesheet(
  data: TimesheetData,
  worker: Worker,
  policy: ClientPolicy,
  requests: AnyRequest[],
  selfId?: string,
): { evaluation: Evaluation; insight: TimesheetInsight } {
  const L = overtimeLimits(worker, policy);
  const law = L.law;
  const std = law.covered ? law.standardDailyHours : 8;
  const cur = worker.currency;
  const checks: RuleCheck[] = [];
  const paidUnder = law.covered ? law.paidBreakUnderMinutes : undefined;
  const worked = data.days.map((d) => ({ ...d, hours: d.off ? 0 : workedHours(d.start, d.end, d.breakMin, paidUnder) }));
  const total = sum(worked.map((d) => d.hours));
  const otByDay = worked.map((d) => ({ date: d.date, ot: Math.max(0, d.hours - std) }));
  const overtime = round1(sum(otByDay.map((d) => d.ot)));
  const preApproved = round1(sum(otByDay.map((d) => Math.min(d.ot, approvedOvertimeOn(worker.id, d.date, requests)))));
  const unapproved = round1(overtime - preApproved);
  const st = overtimeStatus(worker, requests, policy, { excludeId: selfId });
  const monthBefore = st.earlier + st.upcoming;
  const monthAfter = round1(monthBefore + overtime);

  // Classification (set by people, not AI): decides which checks run (TM-3).
  const exempt = worker.classification === "salaried_exempt";
  checks.push({
    id: "classification",
    label: "Classification",
    layer: "system",
    status: worker.classification === "unclear" ? "fail" : "pass",
    detail:
      worker.classification === "unclear"
        ? "Pebl HR hasn't confirmed this worker's classification, so the right checks can't be picked."
        : exempt
          ? "Salaried, exempt: lighter tracking, no overtime pay. Hours and rest limits may still apply."
          : `Salaried, overtime-eligible (set by Pebl HR).`,
  });

  if (!law.covered) {
    checks.push({ id: "coverage", label: "Country rules", layer: "country", status: "info", detail: law.coverageNote ?? "No verified working-time rules yet." });
  }

  if (!exempt) {
    checks.push({
      id: "approvals",
      label: "Matches approved overtime",
      layer: "system",
      status: unapproved > 0 ? "info" : "pass",
      detail:
        unapproved > 0
          ? `${unapproved} overtime hour${unapproved === 1 ? "" : "s"} without pre-approval (${otByDay.filter((d) => d.ot > approvedOvertimeOn(worker.id, d.date, requests)).map((d) => `${dayName(d.date)} ${rangeLabel(d.date, d.date)}`).join(", ")}). They must still be paid.`
          : overtime > 0
            ? `All ${overtime} overtime hours were approved in advance.`
            : "Matches the standard schedule; no overtime.",
    });

    checks.push({
      id: "limit",
      label: "Company overtime limit",
      layer: "client",
      status: monthAfter > L.client.monthlyLimit ? "fail" : "pass",
      detail: `Monthly overtime ${monthAfter} of ${L.client.monthlyLimit} hours.`,
      ruleId: "LUMEN-TM-LIMIT",
      ruleVersion: policy.version,
    });
    if (L.legalCap !== null) {
      checks.push({
        id: "legal_cap",
        label: "Legal overtime cap",
        layer: "country",
        status: monthAfter > L.legalCap ? "fail" : "pass",
        detail: `${monthAfter} of ${L.legalCap} hours (${law.capNote}).`,
        ruleId: law.id,
        ruleVersion: law.version,
      });
    }
  }

  const longDays = worked.filter((d) => d.hours >= 13).map((d) => `${dayName(d.date)} ${rangeLabel(d.date, d.date)} (${round1(d.hours)} hours)`);
  if (law.covered && law.dailyMax) {
    const over = worked.filter((d) => d.hours > law.dailyMax!);
    checks.push({
      id: "daily_max",
      label: "Daily maximum",
      layer: "country",
      status: over.length ? "fail" : "pass",
      detail: over.length ? `${over.map((d) => `${dayName(d.date)} ${round1(d.hours)}h`).join(", ")} over the ${law.dailyMax}-hour legal maximum.` : `No day over ${law.dailyMax} hours.`,
      ruleId: law.id,
      ruleVersion: law.version,
    });
  }
  if (law.covered && law.weeklyMax) {
    checks.push({
      id: "weekly_max",
      label: "Weekly hours",
      layer: "country",
      status: total > law.weeklyMax ? "borderline" : "pass",
      detail: `${round1(total)} hours this week; the ${law.weeklyMax}-hour limit is an average, so one long week is borderline.`,
      ruleId: law.id,
      ruleVersion: law.version,
    });
  }

  const restBreaches: string[] = [];
  if (law.covered && law.minRestHours) {
    for (let i = 0; i < worked.length - 1; i++) {
      const a = worked[i];
      const b = worked[i + 1];
      if (a.off || b.off) continue;
      const rest = (24 * 60 - minutes(a.end) + minutes(b.start)) / 60;
      if (rest < law.minRestHours) restBreaches.push(`${dayName(a.date)} to ${dayName(b.date)}: ${round1(rest)} hours`);
    }
    checks.push({
      id: "rest",
      label: "Rest between shifts",
      layer: "country",
      status: restBreaches.length ? "fail" : "pass",
      detail: restBreaches.length ? `${restBreaches.join("; ")}. At least ${law.minRestHours} hours required.` : `At least ${law.minRestHours} hours between every shift.`,
      ruleId: law.id,
      ruleVersion: law.version,
    });
  }

  // Short breaks counted as paid time (US): say so, so the pay calculation is traceable.
  const paidBreaks = paidUnder ? worked.filter((d) => !d.off && d.breakMin > 0 && d.breakMin < paidUnder) : [];
  if (paidUnder) {
    checks.push({
      id: "paid_breaks",
      label: "Paid breaks",
      layer: "country",
      status: "info",
      detail: paidBreaks.length
        ? `${paidBreaks.map((d) => `${dayName(d.date)} ${d.breakMin} min`).join(", ")} counted as paid working time. ${law.paidBreakNote ?? ""}`.trim()
        : `Breaks of ${paidUnder} minutes or more are unpaid meal breaks; shorter ones would be paid.`,
      ruleId: law.id,
      ruleVersion: law.version,
    });
  }

  const breakIssues: string[] = [];
  if (law.covered && law.breakRule) {
    const br = law.breakRule;
    for (const d of worked) {
      if (d.off) continue;
      const need = br.longAfterHours && d.hours > br.longAfterHours ? br.longMinutes! : d.hours > br.afterHours ? br.minutes : 0;
      if (d.breakMin < need) breakIssues.push(`${dayName(d.date)}: ${d.breakMin} of ${need} minutes`);
    }
    checks.push({
      id: "breaks",
      label: "Breaks",
      layer: "country",
      status: breakIssues.length ? "fail" : "pass",
      detail: breakIssues.length ? `Break too short on ${breakIssues.join("; ")}.` : "Breaks meet the legal minimum every day.",
      ruleId: law.id,
      ruleVersion: law.version,
    });
  }

  const cost = exempt ? 0 : overtime * L.rate * (1 + L.premiumPct / 100);
  checks.push({
    id: "pay",
    label: "Pay calculation",
    layer: "system",
    status: "info",
    detail: exempt ? `${round1(total)} hours recorded. No overtime pay for exempt staff.` : overtime > 0 ? `${overtime} overtime hours at a ${L.premiumPct}% premium = ${money(cost, cur)}, paid through payroll.` : `${round1(total)} standard hours.`,
  });

  const result = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "borderline") ? "borderline" : "pass";
  return {
    evaluation: {
      result,
      checks,
      payroll: {
        currency: cur,
        amount: round2(cost),
        taxableAmount: 0,
        lines: [`${round1(total)} hours recorded`, ...(overtime > 0 && !exempt ? [`${overtime} overtime hours at ${L.premiumPct}% premium: ${money(cost, cur)}`] : []), "Every hour worked is paid"],
      },
    },
    insight: {
      totalHours: round1(total),
      overtimeHours: exempt ? 0 : overtime,
      preApproved,
      unapproved: exempt ? 0 : unapproved,
      monthBefore,
      monthAfter,
      limit: L.limit,
      legalCap: L.legalCap,
      cost: round2(cost),
      premiumPct: L.premiumPct,
      longDays,
      restBreaches,
      breakIssues,
    },
  };
}

export function routeTimesheet(worker: Worker, evaluation: Evaluation, insight: TimesheetInsight, combinations: Combination[]): Routing {
  const combination = `${worker.country}:time:timesheet`;
  const unlocked = combinations.find((c) => c.key === combination)?.status === "unlocked";
  const signals: RoutingSignal[] = [];
  if (!timeRules[worker.country].covered) signals.push({ id: "no_rule", label: "No verified rule", detail: `No verified working-time rules for ${worker.country} yet.` });
  for (const c of evaluation.checks.filter((x) => x.status === "fail")) {
    signals.push({ id: c.id === "rest" ? "rest" : c.id === "limit" || c.id === "legal_cap" ? "limit" : "rules_fail", label: `Rule failed: ${c.label}`, detail: c.detail });
  }
  for (const c of evaluation.checks.filter((x) => x.status === "borderline")) signals.push({ id: "rules_borderline", label: `Borderline: ${c.label}`, detail: c.detail });
  if (insight.longDays.length) signals.push({ id: "anomaly", label: "Unusual day", detail: `AI flagged ${insight.longDays.join(", ")}.` });

  const would = signals.length ? "hr_exception" : insight.unapproved > 0 ? "manager" : "auto_clear";
  if (would === "manager") signals.push({ id: "unapproved_hours", label: "Overtime without pre-approval", detail: `${insight.unapproved} hours within the limit. The manager confirms; they can't refuse to pay.` });
  if (!unlocked) {
    signals.push({ id: "not_unlocked", label: "Shadow mode", detail: `${combination} isn't unlocked yet, so HR still decides. The system records what it would have done.` });
    return { outcome: "hr_exception", signals, combination, unlocked, shadowWould: would };
  }
  return { outcome: would, signals, combination, unlocked };
}

export function sheetFor(workerId: string, requests: AnyRequest[], weekStart = CURRENT_WEEK) {
  return requests.find((r): r is TimesheetRequest => r.kind === "timesheet" && r.workerId === workerId && r.data.weekStart === weekStart && r.status !== "withdrawn");
}

export function monthLabel(asOf = DEMO_TODAY) {
  return new Date(`${asOf}T00:00:00Z`).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
