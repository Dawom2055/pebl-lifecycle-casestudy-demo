import { getWorker } from "../data";
import type { AnyRequest, Audience } from "../types";
import { leaveLabel } from "./leave";

/**
 * The facts Claude gets to explain one decision to one reader.
 * Only what that explanation needs: no receipt images, no other workers' personal data,
 * and teammates' absences without the reason (LV-13).
 */
export function explainInput(req: AnyRequest, audience: Audience) {
  const worker = getWorker(req.workerId);
  const common = {
    reader: audience,
    requestType: req.kind,
    worker: { firstName: worker.name.split(" ")[0], fullName: worker.name, country: worker.country, payrollCurrency: worker.currency },
    rulesResult: req.evaluation.result,
    checks: req.evaluation.checks.map((c) => ({ check: c.label, layer: c.layer, status: c.status, detail: c.detail, workerCanFix: !!c.fixable })),
    routing: {
      outcome: req.routing.outcome,
      signals: req.routing.signals.map((s) => `${s.label}: ${s.detail}`),
      shadowMode: !req.routing.unlocked,
      systemWouldHave: req.routing.shadowWould ?? null,
      clientAutoApproved: !!req.routing.clientAutoApproved,
      advisoriesForClientAdmin: (req.routing.advisories ?? []).map((s) => `${s.label}: ${s.detail}`),
    },
    payroll: req.evaluation.payroll,
  };

  switch (req.kind) {
    case "expense":
      return {
        ...common,
        expense: {
          merchant: req.data.merchant,
          amount: req.data.amount,
          currency: req.data.currency,
          date: req.data.date,
          category: req.data.category,
          attendees: req.data.attendees,
          purpose: req.data.note,
          usualMealSpend: worker.usualMealSpend,
        },
      };
    case "leave":
      return {
        ...common,
        leave: {
          type: leaveLabel[req.data.type],
          start: req.data.start,
          end: req.data.end,
          workingDays: req.insight.workingDays,
          tier: req.insight.tier,
          balanceBefore: req.insight.balanceBefore,
          balanceAfter: req.insight.balanceAfter,
          expiring: req.insight.expiring,
          declineRisksLegalMinimum: req.insight.legalRisk,
          teammatesAway: req.insight.teamAway.map((a) => ({ firstName: a.name.split(" ")[0], from: a.start, to: a.end })),
          datesWithNoOverlap: req.insight.clearRange,
          publicHolidaysNotDeducted: req.insight.holidaysInRange,
          payTreatment: req.insight.payTreatment,
          note: req.data.note,
        },
      };
    case "overtime":
      return {
        ...common,
        overtime: {
          date: req.data.date,
          hours: req.data.hours,
          reason: req.data.reason,
          monthlyLimit: req.insight.limit,
          companyLimit: req.insight.clientLimit,
          legalCap: req.insight.legalCap,
          hoursBefore: req.insight.usedBefore,
          hoursAfter: req.insight.after,
          monthEndForecast: req.insight.forecast,
          hoursLeftAfter: req.insight.remainingAfter,
          suggestedPartialHours: req.insight.partialHours,
          premiumPct: req.insight.premiumPct,
          cost: req.insight.cost,
          overBudget: req.insight.overBudget,
          prerequisite: req.insight.prerequisite,
        },
      };
    case "timesheet":
      return {
        ...common,
        timesheet: {
          weekStart: req.data.weekStart,
          totalHours: req.insight.totalHours,
          overtimeHours: req.insight.overtimeHours,
          preApprovedOvertime: req.insight.preApproved,
          unapprovedOvertime: req.insight.unapproved,
          monthOvertimeAfter: req.insight.monthAfter,
          monthlyLimit: req.insight.limit,
          legalCap: req.insight.legalCap,
          overtimeCost: req.insight.cost,
          premiumPct: req.insight.premiumPct,
          longDays: req.insight.longDays,
          restBreaches: req.insight.restBreaches,
          breakIssues: req.insight.breakIssues,
        },
      };
  }
}
