import { CURRENT_WEEK, DEMO_TODAY, leaveRules } from "../data";
import { rangeLabel } from "../calendar";
import { daysBetween } from "../format";
import type { AnyRequest, ClientPolicy, Worker } from "../types";
import { leaveBalances } from "./leave";
import { overtimeStatus, sheetFor } from "./time";

/**
 * Assistance before anything goes wrong: reminders Pebl AI raises for an employee on its own,
 * from their balances, the calendar and their hours. Each one points at the page that fixes it.
 */
export interface Nudge {
  id: string;
  tone: "worker" | "hr" | "admin";
  title: string;
  text: string;
  action: { label: string; section: "leave" | "time" };
}

/** Only nudge about expiring leave when the deadline is this close. */
const EXPIRY_WINDOW_DAYS = 120;

export function nudgesFor(worker: Worker, requests: AnyRequest[], policy: ClientPolicy, asOf = DEMO_TODAY): Nudge[] {
  const out: Nudge[] = [];

  // Vacation that will lapse at the carryover deadline.
  const law = leaveRules[worker.country];
  const vacation = leaveBalances(worker, requests, policy).find((b) => b.type === "vacation");
  if (law.covered && law.carryover && vacation?.available != null) {
    const yearEnd = law.carryover.expiresOn === "12-31";
    const deadline = `${Number(asOf.slice(0, 4)) + (yearEnd ? 0 : 1)}-${law.carryover.expiresOn}`;
    const unbooked = vacation.available - vacation.pending;
    const lapsing = Math.max(0, unbooked - (yearEnd ? policy.leave.carryoverMaxDays : 0));
    const daysLeft = daysBetween(asOf, deadline);
    if (lapsing > 0 && daysLeft >= 0 && daysLeft <= EXPIRY_WINDOW_DAYS) {
      out.push({
        id: "expiring",
        tone: "worker",
        title: `${lapsing} vacation day${lapsing === 1 ? "" : "s"} expire ${rangeLabel(deadline, deadline)}`,
        text: `You have ${unbooked} unbooked day${unbooked === 1 ? "" : "s"}${yearEnd ? ` and can carry ${policy.leave.carryoverMaxDays} into next year` : ""}. Book the rest in the next ${Math.ceil(daysLeft / 7)} weeks or they're lost.`,
        action: { label: "Book leave", section: "leave" },
      });
    }
  }

  // This week's timesheet, once its Friday has arrived.
  if (!sheetFor(worker.id, requests)) {
    out.push({
      id: "timesheet",
      tone: "worker",
      title: `Timesheet due for the week of ${rangeLabel(CURRENT_WEEK, CURRENT_WEEK)}`,
      text: "It's pre-filled from your schedule, approved overtime and leave. Check it and confirm; most weeks take one click.",
      action: { label: "Confirm timesheet", section: "time" },
    });
  }

  // Overtime getting close to the monthly limit.
  const ot = overtimeStatus(worker, requests, policy, { asOf });
  if (ot.eligible && ot.switchedOn && ot.limit) {
    const alert = ot.alerts.find((a) => a.level === "forecast") ?? ot.alerts.find((a) => a.level === "manager") ?? ot.alerts.find((a) => a.level === "heads_up");
    if (alert) {
      out.push({
        id: "overtime",
        tone: alert.level === "heads_up" ? "admin" : "hr",
        title: `${ot.committed} of ${ot.limit} overtime hours used this month`,
        text: alert.level === "forecast" ? `At your current pace you'd reach ${ot.forecast} by month-end. Plan with your manager before you go over.` : alert.text,
        action: { label: "See my hours", section: "time" },
      });
    }
  }
  return out;
}
