import { hhmm, minutes } from "../calendar";
import { countryRules, leaveRules, timeRules } from "../data";
import type { ClientPolicy, CountryCode } from "../types";

/**
 * Prevention: every setting in a client's policy, checked against the law of each country the
 * client employs people in. A setting that would put a worker below a legal minimum (or above a
 * legal maximum) is a "block": the policy can't be saved until it's fixed, and the fix sets the
 * legal value. The same rules the rules engine uses for requests, so policy and requests agree.
 */
export interface Guardrail {
  country: CountryCode;
  area: "leave" | "hours" | "overtime";
  setting: string;
  law: string;
  company: string;
  status: "ok" | "block" | "info" | "locked";
  /** What's wrong, in one sentence, when status is block or info. */
  message?: string;
  rule?: string;
  /** Sets the legal value. */
  fix?: { label: string; apply(p: ClientPolicy): ClientPolicy };
}

export const POLICY_COUNTRIES: CountryCode[] = ["UK", "US", "CA", "DE", "JP"];

const ADJECTIVE: Record<CountryCode, string> = { UK: "UK", US: "US", CA: "Canadian", DE: "German", JP: "Japanese" };
/** "German law", "UK law". */
const lawOf = (c: CountryCode) => `${ADJECTIVE[c]} law`;
const name = (c: CountryCode) => countryRules[c].name.replace("United Kingdom", "the UK").replace("United States", "the US");
const ruleRef = (r?: { id: string; version: string }) => (r ? `${r.id} v${r.version}` : undefined);
const hrs = (n: number) => `${Math.round(n * 10) / 10} hrs`;

/** UK bank holidays count toward the 5.6 weeks; the client grants them on top of paid vacation. */
const BANK_HOLIDAYS_ON_TOP: Partial<Record<CountryCode, number>> = { UK: 8 };

/** Hours worked in the company's standard day, after the unpaid break. */
export function scheduledDayHours(p: ClientPolicy, c: CountryCode) {
  const w = p.workingHours[c];
  let span = minutes(w.end) - minutes(w.start);
  if (span <= 0) span += 1440;
  return Math.max(0, (span - w.breakMin) / 60);
}

/** The break the law requires for a day of this many working hours. */
function requiredBreak(c: CountryCode, dayHours: number) {
  const br = timeRules[c].breakRule;
  if (!br) return 0;
  if (br.longAfterHours && dayHours > br.longAfterHours) return br.longMinutes ?? br.minutes;
  return dayHours > br.afterHours ? br.minutes : 0;
}

export function guardrails(p: ClientPolicy): Guardrail[] {
  const out: Guardrail[] = [];
  for (const c of POLICY_COUNTRIES) out.push(...leaveGuardrails(p, c), ...hoursGuardrails(p, c), ...overtimeGuardrails(p, c));
  return out;
}

