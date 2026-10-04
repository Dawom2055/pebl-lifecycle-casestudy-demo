import { countryRules, DEMO_TODAY, fxToUSD } from "../data";
import { categoryLabel, convert, daysBetween, money } from "../format";
import type {
  ClientPolicy,
  Combination,
  Evaluation,
  ExpenseData,
  ExpenseRequest,
  Outcome,
  RuleCheck,
  Routing,
  RoutingSignal,
  Worker,
} from "../types";

/** Below this, an AI-read field the worker didn't correct sends the request to HR. */
export const CONFIDENCE_FLOOR = 0.8;

const OPEN_STATUSES = new Set(["awaiting_admin", "hr_review", "info_requested", "approved", "needs_fix"]);

// ---------------------------------------------------------------------------
// Stage 2 - Rules engine. Deterministic; AI never decides compliance here.
// ---------------------------------------------------------------------------

export function evaluateExpense(
  data: ExpenseData,
  worker: Worker,
  policy: ClientPolicy,
  existing: ExpenseRequest[],
  selfId?: string,
): Evaluation {
  const rules = countryRules[worker.country].expenses;
  const p = policy.expenses;
  const cur = worker.currency;
  const checks: RuleCheck[] = [];

  // Currency: converted at the transaction-date rate and paid in payroll currency (EXP-11).
  const payrollAmount = convert(data.amount, data.currency, cur);
  if (data.currency !== cur) {
    checks.push({
      id: "currency",
      label: "Currency conversion",
      layer: "system",
      status: "info",
      detail: `${money(data.amount, data.currency)} converted to ${money(payrollAmount, cur)} at the ${data.date} rate; paid in ${cur} through payroll.`,
    });
  }

  // Receipt present (country).
  const hasReceipt = data.receipt.kind !== "none";
  const receiptNeeded = payrollAmount >= rules.receipt.requiredOver;
  checks.push({
    id: "receipt",
    label: "Receipt attached",
    layer: "country",
    status: !receiptNeeded || hasReceipt ? "pass" : "fail",
    detail: hasReceipt ? "Receipt attached." : receiptNeeded ? "No receipt attached. One is required for this amount." : "Not required for this amount.",
    ruleId: rules.receipt.id,
    ruleVersion: rules.receipt.version,
    fixable: true,
  });

  // VAT / GST / invoice number (country).
  if (rules.taxId) {
    const needed = payrollAmount >= rules.taxId.requiredOver;
    const ok = !needed || !!data.taxId?.trim();
    checks.push({
      id: "tax_id",
      label: `${rules.taxId.label} on receipt`,
      layer: "country",
      status: ok ? "pass" : "fail",
      detail: ok
        ? needed
          ? `${rules.taxId.label} present (${data.taxId}).`
          : `Not required under ${money(rules.taxId.requiredOver, cur)}.`
        : `${rules.taxId.label} missing. ${rules.taxId.description}`,
      ruleId: rules.taxId.id,
      ruleVersion: rules.taxId.version,
      fixable: true,
    });
  }

  // Category recognised (client).
  checks.push({
    id: "category",
    label: "Expense category",
    layer: "client",
    status: data.category === "other" ? "fail" : "pass",
    detail:
      data.category === "other"
        ? "Category not recognised. Pick the category that matches the receipt."
        : `${categoryLabel[data.category]} is a reimbursable category.`,
    ruleId: "LUMEN-EXP-CAT",
    ruleVersion: policy.version,
    fixable: true,
  });

  // Date: not in the future (fixable), and within the submission window (client).
  const age = daysBetween(data.date, DEMO_TODAY);
  if (age < 0) {
    checks.push({
      id: "date",
      label: "Expense date",
      layer: "system",
      status: "fail",
      detail: "The date is in the future. Check the date on the receipt.",
      fixable: true,
    });
  } else {
    const ok = age <= p.submitWithinDays;
    checks.push({
      id: "date",
      label: "Submitted on time",
      layer: "client",
      status: ok ? "pass" : "fail",
      detail: ok
        ? `Submitted ${age} day${age === 1 ? "" : "s"} after the expense (limit ${p.submitWithinDays}).`
        : `Submitted ${age} days after the expense; policy allows ${p.submitWithinDays}.`,
      ruleId: "LUMEN-EXP-WINDOW",
      ruleVersion: policy.version,
    });
  }

  // Meal cap per person (client) and tax-free limit (country).
  let taxableAmount = 0;
  if (data.category === "meals") {
    const people = Math.max(1, data.attendees || 1);
    const perPerson = payrollAmount / people;
    const cap = p.mealCapPerPerson[cur];
    const band = (cap * p.borderlineBandPct) / 100;
    const status = perPerson > cap ? "fail" : perPerson > band ? "borderline" : "pass";
    checks.push({
      id: "meal_cap",
      label: "Meal policy",
      layer: "client",
      status,
      detail: `${money(perPerson, cur)} per person for ${people} ${people === 1 ? "person" : "people"}; company cap ${money(cap, cur)}.`,
      ruleId: "LUMEN-EXP-MEAL",
      ruleVersion: policy.version,
    });

    const tf = rules.mealTaxFreePerPerson;
    if (tf) {
      const over = Math.max(0, perPerson - tf.amount) * people;
      taxableAmount = Math.round(over * 100) / 100;
      checks.push({
        id: "tax_free",
        label: "Tax-free meal limit",
        layer: "country",
        status: over > 0 ? "info" : "pass",
        detail:
          over > 0
            ? `${money(over, cur)} is above the tax-free limit. It is still reimbursed, and payroll reports it as taxable.`
            : `Within the ${money(tf.amount, cur)} per person tax-free limit.`,
        ruleId: tf.id,
        ruleVersion: tf.version,
      });
    }
  }

  // Pre-approval for large amounts (client).
  const usd = data.amount * fxToUSD[data.currency];
  if (usd > p.preApprovalOverUSD) {
    checks.push({
      id: "pre_approval",
      label: "Pre-approval",
      layer: "client",
      status: "fail",
      detail: `Expenses over ${money(convert(p.preApprovalOverUSD, "USD", cur), cur)} need pre-approval, and none is on file.`,
      ruleId: "LUMEN-EXP-PREAPPROVAL",
      ruleVersion: policy.version,
    });
  }

  // Duplicate across all of the client's workers.
  const dup = findDuplicate(data, existing, selfId);
  checks.push({
    id: "duplicate",
    label: "Duplicate check",
    layer: "system",
    status: dup ? "fail" : "pass",
    detail: dup
      ? `Matches ${dup.id} (same merchant, amount and date), already claimed by another worker.`
      : "No matching claim from any Lumen Robotics worker.",
  });

  const result = checks.some((c) => c.status === "fail")
    ? "fail"
    : checks.some((c) => c.status === "borderline")
      ? "borderline"
      : "pass";

  const lines = [`Reimburse ${money(payrollAmount, cur)} through payroll`];
  if (taxableAmount > 0) lines.push(`${money(taxableAmount, cur)} reported as taxable`);
  return { result, checks, payroll: { currency: cur, amount: payrollAmount, taxableAmount, lines } };
}

