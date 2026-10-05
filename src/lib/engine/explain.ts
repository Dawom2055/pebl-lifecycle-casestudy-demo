import { rangeLabel } from "../calendar";
import { client, countryRules, timeRules } from "../data";
import { categoryLabel, money, moneyShort } from "../format";
import type {
  AnyRequest,
  Audience,
  Explanation,
  ExpenseRequest,
  LeaveRequest,
  OvertimeRequest,
  TimesheetRequest,
  Worker,
} from "../types";
import { leaveLabel } from "./leave";

/**
 * Stage 4 fallback: plain-language templates used when Claude isn't connected.
 * With an API key, /api/ai/explain writes these instead, from the same inputs.
 */
export function templateExplanation(req: AnyRequest, worker: Worker, audience: Audience): Explanation {
  switch (req.kind) {
    case "expense":
      return expenseTemplate(req, worker, audience);
    case "leave":
      return leaveTemplate(req, worker, audience);
    case "overtime":
      return overtimeTemplate(req, worker, audience);
    case "timesheet":
      return timesheetTemplate(req, worker, audience);
  }
}

function t(text: string, extra: Partial<Explanation> = {}): Explanation {
  return { text, source: "template", ...extra };
}

const shortCountry = (w: Worker) => countryRules[w.country].name.replace("United Kingdom", "UK").replace("United States", "US");
const first = (w: Worker) => w.name.split(" ")[0];
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const hrs = (n: number) => `${n} hour${n === 1 ? "" : "s"}`;

function shadowText(req: AnyRequest, wouldLabel: string): Explanation {
  return t(`Shadow mode: ${req.routing.combination} isn't unlocked yet. Every check passes; the system would have ${wouldLabel}.`, {
    suggestedAction: "Confirm or override. Your decision counts toward the agreement rate for unlocking.",
  });
}

