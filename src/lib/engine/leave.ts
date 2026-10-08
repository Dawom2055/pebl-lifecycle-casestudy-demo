import { addDays, eachDay, isWeekend, rangeLabel } from "../calendar";
import { DEMO_TODAY, getWorker, leaveRules, leaveTaken } from "../data";
import type {
  AnyRequest,
  ClientPolicy,
  Combination,
  Evaluation,
  LeaveData,
  LeaveInsight,
  LeaveRequest,
  LeaveTier,
  LeaveType,
  Outcome,
  RuleCheck,
  Routing,
  RoutingSignal,
  Worker,
} from "../types";

export const leaveLabel: Record<LeaveType, string> = {
  vacation: "Vacation",
  sick: "Sick leave",
  bereavement: "Bereavement",
  floating: "Floating holiday",
  birthday: "Birthday day",
  volunteer: "Volunteer day",
  unpaid: "Unpaid leave",
  paternity: "Paternity leave",
  parental: "Parental leave",
};

const PLANNED: LeaveType[] = ["vacation", "floating", "birthday", "volunteer", "unpaid"];
const PERKS = ["floating", "birthday", "volunteer"] as const;
const LIVE: AnyRequest["status"][] = ["approved", "awaiting_admin", "hr_review", "info_requested", "changes_suggested"];

export function isPerk(t: LeaveType): t is (typeof PERKS)[number] {
  return (PERKS as readonly string[]).includes(t);
}

export function holidaysFor(worker: Worker) {
  return leaveRules[worker.country].publicHolidays;
}

/** Working days in a range: weekends and public holidays are never deducted. */
export function countLeaveDays(worker: Worker, data: Pick<LeaveData, "start" | "end" | "halfDay">) {
  const holidays = new Map(holidaysFor(worker).map((h) => [h.date, h.name]));
  const days = eachDay(data.start, data.end);
  const holidaysInRange = days.filter((d) => holidays.has(d) && !isWeekend(d)).map((d) => ({ date: d, name: holidays.get(d)! }));
  const working = days.filter((d) => !isWeekend(d) && !holidays.has(d));
  const count = data.halfDay && working.length === 1 ? 0.5 : working.length;
  return { count, working, holidaysInRange };
}

function leaveRequests(requests: AnyRequest[]) {
  return requests.filter((r): r is LeaveRequest => r.kind === "leave");
}

// ---------------------------------------------------------------------------
// Eligible types and live balances (LV-1)
// ---------------------------------------------------------------------------

export interface Balance {
  type: LeaveType;
  label: string;
  entitlement: number | null;
  used: number;
  pending: number;
  available: number | null;
  note: string;
}

export function leaveBalances(worker: Worker, requests: AnyRequest[], policy: ClientPolicy, excludeId?: string): Balance[] {
  const rules = leaveRules[worker.country];
  const p = policy.leave;
  const taken = leaveTaken[worker.id] ?? {};
  const mine = leaveRequests(requests).filter((r) => r.workerId === worker.id && r.id !== excludeId);
  const sum = (type: LeaveType, statuses: AnyRequest["status"][]) =>
    mine.filter((r) => r.data.type === type && statuses.includes(r.status)).reduce((s, r) => s + (r.insight.workingDays - (r.data.unpaidSplit ?? 0)), 0);

  const make = (type: LeaveType, entitlement: number | null, note: string): Balance => {
    const used = (taken[type] ?? 0) + sum(type, ["approved"]);
    const pending = sum(type, ["awaiting_admin", "hr_review", "info_requested"]);
    return { type, label: leaveLabel[type], entitlement, used, pending, available: entitlement === null ? null : entitlement - used, note };
  };

  const out: Balance[] = [
    make("vacation", p.vacationDays[worker.country], rules.vacation?.minimumDays ? `Legal minimum ${rules.vacation.minimumDays} days` : "Company policy"),
    make("sick", Math.max(p.sickPaidDays[worker.country], rules.sick?.minPaidDays ?? 0), rules.sick?.minPaidDays ? `Legal minimum ${rules.sick.minPaidDays} days` : "Company-paid days this year"),
    make("floating", p.perks.floating.days, "Company perk"),
    make("birthday", p.perks.birthday.days, "Company perk"),
    make("volunteer", p.perks.volunteer.days, "Company perk"),
    make("bereavement", null, `As needed, up to ${p.bereavementDays} days each time`),
    make("unpaid", null, `Up to ${p.unpaidShortMaxDays} days goes to your manager`),
  ];
  if (rules.paternity) out.push(make("paternity", rules.paternity.maxDays, "Statutory"));
  if (rules.parental) out.push(make("parental", null, "Statutory"));
  return out;
}

