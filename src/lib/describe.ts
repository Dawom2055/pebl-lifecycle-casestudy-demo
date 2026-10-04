import { dayName, rangeLabel } from "./calendar";
import { categoryLabel, money, shortDate } from "./format";
import { leaveLabel } from "./engine/leave";
import type { AnyRequest, RequestKind } from "./types";

export const kindLabel: Record<RequestKind, string> = {
  expense: "Expense",
  leave: "Leave",
  overtime: "Overtime request",
  timesheet: "Timesheet",
};

export const moduleOf = (k: RequestKind) => (k === "expense" ? "Expenses" : k === "leave" ? "Leave" : "Time");

/** Main label for a request in lists and cards. */
export function titleOf(r: AnyRequest) {
  switch (r.kind) {
    case "expense":
      return r.data.merchant;
    case "leave":
      return `${leaveLabel[r.data.type]} · ${rangeLabel(r.data.start, r.data.end)}`;
    case "overtime":
      return `Overtime · ${dayName(r.data.date)} ${rangeLabel(r.data.date, r.data.date)}`;
    case "timesheet":
      return `Timesheet · week of ${rangeLabel(r.data.weekStart, r.data.weekStart)}`;
  }
}

/** The number that matters most: money, days or hours. */
export function valueOf(r: AnyRequest) {
  switch (r.kind) {
    case "expense":
      return money(r.evaluation.payroll.amount, r.evaluation.payroll.currency);
    case "leave":
      return `${r.insight.workingDays} day${r.insight.workingDays === 1 ? "" : "s"}`;
    case "overtime":
      return `${r.data.hours} hr${r.data.hours === 1 ? "" : "s"}`;
    case "timesheet":
      return `${r.insight.totalHours} hrs`;
  }
}

/** Secondary detail under the title. */
export function subtitleOf(r: AnyRequest) {
  switch (r.kind) {
    case "expense":
      return `${categoryLabel[r.data.category]} · ${shortDate(r.data.date)}`;
    case "leave":
      return r.insight.payTreatment;
    case "overtime":
      return r.data.reason || "Overtime";
    case "timesheet":
      return r.insight.overtimeHours ? `${r.insight.overtimeHours} overtime hrs` : "Standard week";
  }
}