function leaveGuardrails(p: ClientPolicy, c: CountryCode): Guardrail[] {
  const law = leaveRules[c];
  const out: Guardrail[] = [];
  if (!law.covered) {
    out.push({ country: c, area: "leave", setting: "Leave entitlements", law: "Provincial, not verified yet", company: `${p.leave.vacationDays[c]} vacation days`, status: "info", message: `${law.coverageNote ?? ""} Pebl HR checks each request by hand.`.trim() });
    return out;
  }

  // Paid vacation.
  const min = law.vacation?.minimumDays ?? 0;
  const extra = BANK_HOLIDAYS_ON_TOP[c] ?? 0;
  const days = p.leave.vacationDays[c];
  const vacOk = days + extra >= min;
  out.push({
    country: c,
    area: "leave",
    setting: "Paid vacation",
    law: min ? `At least ${min} days${extra ? " (bank holidays count)" : ""}` : "No legal minimum",
    company: `${days} days${extra ? ` + ${extra} bank holidays` : ""}`,
    status: vacOk ? "ok" : "block",
    message: vacOk ? undefined : `${lawOf(c)} requires at least ${min} days of paid vacation a year${extra ? `, and ${days} plus ${extra} bank holidays is ${days + extra}` : `; ${days} is below that`}.`,
    rule: ruleRef(law.vacation),
    fix: vacOk ? undefined : { label: `Set to ${min - extra} days`, apply: (q) => ({ ...q, leave: { ...q.leave, vacationDays: { ...q.leave.vacationDays, [c]: min - extra } } }) },
  });

  // Paid sick days.
  const sickMin = law.sick?.minPaidDays ?? 0;
  const sick = p.leave.sickPaidDays[c];
  const sickOk = sick >= sickMin;
  out.push({
    country: c,
    area: "leave",
    setting: "Paid sick days",
    law: sickMin ? `At least ${sickMin} days at full pay` : (law.sick?.pay ?? "Company policy"),
    company: `${sick} days`,
    status: sickOk ? "ok" : "block",
    message: sickOk ? undefined : `${lawOf(c)} guarantees ${sickMin} paid sick days (${law.sick?.pay.toLowerCase()}); ${sick} is below that.`,
    rule: ruleRef(law.sick),
    fix: sickOk ? undefined : { label: `Set to ${sickMin} days`, apply: (q) => ({ ...q, leave: { ...q.leave, sickPaidDays: { ...q.leave.sickPaidDays, [c]: sickMin } } }) },
  });

  // Carryover: the law's later deadline wins over the company cap.
  if (law.carryover) {
    const later = law.carryover.expiresOn !== "12-31";
    out.push({
      country: c,
      area: "leave",
      setting: "Carryover",
      law: later ? `Unused leave carries to ${law.carryover.expiresOn === "03-31" ? "Mar 31" : law.carryover.expiresOn}` : "Lapses at year end unless agreed",
      company: `Up to ${p.leave.carryoverMaxDays} days`,
      status: later ? "locked" : "ok",
      message: later ? `The law's later deadline applies in ${name(c)}; the company cap can't shorten it.` : undefined,
      rule: ruleRef(law.carryover),
    });
  }

  // Statutory leave the company can add to but never remove.
  const statutory = [
    law.paternity && `paternity (up to ${law.paternity.maxDays} days)`,
    law.parental && "parental",
    law.publicHolidays.length && "public holidays",
  ].filter(Boolean);
  if (statutory.length) {
    out.push({ country: c, area: "leave", setting: "Statutory leave", law: `Always available: ${statutory.join(", ")}`, company: "Can't be removed or reduced", status: "locked", rule: ruleRef(law.paternity ?? law.parental ?? undefined) });
  }
  return out;
}