// ---------------------------------------------------------------------------
// Tier: the leave type decides who approves (LV-6)
// ---------------------------------------------------------------------------

export function tierFor(type: LeaveType, days: number, worker: Worker, policy: ClientPolicy): LeaveTier {
  const rules = leaveRules[worker.country];
  const p = policy.leave;
  switch (type) {
    case "sick":
      return days <= (rules.sick?.shortMaxDays ?? 3) ? "auto" : "hr";
    case "bereavement":
      return days <= p.bereavementDays ? "auto" : "hr";
    case "unpaid":
      return days <= p.unpaidShortMaxDays ? "manager" : "hr";
    case "paternity":
    case "parental":
      return "hr";
    case "vacation":
      return "manager";
    default:
      return isPerk(type) ? p.perks[type].tier : "manager";
  }
}

export function leaveCombo(worker: Worker, type: LeaveType) {
  return `${worker.country}:leave:${isPerk(type) ? "perk" : type}`;
}

// ---------------------------------------------------------------------------
// Stage 2 - Rules engine
// ---------------------------------------------------------------------------

export function evaluateLeave(
  data: LeaveData,
  worker: Worker,
  policy: ClientPolicy,
  requests: AnyRequest[],
  selfId?: string,
  asOf = DEMO_TODAY,
): { evaluation: Evaluation; insight: LeaveInsight } {
  const rules = leaveRules[worker.country];
  const p = policy.leave;
  const checks: RuleCheck[] = [];
  const { count, working, holidaysInRange } = countLeaveDays(worker, data);
  const tier = tierFor(data.type, count, worker, policy);

  // Coverage: is there a verified rulebook for this country?
  if (!rules.covered) {
    checks.push({ id: "coverage", label: "Country rules", layer: "country", status: "info", detail: rules.coverageNote ?? "No verified rules for this country yet." });
  }

  // Dates and working days.
  if (data.end < data.start) {
    checks.push({ id: "dates", label: "Dates", layer: "system", status: "fail", detail: "The end date is before the start date.", fixable: true });
  } else if (count === 0) {
    checks.push({ id: "dates", label: "Working days", layer: "system", status: "fail", detail: "There are no working days in this range.", fixable: true });
  } else if (PLANNED.includes(data.type) && data.start < asOf) {
    checks.push({ id: "dates", label: "Dates", layer: "system", status: "fail", detail: "Planned leave can't start in the past.", fixable: true });
  } else {
    checks.push({ id: "dates", label: "Working days counted", layer: "system", status: "pass", detail: `${count} working day${count === 1 ? "" : "s"} (${rangeLabel(data.start, data.end)}). Weekends aren't counted.` });
  }

  if (holidaysInRange.length) {
    checks.push({
      id: "holidays",
      label: "Public holidays",
      layer: "country",
      status: "info",
      detail: `${holidaysInRange.map((h) => `${rangeLabel(h.date, h.date)} (${h.name})`).join(", ")} ${holidaysInRange.length === 1 ? "is a public holiday" : "are public holidays"} and isn't deducted.`,
      ruleId: `${worker.country}-LV-HOL`,
      ruleVersion: "2026.1",
    });
  }

  // Balance.
  const balances = leaveBalances(worker, requests, policy, selfId);
  const bal = balances.find((b) => b.type === data.type);
  const available = bal?.available ?? null;
  const paidDays = count - (data.unpaidSplit ?? 0);
  const balanceAfter = available === null ? null : available - paidDays;
  if (available !== null) {
    const ok = balanceAfter! >= 0;
    checks.push({
      id: "balance",
      label: "Balance",
      layer: data.type === "vacation" && rules.vacation?.minimumDays ? "country" : "client",
      status: ok ? "pass" : "fail",
      detail: ok
        ? `${available} day${available === 1 ? "" : "s"} available; ${balanceAfter} left after this${data.unpaidSplit ? ` (${data.unpaidSplit} unpaid)` : ""}.`
        : `Only ${available} day${available === 1 ? "" : "s"} left for ${paidDays}. Shorten the request or take the rest as unpaid.`,
      ruleId: data.type === "vacation" ? rules.vacation?.id ?? "LUMEN-LV-PTO" : "LUMEN-LV-BAL",
      ruleVersion: data.type === "vacation" ? rules.vacation?.version ?? policy.version : policy.version,
      fixable: !ok,
    });
  }

  // Notice period (planned leave only).
  const notice = Math.round((Date.parse(data.start) - Date.parse(asOf)) / 86_400_000);
  if (PLANNED.includes(data.type)) {
    const ok = notice >= p.noticeDays;
    checks.push({
      id: "notice",
      label: "Notice period",
      layer: "client",
      status: ok ? "pass" : "fail",
      detail: ok ? `${notice} days' notice; policy asks for ${p.noticeDays}.` : `Only ${Math.max(0, notice)} days' notice; policy asks for ${p.noticeDays}.`,
      ruleId: "LUMEN-LV-NOTICE",
      ruleVersion: policy.version,
    });

    const blackout = p.blackouts.find((b) => data.start <= b.end && data.end >= b.start);
    checks.push({
      id: "blackout",
      label: "Blackout periods",
      layer: "client",
      status: blackout ? "fail" : "pass",
      detail: blackout ? `Overlaps the ${blackout.label} blackout (${rangeLabel(blackout.start, blackout.end)}).` : "Not in a blackout period.",
      ruleId: "LUMEN-LV-BLACKOUT",
      ruleVersion: policy.version,
    });

    const tooLong = count > p.maxConsecutiveDays;
    checks.push({
      id: "max_consecutive",
      label: "Max consecutive days",
      layer: "client",
      status: tooLong ? "fail" : "pass",
      detail: tooLong ? `${count} working days in a row; policy allows ${p.maxConsecutiveDays}.` : `Within the ${p.maxConsecutiveDays}-day maximum.`,
      ruleId: "LUMEN-LV-MAXRUN",
      ruleVersion: policy.version,
    });
  }

  // Supporting document (LV-4).
  const docNeeded =
    (data.type === "sick" && count > (rules.sick?.documentAfterDays ?? 3)) || data.type === "paternity" || data.type === "parental";
  if (docNeeded || data.document) {
    if (!data.document) {
      checks.push({
        id: "document",
        label: "Supporting document",
        layer: "country",
        status: tier === "hr" ? "info" : "fail",
        detail: data.type === "sick" ? `A doctor's note is needed for more than ${rules.sick?.documentAfterDays} days. Not uploaded yet.` : "Supporting document not uploaded yet.",
        ruleId: data.type === "sick" ? rules.sick?.id : rules.paternity?.id ?? rules.parental?.id,
        ruleVersion: "2026.1",
        fixable: tier !== "hr",
      });
    } else {
      const r = data.document.read;
      const nameOk = r.name.value.trim().toLowerCase() === worker.name.toLowerCase();
      const datesOk = r.start.value <= data.start && r.end.value >= data.end;
      checks.push({
        id: "document",
        label: "Supporting document",
        layer: "country",
        status: nameOk && datesOk ? "pass" : "fail",
        detail: nameOk && datesOk ? `${data.document.name}: name and dates match the request.` : `${data.document.name}: the ${!nameOk ? "name" : "dates"} don't match the request.`,
        fixable: true,
      });
    }
  }

  // Overlap with the worker's own leave.
  const mine = leaveRequests(requests).filter((r) => r.workerId === worker.id && r.id !== selfId && LIVE.includes(r.status));
  const clash = mine.find((r) => data.start <= r.data.end && data.end >= r.data.start);
  checks.push({
    id: "overlap",
    label: "Overlap with your leave",
    layer: "system",
    status: clash ? "fail" : "pass",
    detail: clash ? `Overlaps ${clash.id} (${leaveLabel[clash.data.type]}, ${rangeLabel(clash.data.start, clash.data.end)}).` : "No overlap with other leave.",
    fixable: true,
  });

  // Carryover and expiry (LV-12), and the legal-minimum guardrail (LV-9).
  let expiring: LeaveInsight["expiring"] = null;
  let legalRisk = false;
  if (data.type === "vacation" && rules.carryover && available !== null) {
    const expiresOn = expiryDate(rules.carryover.expiresOn, asOf, rules.carryover.expiresOn === "12-31" ? 0 : 1);
    // UK-style years lapse at year end apart from the client's carryover; DE/JP carry everything to a later deadline.
    const carryAllowed = rules.carryover.expiresOn === "12-31" ? p.carryoverMaxDays : 0;
    const days = Math.max(0, available - carryAllowed);
    if (days > 0) {
      expiring = { days, date: expiresOn };
      legalRisk = (rules.vacation?.minimumDays ?? 0) > 0;
      checks.push({
        id: "expiry",
        label: "Carryover and expiry",
        layer: "country",
        status: "info",
        detail: `${available} days left; ${days} expire ${rangeLabel(expiresOn, expiresOn)} under local rules${rules.carryover.employerMustWarn ? ". The employer must warn the worker before they lapse" : ""}. ${Math.max(0, days - paidDays) === 0 ? "This request uses them." : `${days - paidDays} would still expire after this.`}`,
        ruleId: rules.carryover.id,
        ruleVersion: rules.carryover.version,
      });
    }
  }

  // Team context (LV-13): who else is away, never why.
  const teamAway = leaveRequests(requests)
    .filter((r) => r.workerId !== worker.id && LIVE.includes(r.status) && getWorker(r.workerId).team === worker.team && data.start <= r.data.end && data.end >= r.data.start)
    .map((r) => ({ name: getWorker(r.workerId).name, start: r.data.start > data.start ? r.data.start : data.start, end: r.data.end < data.end ? r.data.end : data.end }));
  const clearRange = teamAway.length ? longestClearRun(working, teamAway) : null;

  const payTreatment = payFor(data, worker, count);
  const result = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "borderline") ? "borderline" : "pass";

  return {
    evaluation: {
      result,
      checks,
      payroll: { currency: worker.currency, amount: 0, taxableAmount: 0, lines: [payTreatment, "Balance updated when approved"] },
    },
    insight: {
      tier,
      workingDays: count,
      holidaysInRange,
      balanceBefore: available,
      balanceAfter,
      expiring,
      noticeDays: notice,
      teamAway,
      clearRange,
      legalRisk,
      payTreatment,
    },
  };
}