function wouldLabel(req: AnyRequest) {
  const w = req.routing.shadowWould;
  if (w === "auto_clear") return req.kind === "expense" ? "auto-cleared this" : "approved this automatically";
  if (w === "manager") return "sent this to the manager";
  return "flagged this for HR";
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

function expenseTemplate(req: ExpenseRequest, worker: Worker, audience: Audience): Explanation {
  const { data, evaluation, routing } = req;
  const cur = evaluation.payroll.currency;
  const amount = moneyShort(evaluation.payroll.amount, cur);
  const what = describeExpense(req);
  const country = shortCountry(worker);

  if (audience === "worker") {
    if (routing.outcome === "back_to_worker") {
      const f = evaluation.checks.find((c) => c.status === "fail" && c.fixable);
      if (f?.id === "tax_id") return t(`This receipt is missing a ${taxShort[worker.country]} number, which ${country} tax rules require. Retake the photo?`);
      if (f?.id === "receipt") return t("This expense needs a receipt. Add a photo or PDF and resubmit.");
      if (f?.id === "category") return t("We couldn't match this to an expense category. Pick the one that fits and resubmit.");
      if (f?.id === "date") return t("The date on this expense is in the future. Check the receipt date and resubmit.");
      return t("Something on this expense needs fixing before it can go anywhere. See the checks below.");
    }
    if (routing.outcome === "auto_clear") {
      if (routing.clientAutoApproved) return t(`${amount} ${what} cleared every check and was approved automatically. It will be paid in your next payroll.`);
      if (routing.advisories?.length) return t(`${amount} ${what} passed every compliance check. It's ${advisoryText(routing.advisories, "your")}, so ${client.name} decides whether to approve it.`);
      return t(`${amount} ${what} cleared every compliance check. It's waiting on a one-tap approval from ${client.name}, then goes to payroll.`);
    }
    return t(`${amount} ${what} needs a quick review by Pebl's local HR team. Nothing for you to do yet; we'll let you know if anything is needed.`);
  }

  if (audience === "admin") {
    const parts: string[] = [];
    const advisories = routing.advisories ?? [];
    if (advisories.length) parts.push(`Meets ${country} rules`);
    else if (evaluation.checks.some((c) => c.id === "meal_cap" && c.status === "pass")) parts.push(`Within ${country} meal policy`);
    else parts.push("Within company policy");
    if (evaluation.checks.find((c) => c.id === "tax_id" && c.status === "pass")) parts.push(`valid ${taxShort[worker.country]} receipt`);
    const fx = data.currency !== cur ? ` Converted from ${moneyShort(data.amount, data.currency)}.` : "";
    const taxable = evaluation.payroll.taxableAmount > 0 ? ` ${moneyShort(evaluation.payroll.taxableAmount, cur)} goes to payroll as taxable.` : "";
    const note = advisories.length ? ` For your decision: it's ${advisoryText(advisories, `${first(worker)}'s`)}.` : "";
    return t(`${amount} ${what}. ${parts.join(", ")}.${fx}${taxable}${note}`);
  }

  const flags = routing.signals.filter((s) => s.id !== "not_unlocked");
  const passing = evaluation.checks.filter((c) => c.status === "pass").length;
  const otherOk = evaluation.result === "pass" ? " All other checks pass." : ` ${passing} of ${evaluation.checks.length} checks pass.`;
  // Disclaimers (meal cap, unusual amount, late, no pre-approval) ride along but aren't why it's here.
  const advisory = new Set((routing.advisories ?? []).map((x) => x.label));
  const core = flags.filter((f) => !advisory.has(f.label));
  const notes = flags.filter((f) => advisory.has(f.label));
  const also = notes.length ? ` Also noted for the client admin: ${notes.map((n) => n.label.toLowerCase()).join(", ")}.` : "";
  if (core.length === 0 && routing.shadowWould) {
    const shadow = shadowText(req, wouldLabel(req));
    return { ...shadow, text: shadow.text + also };
  }
  const dup = core.find((s) => s.id === "duplicate");
  const pre = notes.find((s) => s.label === "No pre-approval");
  const anomaly = notes.find((s) => s.label === "Unusual amount");
  if (dup) return t(`Flagged: possible duplicate. ${dup.detail}${also}`, { suggestedAction: "Check with both workers whether this was split or claimed twice." });
  const action = pre
    ? "Confirm the expense was pre-approved, then send it to the admin or ask for the approval."
    : anomaly
      ? "Confirm the business purpose, then send it to the admin."
      : "Review the flagged checks and decide.";
  return t(`Flagged: ${(core.length ? core : flags).map((f) => f.label.toLowerCase()).join("; ")}.${otherOk}${core.length ? also : ""}`, { suggestedAction: action });
}

/** "over the meal cap and 3x your usual meal spend" */
function advisoryText(advisories: { label: string; detail: string }[], whose: string) {
  const phrase: Record<string, string> = {
    "Submitted late": "past the company's submission window",
    "No pre-approval": "over the pre-approval amount with none on file",
  };
  return advisories
    .map((a) => (a.label === "Unusual amount" ? `${a.detail.split(" ")[0]} ${whose} usual meal spend` : (phrase[a.label] ?? a.label.toLowerCase())))
    .join(" and ");
}

/** The notice period the client's policy asks for, read from the notice check. */
function noticeDays(req: LeaveRequest) {
  const m = /policy asks for (\d+)/.exec(req.evaluation.checks.find((c) => c.id === "notice")?.detail ?? "");
  return m ? Number(m[1]) : 14;
}

const taxShort: Record<Worker["country"], string> = { UK: "VAT", US: "tax", CA: "GST/HST", DE: "VAT", JP: "qualified invoice" };

function describeExpense(req: ExpenseRequest) {
  const d = req.data;
  const note = d.note.toLowerCase();
  if (d.category === "meals") {
    if (note.includes("client") || note.includes("customer") || note.includes("candidate")) return d.attendees > 2 ? "client meal" : note.includes("dinner") ? "client dinner" : "client meal";
    if (note.includes("team") || d.attendees > 2) return "team meal";
    return note.includes("dinner") ? "dinner" : note.includes("lunch") ? "lunch" : "meal";
  }
  return `${categoryLabel[d.category].toLowerCase()} expense at ${d.merchant}`;
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

function leaveTemplate(req: LeaveRequest, worker: Worker, audience: Audience): Explanation {
  const { data, insight, routing, evaluation } = req;
  const label = leaveLabel[data.type];
  const when = rangeLabel(data.start, data.end);
  const head = `${worker.name} · ${label} · ${when} (${days(insight.workingDays)})`;

  if (audience === "worker") {
    if (routing.outcome === "back_to_worker") {
      const f = evaluation.checks.find((c) => c.status === "fail" && c.fixable);
      return t(f ? `${f.detail} Fix it and resubmit.` : "Something on this request needs fixing. See the checks below.");
    }
    if (routing.outcome === "auto_clear") {
      if (routing.clientAutoApproved) return t(`${label} on ${when} was approved automatically under ${client.name}'s policy. Your balance is updated.`);
      return t(`${label} on ${when} is protected leave, so it was approved automatically. Your manager is notified to plan cover.`);
    }
    if (routing.outcome === "manager" && routing.advisories?.length)
      return t(`${label} on ${when} is within your entitlement and is with your manager. It's less than the ${noticeDays(req)} days' notice ${client.name} asks for, so they'll decide whether the timing works.`);
    if (routing.outcome === "manager") return t(`${label} on ${when} passed every check and is with your manager. They decide the timing, not whether you're entitled to it.`);
    if (insight.tier === "hr") return t(`${label} goes to Pebl's local HR team to confirm the entitlement and pay. Nothing is denied automatically; we'll tell you if anything is needed.`);
    return t(`${label} on ${when} needs a quick review by Pebl HR. Nothing for you to do yet.`);
  }

  if (audience === "admin") {
    if (routing.outcome === "auto_clear") return t(`${head}. ${routing.clientAutoApproved ? "Approved automatically under your policy." : "Protected leave, approved automatically."} No action needed.`);
    if (routing.outcome === "hr_exception") return t(`${head} is with Pebl HR${insight.tier === "hr" ? " for statutory pay and documents" : ""}. You'll be notified to plan coverage.`);
    // Manager decision card suggestion (LV-8).
    const parts: string[] = [];
    if (insight.expiring && insight.expiring.days > 0) {
      const uses = Math.min(insight.expiring.days, insight.workingDays);
      parts.push(`${first(worker)} would lose ${days(uses)} not used before ${rangeLabel(insight.expiring.date, insight.expiring.date)}${insight.legalRisk ? ", and declining could leave Pebl out of compliance" : ""}.`);
    } else {
      parts.push(routing.advisories?.length ? "Within balance and policy." : "Within balance, notice and policy.");
    }
    if (routing.advisories?.length) parts.push(`Only ${Math.max(0, insight.noticeDays)} days' notice against the ${noticeDays(req)} the company asks for, so the timing is your call.`);
    if (insight.teamAway.length && insight.clearRange) parts.push(`If coverage is a concern, ${rangeLabel(insight.clearRange.start, insight.clearRange.end)} has no overlap.`);
    else if (!insight.teamAway.length) parts.push("No one else on the team is away.");
    return t(parts.join(" "), { headline: "Approve" });
  }

  const flags = routing.signals.filter((s) => s.id !== "not_unlocked" && s.id !== "tier");
  if (!flags.length && routing.shadowWould) return shadowText(req, wouldLabel(req));
  const declined = routing.signals.find((s) => s.id === "risky_decline");
  if (declined) return t(`Flagged: ${declined.detail}`, { suggestedAction: "Agree alternative dates with the manager before the days lapse, or confirm the decline with a reason." });
  if (routing.signals.some((s) => s.id === "no_rule")) {
    return t(`${head}. No verified leave rules for ${shortCountry(worker)} yet (provincial standards). Balance and company policy checks pass.`, {
      suggestedAction: "Check the provincial entitlement, then clear or ask for information.",
    });
  }
  if (insight.tier === "hr") {
    const doc = evaluation.checks.find((c) => c.id === "document");
    const within = insight.balanceAfter === null || insight.balanceAfter >= 0 ? "Within statutory entitlement." : "Over the statutory entitlement.";
    return t(`${worker.name} · ${label} · ${insight.workingDays >= 10 && insight.workingDays % 5 === 0 ? `${insight.workingDays / 5} weeks` : days(insight.workingDays)}. ${within}${doc && doc.status !== "pass" ? " Supporting document not yet uploaded." : ""}`, {
      suggestedAction: "Confirm start date and statutory pay rate.",
    });
  }
  return t(`Flagged: ${flags.map((f) => f.label.toLowerCase()).join("; ")}.`, { suggestedAction: "Review the flagged checks and decide." });
}

// ---------------------------------------------------------------------------
// Time: overtime requests
// ---------------------------------------------------------------------------

function overtimeTemplate(req: OvertimeRequest, worker: Worker, audience: Audience): Explanation {
  const { data, insight: i, routing } = req;
  const when = `${new Date(`${data.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} ${rangeLabel(data.date, data.date)}`;
  const cost = money(i.cost, worker.currency);

  if (audience === "worker") {
    if (routing.outcome === "auto_clear") return t(`${hrs(data.hours)} on ${when} approved automatically. You'll have ${hrs(i.remainingAfter)} of overtime left this month.`);
    if (routing.outcome === "manager") return t(`Your request for ${hrs(data.hours)} on ${when} is with your manager. It would bring you to ${i.after} of ${i.limit} hours this month.`);
    return t(`Your request for ${hrs(data.hours)} on ${when} is with Pebl HR while overtime approvals in ${shortCountry(worker)} prove themselves in shadow mode.`);
  }

  if (audience === "admin") {
    if (routing.outcome === "auto_clear") return t(`${worker.name} · ${hrs(data.hours)} overtime on ${when}, approved automatically within the limit (${i.after} of ${i.limit}). Cost ${cost}.`);
    if (i.overBudget) return t(`Within every legal limit, but over your overtime budget for the month. That's a company-policy call, so it's yours.`, { headline: "Your call: over budget" });
    if (i.forecast > i.limit && i.partialHours) {
      return t(`Or approve ${hrs(i.partialHours)} now and ${hrs(data.hours - i.partialHours)} next month to keep headroom.`, { headline: "Approve, and plan no more overtime this month" });
    }
    return t(`Leaves ${hrs(i.remainingAfter)} of overtime this month. Cost: ${hrs(data.hours)} at a ${i.premiumPct}% premium.`, { headline: "Approve" });
  }

  if (!routing.signals.filter((s) => s.id !== "not_unlocked").length && routing.shadowWould) return shadowText(req, wouldLabel(req));
  return t(`Flagged: ${routing.signals.map((s) => s.label.toLowerCase()).join("; ")}.`, { suggestedAction: "Review the flagged checks and decide." });
}

// ---------------------------------------------------------------------------
// Time: timesheets
// ---------------------------------------------------------------------------

function timesheetTemplate(req: TimesheetRequest, worker: Worker, audience: Audience): Explanation {
  const { data, insight: i, routing } = req;
  const week = `Week of ${rangeLabel(data.weekStart, data.weekStart)}`;
  const otPart = i.overtimeHours ? `, including ${hrs(i.overtimeHours)} ${i.unapproved ? "" : "approved "}overtime` : "";
  const cost = money(i.cost, worker.currency);
  const law = timeRules[worker.country];

  if (audience === "worker") {
    if (routing.outcome === "auto_clear") return t(`${week} · ${i.totalHours} hours${otPart}. Within limits and sent to payroll.`);
    if (routing.outcome === "manager") return t(`${hrs(i.unapproved)} of overtime weren't pre-approved, so your manager confirms them. They'll be paid either way.`);
    return t(`Your timesheet needs a check by Pebl HR. Every hour you worked will still be paid.`);
  }

  if (audience === "admin") {
    if (routing.outcome === "auto_clear") return t(`${worker.name} · ${week} · ${i.totalHours} hours${otPart}. Within limits. Sent to payroll.`);
    if (routing.outcome === "manager" && req.hrDecision) {
      const over = i.monthAfter > i.limit ? ` That takes the month to ${i.monthAfter} of ${i.limit} hours, over your limit.` : "";
      return t(`${worker.name} · ${week} · ${i.totalHours} hours, including ${hrs(i.overtimeHours)} overtime.${over} Pebl HR reviewed the compliance issues; see their notes. Hours already worked must be paid (${cost} overtime).`, {
        headline: "Confirm, and follow up on the workload",
      });
    }
    if (routing.outcome === "manager") {
      const day = req.evaluation.checks.find((c) => c.id === "approvals")?.detail.match(/\(([^)]+)\)/)?.[1] ?? "this week";
      return t(`${worker.name} · ${hrs(i.unapproved)} overtime on ${day} without pre-approval. Within the limit (${i.monthAfter} of ${i.limit}). Cost: ${hrs(i.unapproved)} at a ${i.premiumPct}% premium. These hours must be paid.`, {
        headline: "Confirm",
      });
    }
    return t(`${worker.name}'s ${week.toLowerCase()} timesheet is with Pebl HR. Every hour worked will be paid.`);
  }

  const flags = routing.signals.filter((s) => s.id !== "not_unlocked");
  if (!flags.length && routing.shadowWould) return shadowText(req, wouldLabel(req));
  if (flags.some((s) => s.id === "limit")) {
    const capNote = i.legalCap !== null ? (i.monthAfter > i.legalCap ? ` The legal cap of ${i.legalCap} was breached too.` : ` Legal cap of ${i.legalCap} not breached.`) : "";
    return t(`Monthly overtime reached ${i.monthAfter} hours, over the ${i.limit}-hour company limit.${capNote}`, {
      suggestedAction: `Pay all ${i.monthAfter} hours at the overtime rate and review workload with the manager.`,
    });
  }
  if (i.restBreaches.length) {
    return t(`Flagged: rest period missed (${i.restBreaches.join("; ")}; ${law.minRestHours} required)${i.longDays.length ? ` and ${i.longDays.join(", ")}` : ""}.`, {
      suggestedAction: `Pay all hours (${cost} overtime), record the rest breach, and review scheduling with the manager.`,
    });
  }
  const daily = req.evaluation.checks.find((c) => c.id === "daily_max" && c.status === "fail");
  if (daily) {
    return t(`Flagged: ${daily.detail}${i.breakIssues.length ? ` Break too short: ${i.breakIssues.join("; ")}.` : ""}`, {
      suggestedAction: "Pay all hours, record the breach, and check whether it must be reported.",
    });
  }
  return t(`Flagged: ${flags.map((f) => f.label.toLowerCase()).join("; ")}.`, { suggestedAction: "Pay all hours worked, then review the flagged checks." });
}