export function findDuplicate(data: ExpenseData, existing: ExpenseRequest[], selfId?: string) {
  const norm = (s: string) => s.trim().toLowerCase();
  return existing.find(
    (r) =>
      r.id !== selfId &&
      OPEN_STATUSES.has(r.status) &&
      norm(r.data.merchant) === norm(data.merchant) &&
      r.data.date === data.date &&
      Math.abs(convert(r.data.amount, r.data.currency, data.currency) - data.amount) < 0.01,
  );
}

// ---------------------------------------------------------------------------
// Stage 3 - Risk router. Any one signal sends the request to HR. Never denies.
// ---------------------------------------------------------------------------

export function comboKey(worker: Worker, data: ExpenseData) {
  return `${worker.country}:expense:${data.category}`;
}

export function routeExpense(
  data: ExpenseData,
  worker: Worker,
  evaluation: Evaluation,
  policy: ClientPolicy,
  combinations: Combination[],
  fixCount: number,
): Routing {
  const p = policy.expenses;
  const cur = worker.currency;
  const combination = comboKey(worker, data);
  const unlocked = combinations.find((c) => c.key === combination)?.status === "unlocked";

  const fails = evaluation.checks.filter((c) => c.status === "fail");
  const fixable = fails.filter((c) => c.fixable);
  // The client's own spending rules (meal cap, submission window, pre-approval) aren't compliance
  // questions: the client admin decides them, with a disclaimer.
  const ADVISORY = new Set(["meal_cap", "date", "pre_approval"]);
  const hard = fails.filter((c) => !c.fixable && !ADVISORY.has(c.id));

  // Fixable problems go back to the worker first - unless they've already tried once.
  if (fixable.length > 0 && hard.length === 0 && fixCount < 1) {
    return {
      outcome: "back_to_worker",
      signals: fixable.map((c) => ({ id: "rules_fail", label: c.label, detail: c.detail })),
      combination,
      unlocked,
    };
  }

  const signals: RoutingSignal[] = [];

  if (fixable.length > 0 && fixCount >= 1) {
    signals.push({
      id: "repeat_fix",
      label: "Still failing after a fix",
      detail: "The worker already resubmitted once, so this goes to HR instead of looping back again.",
    });
  }
  for (const c of hard) {
    signals.push(
      c.id === "duplicate"
        ? { id: "duplicate", label: "Possible duplicate", detail: c.detail }
        : { id: "rules_fail", label: `Rule failed: ${c.label}`, detail: c.detail },
    );
  }

  // Advisories: compliant, but outside the client's usual spending. They go to the client admin
  // as a disclaimer instead of sending the request to Pebl HR.
  const advisories: RoutingSignal[] = [];
  const meal = evaluation.checks.find((c) => c.id === "meal_cap");
  if (meal?.status === "fail") advisories.push({ id: "rules_fail", label: "Over the meal cap", detail: meal.detail });
  if (meal?.status === "borderline") advisories.push({ id: "rules_borderline", label: "Close to the meal cap", detail: meal.detail });
  const late = fails.find((c) => c.id === "date" && !c.fixable);
  if (late) advisories.push({ id: "rules_fail", label: "Submitted late", detail: late.detail });
  const pre = fails.find((c) => c.id === "pre_approval");
  if (pre) advisories.push({ id: "rules_fail", label: "No pre-approval", detail: pre.detail });

  // AI confidence on fields the worker accepted as read (they confirmed, but didn't correct).
  if (data.aiRead) {
    const low = (Object.entries(data.aiRead) as [string, { value: unknown; confidence: number }][])
      .filter(([k, f]) => k !== "source" && typeof f === "object" && f.confidence < CONFIDENCE_FLOOR)
      .map(([k]) => k);
    if (low.length) {
      signals.push({
        id: "low_confidence",
        label: "Low AI confidence",
        detail: `The AI was unsure reading: ${low.join(", ")}.`,
      });
    }
    // Cross-check: worker-confirmed values must agree with what was read from the receipt (EXP-3).
    const mismatches: string[] = [];
    if (Math.abs(data.aiRead.amount.value - data.amount) > 0.01) mismatches.push("amount");
    if (data.aiRead.date.value !== data.date) mismatches.push("date");
    if (data.aiRead.currency.value !== data.currency) mismatches.push("currency");
    if (mismatches.length) {
      signals.push({
        id: "cross_check",
        label: "Doesn't match the receipt",
        detail: `The confirmed ${mismatches.join(" and ")} differ${mismatches.length === 1 ? "s" : ""} from what the receipt shows.`,
      });
    }
  }

  // Anomaly against this worker's history.
  if (data.category === "meals" && worker.usualMealSpend > 0) {
    const ratio = evaluation.payroll.amount / worker.usualMealSpend;
    if (ratio >= p.anomalyMultiplier) {
      advisories.push({
        id: "anomaly",
        label: "Unusual amount",
        detail: `${Math.round(ratio)}x this worker's usual meal expense (${money(worker.usualMealSpend, cur)}).`,
      });
    }
  }

  if (evaluation.payroll.amount > p.autoClearThreshold[cur]) {
    signals.push({
      id: "amount",
      label: "Above auto-clear amount",
      detail: `${money(evaluation.payroll.amount, cur)} is over the ${money(p.autoClearThreshold[cur], cur)} auto-clear threshold.`,
    });
  }

  if (p.alwaysReviewCategories.includes(data.category)) {
    signals.push({ id: "always_review", label: "Always reviewed", detail: `${categoryLabel[data.category]} is on the always-review list.` });
  }

  const wouldBe: Outcome = signals.length ? "hr_exception" : "auto_clear";

  if (!unlocked) {
    signals.push({
      id: "not_unlocked",
      label: "Shadow mode",
      detail: `${combination} isn't unlocked yet, so HR still decides. The system records what it would have done.`,
    });
    return { outcome: "hr_exception", signals: [...signals, ...advisories], combination, unlocked, shadowWould: wouldBe, advisories };
  }

  if (wouldBe === "auto_clear") {
    const optIn = p.optInAutoApproveUnder?.[cur];
    return {
      outcome: "auto_clear",
      signals,
      combination,
      unlocked,
      advisories,
      // Anything with a disclaimer waits for the client admin, even under the auto-approve limit.
      clientAutoApproved: optIn != null && evaluation.payroll.amount < optIn && advisories.length === 0,
    };
  }
  // HR sees the advisories too, alongside the flags that sent it there.
  return { outcome: "hr_exception", signals: [...signals, ...advisories], combination, unlocked, advisories };
}