function expiryDate(mmdd: string, asOf: string, yearOffset: number) {
  return `${Number(asOf.slice(0, 4)) + yearOffset}-${mmdd}`;
}

function payFor(data: LeaveData, worker: Worker, days: number) {
  const rules = leaveRules[worker.country];
  const n = `${days} day${days === 1 ? "" : "s"}`;
  const split = data.unpaidSplit ? ` (${days - data.unpaidSplit} paid, ${data.unpaidSplit} unpaid)` : "";
  switch (data.type) {
    case "vacation":
      return `${n} paid at the full rate${split}`;
    case "sick":
      return `${n}: ${rules.sick?.pay ?? "company sick pay"}`;
    case "unpaid":
      return `${n} unpaid`;
    case "paternity":
      return `${n}: ${rules.paternity?.pay ?? "statutory rate"}`;
    case "parental":
      return `${n}: ${rules.parental?.pay ?? "unpaid"}`;
    default:
      return `${n} paid (company policy)`;
  }
}

/** Longest run of consecutive working days in the request with no teammate away. */
function longestClearRun(working: string[], away: { start: string; end: string }[]) {
  let best: string[] = [];
  let cur: string[] = [];
  for (const d of working) {
    const busy = away.some((a) => d >= a.start && d <= a.end);
    if (busy) cur = [];
    else {
      if (cur.length && addDays(cur[cur.length - 1], 1) !== d && !isOnlyWeekendBetween(cur[cur.length - 1], d)) cur = [];
      cur.push(d);
      if (cur.length > best.length) best = [...cur];
    }
  }
  return best.length ? { start: best[0], end: best[best.length - 1] } : null;
}