function hoursGuardrails(p: ClientPolicy, c: CountryCode): Guardrail[] {
  const law = timeRules[c];
  if (!law.covered) return [];
  const w = p.workingHours[c];
  const day = scheduledDayHours(p, c);
  const week = day * w.daysPerWeek;
  const out: Guardrail[] = [];

  const maxDay = law.scheduleMaxDailyHours ?? null;
  const dayOk = maxDay === null || day <= maxDay;
  out.push({
    country: c,
    area: "hours",
    setting: "Working day",
    law: maxDay === null ? "No daily limit" : `At most ${hrs(maxDay)}`,
    company: `${w.start}–${w.end}, ${hrs(day)} worked`,
    status: dayOk ? "ok" : "block",
    message: dayOk ? undefined : `${lawOf(c)} allows at most ${hrs(maxDay!)} of regular work a day; this schedule is ${hrs(day)}.`,
    rule: ruleRef(law),
    fix: dayOk ? undefined : { label: `End at ${hhmm(minutes(w.start) + maxDay! * 60 + w.breakMin)}`, apply: (q) => ({ ...q, workingHours: { ...q.workingHours, [c]: { ...q.workingHours[c], end: hhmm(minutes(w.start) + maxDay! * 60 + w.breakMin) } } }) },
  });

  const maxWeek = law.scheduleMaxWeeklyHours ?? null;
  const weekOk = maxWeek === null || week <= maxWeek;
  const fitDay = maxWeek === null ? 0 : Math.min(maxDay ?? 24, maxWeek / w.daysPerWeek);
  out.push({
    country: c,
    area: "hours",
    setting: "Working week",
    law: maxWeek === null ? (c === "US" ? "No limit; over 40 hrs is overtime" : "No weekly limit") : `At most ${hrs(maxWeek)}`,
    company: `${w.daysPerWeek} days, ${hrs(week)}`,
    status: !weekOk ? "block" : c === "US" && week > 40 ? "info" : "ok",
    message: !weekOk
      ? `${lawOf(c)} allows at most ${hrs(maxWeek!)} a week; this schedule is ${hrs(week)}.`
      : c === "US" && week > 40
        ? `${hrs(week - 40)} of every week would be overtime at 1.5x for non-exempt workers.`
        : undefined,
    rule: ruleRef(law),
    fix: weekOk ? undefined : { label: `End at ${hhmm(minutes(w.start) + fitDay * 60 + w.breakMin)}`, apply: (q) => ({ ...q, workingHours: { ...q.workingHours, [c]: { ...q.workingHours[c], end: hhmm(minutes(w.start) + fitDay * 60 + w.breakMin) } } }) },
  });

  const need = requiredBreak(c, day);
  const breakOk = w.breakMin >= need;
  out.push({
    country: c,
    area: "hours",
    setting: "Break",
    law: law.breakRule
      ? `${law.breakRule.minutes} min after ${law.breakRule.afterHours} hrs${law.breakRule.longAfterHours ? `, ${law.breakRule.longMinutes} after ${law.breakRule.longAfterHours}` : ""}`
      : law.paidBreakUnderMinutes
        ? `None required; under ${law.paidBreakUnderMinutes} min is paid`
        : "None required",
    company: `${w.breakMin} min`,
    status: breakOk ? "ok" : "block",
    message: breakOk ? undefined : `A ${hrs(day)} day needs at least a ${need}-minute break under ${lawOf(c)}; this schedule has ${w.breakMin}.`,
    rule: ruleRef(law),
    fix: breakOk ? undefined : { label: `Set to ${need} min`, apply: (q) => ({ ...q, workingHours: { ...q.workingHours, [c]: { ...q.workingHours[c], breakMin: need } } }) },
  });
  return out;
}

function overtimeGuardrails(p: ClientPolicy, c: CountryCode): Guardrail[] {
  const law = timeRules[c];
  if (!law.covered) return [];
  const o = p.overtime[c];
  const out: Guardrail[] = [];

  const cap = law.monthlyOvertimeCap;
  const capOk = cap === null || o.monthlyLimit <= cap;
  out.push({
    country: c,
    area: "overtime",
    setting: "Monthly overtime limit",
    law: cap === null ? "No legal cap" : `At most ${cap} hrs (${law.capNote})`,
    company: `${o.monthlyLimit} hrs`,
    status: capOk ? "ok" : "block",
    message: capOk ? undefined : `${lawOf(c)} caps overtime at ${cap} hours a month; ${o.monthlyLimit} is above it.`,
    rule: ruleRef(law),
    fix: capOk ? undefined : { label: `Set to ${cap} hrs`, apply: (q) => ({ ...q, overtime: { ...q.overtime, [c]: { ...q.overtime[c], monthlyLimit: cap! } } }) },
  });

  const prem = law.statutoryPremiumPct;
  const premOk = o.premiumPct >= prem;
  out.push({
    country: c,
    area: "overtime",
    setting: "Overtime premium",
    law: prem ? `At least ${prem}%` : "Set by contract",
    company: `${o.premiumPct}%`,
    status: premOk ? "ok" : "block",
    message: premOk ? undefined : `${lawOf(c)} requires at least a ${prem}% overtime premium; ${o.premiumPct}% is below it.`,
    rule: ruleRef(law),
    fix: premOk ? undefined : { label: `Set to ${prem}%`, apply: (q) => ({ ...q, overtime: { ...q.overtime, [c]: { ...q.overtime[c], premiumPct: prem } } }) },
  });

  if (law.prerequisite) {
    const onFile = !!o.article36OnFile;
    out.push({
      country: c,
      area: "overtime",
      setting: law.prerequisite,
      law: "Required before any overtime",
      company: onFile ? "On file" : "Not on file",
      status: onFile || !o.allowed ? "ok" : "info",
      message: onFile || !o.allowed ? undefined : `Overtime stays switched off in ${name(c)} until the ${law.prerequisite} is signed.`,
      rule: ruleRef(law),
    });
  }
  return out;
}