function isOnlyWeekendBetween(a: string, b: string) {
  for (let d = addDays(a, 1); d < b; d = addDays(d, 1)) if (!isWeekend(d)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Stage 3 - Risk router. The type sets the tier; signals only move it up to HR.
// ---------------------------------------------------------------------------

export function routeLeave(
  data: LeaveData,
  worker: Worker,
  evaluation: Evaluation,
  insight: LeaveInsight,
  policy: ClientPolicy,
  combinations: Combination[],
  fixCount: number,
): Routing {
  const combination = leaveCombo(worker, data.type);
  const unlocked = combinations.find((c) => c.key === combination)?.status === "unlocked";
  const fails = evaluation.checks.filter((c) => c.status === "fail");
  const fixable = fails.filter((c) => c.fixable);
  // Notice is the client's own rule: short notice goes to the client admin as a disclaimer, not to Pebl HR.
  const short = fails.find((c) => c.id === "notice");
  const advisories: RoutingSignal[] = short ? [{ id: "rules_fail", label: "Short notice", detail: short.detail }] : [];
  const hard = fails.filter((c) => !c.fixable && c.id !== "notice");

  if (fixable.length && !hard.length && fixCount < 1) {
    return { outcome: "back_to_worker", signals: fixable.map((c) => ({ id: "rules_fail", label: c.label, detail: c.detail })), combination, unlocked };
  }

  const signals: RoutingSignal[] = [];
  if (!leaveRules[worker.country].covered) {
    signals.push({ id: "no_rule", label: "No verified rule", detail: `No verified leave rules for ${worker.country} yet, so HR handles it.` });
  }
  if (insight.tier === "hr") {
    signals.push({ id: "tier", label: "Statutory leave", detail: `${leaveLabel[data.type]} is reviewed by HR: statutory pay, documents and job protection.` });
  }
  for (const c of fails.filter((x) => x.id !== "notice")) signals.push({ id: "rules_fail", label: `Rule failed: ${c.label}`, detail: c.detail });
  for (const c of evaluation.checks.filter((x) => x.status === "borderline")) signals.push({ id: "rules_borderline", label: `Borderline: ${c.label}`, detail: c.detail });
  if (insight.workingDays > policy.leave.hrReviewOverDays) {
    signals.push({ id: "duration", label: "Long absence", detail: `${insight.workingDays} working days is over the ${policy.leave.hrReviewOverDays}-day review threshold.` });
  }
  const doc = data.document;
  if (doc && Object.values(doc.read).some((f) => f.confidence < 0.8)) {
    signals.push({ id: "low_confidence", label: "Low AI confidence", detail: "The AI was unsure reading the supporting document." });
  }

  const base: Outcome = insight.tier === "auto" ? "auto_clear" : insight.tier === "manager" ? "manager" : "hr_exception";
  // With a disclaimer, even leave that would be approved automatically waits for the manager.
  const would: Outcome = signals.length ? "hr_exception" : advisories.length && base === "auto_clear" ? "manager" : base;
  // When it goes to HR anyway, HR sees the disclaimer alongside the flags.
  const withAdvisories = () => [...signals, ...advisories];

  // Statutory types always go to HR, so shadow mode adds nothing there.
  if (!unlocked && base !== "hr_exception") {
    signals.push({ id: "not_unlocked", label: "Shadow mode", detail: `${combination} isn't unlocked yet, so HR still decides. The system records what it would have done.` });
    return { outcome: "hr_exception", signals: withAdvisories(), combination, unlocked, shadowWould: would, advisories };
  }
  if (would === "manager" && !advisories.length && data.type === "vacation" && policy.leave.autoApproveVacationUpToDays != null && insight.workingDays <= policy.leave.autoApproveVacationUpToDays) {
    return { outcome: "auto_clear", signals, combination, unlocked, clientAutoApproved: true };
  }
  return { outcome: would, signals: would === "hr_exception" ? withAdvisories() : signals, combination, unlocked, advisories };
}

/** Leave that the worker's teammates have booked: shown on the employee's and manager's calendars. */
export function teamLeave(teamOf: string, requests: AnyRequest[]) {
  return leaveRequests(requests).filter((r) => getWorker(r.workerId).team === teamOf && LIVE.includes(r.status));
}

