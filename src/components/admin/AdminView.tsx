"use client";

import { useState } from "react";
import { dayName, rangeLabel } from "@/lib/calendar";
import { DEMO_TODAY, getWorker, hrSpecialist, timeRules, workers } from "@/lib/data";
import { kindLabel, titleOf, valueOf } from "@/lib/describe";
import { categoryLabel, money, shortDate } from "@/lib/format";
import { leaveLabel, teamLeave } from "@/lib/engine/leave";
import { overtimeLimits, overtimeStatus } from "@/lib/engine/time";
import { useDemo } from "@/lib/store";
import type { AnyRequest, CheckStatus, ExpenseRequest, LeaveRequest, OvertimeRequest, TimesheetRequest } from "@/lib/types";
import { AppShell } from "../AppShell";
import { RequestActions, RequestDetail } from "../RequestDetail";
import { RequestTable } from "../RequestTable";
import { AdvisoryNote, AiSource, CheckIcon, OvertimeMeter } from "../request-parts";
import { Button, Card, cx, Empty, PageHeader, SparkIcon } from "../ui";
import { ExpensePolicyTab, LeavePolicyTab, OvertimePolicyTab, WorkingHoursTab } from "./PolicyTabs";

type Filter = "all" | "expense" | "leave" | "time";
const inFilter = (r: AnyRequest, f: Filter) => f === "all" || (f === "time" ? r.kind === "overtime" || r.kind === "timesheet" : r.kind === f);

export function AdminView() {
  const demo = useDemo();
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const pending = demo.requests.filter((r) => r.status === "awaiting_admin");
  const updates = demo.requests.filter((r) => r.managerNotice && !r.managerNotice.acknowledged);
  const withHr = demo.requests.filter((r) => r.status === "hr_review" || r.status === "info_requested");
  const section = demo.section.admin;
  const openReq = open ? demo.requests.find((r) => r.id === open) ?? null : null;
  const shown = pending.filter((r) => inFilter(r, filter));
  const easy = pending.filter((r) => r.kind === "expense");

  return (
    <AppShell
      nav={[
        { id: "decisions", label: "Decisions", count: pending.length || undefined },
        { id: "updates", label: "Updates", count: updates.length || undefined },
        { id: "team", label: "Team" },
        { id: "all", label: "All requests" },
        { id: "policy", label: "Policy" },
      ]}
    >
      {section === "decisions" && (
        <>
          <PageHeader
            title="Decisions"
            sub="Compliance is already checked against local law and your policy. You make the business call."
            actions={
              easy.length > 1 ? (
                <Button variant="primary" onClick={() => easy.forEach((r) => demo.adminApprove(r.id))}>
                  Approve all {easy.length} expenses
                </Button>
              ) : undefined
            }
          />
          <div className="mb-4 flex flex-wrap gap-1.5">
            {(["all", "expense", "leave", "time"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cx("rounded-full border px-3 py-1 text-xs font-semibold", filter === f ? "border-ink bg-ink text-white" : "border-line bg-surface text-muted hover:text-ink")}
              >
                {f === "all" ? "All" : f === "expense" ? "Expenses" : f === "leave" ? "Leave" : "Time"} {pending.filter((r) => inFilter(r, f)).length}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <Empty title="You're all caught up">New requests that clear compliance land here as decision cards. Submit one as the employee to see it arrive.</Empty>
          ) : (
            <div className="grid items-start gap-3 xl:grid-cols-2">
              {shown.map((r) => (
                <DecisionCard key={r.id} req={r} onDetails={() => setOpen(r.id)} />
              ))}
            </div>
          )}
          {withHr.length > 0 && (
            <p className="mt-6 text-sm text-muted">
              {withHr.length} more request{withHr.length === 1 ? " is" : "s are"} with Pebl HR. You only see them if HR clears them, or to plan coverage.
            </p>
          )}
        </>
      )}

      {section === "updates" && (
        <>
          <PageHeader title="Updates" sub="Things approved without you: protected leave, timesheets within limits, and requests HR cleared. No decision needed; they're here so you can plan coverage." />
          {updates.length === 0 ? (
            <Empty title="Nothing new">Protected leave and timesheets within limits show up here when they&apos;re approved automatically.</Empty>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {updates.map((r) => (
                <Card key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-display font-bold">{getWorker(r.workerId).name}</div>
                      <div className="text-xs text-muted">
                        {kindLabel[r.kind]} · {titleOf(r)}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-md bg-admin-bg px-2 py-0.5 text-xs font-semibold text-admin">{r.hrDecision ? "Cleared by HR" : "Auto-approved"}</span>
                  </div>
                  <p className="mt-3 rounded-lg bg-worker-bg px-3 py-2.5 text-[15px]">{r.explanations.admin?.text ?? r.explanations.worker?.text}</p>
                  <div className="mt-3 flex gap-2">
                    <Button variant="worker" onClick={() => demo.acknowledge(r.id)}>
                      Got it
                    </Button>
                    <Button variant="ghost" onClick={() => setOpen(r.id)}>
                      Details
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {section === "team" && <TeamPage onOpen={setOpen} />}

      {section === "all" && (
        <>
          <PageHeader title="All requests" sub="Everything submitted by Lumen Robotics workers, with its full audit trail." />
          <RequestTable rows={demo.requests} onOpen={setOpen} showWorker />
        </>
      )}
      {section === "policy" && <PolicyPage />}
      <RequestDetail req={openReq} role="admin" onClose={() => setOpen(null)} />
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Decision cards: one per request type
// ---------------------------------------------------------------------------

type Line = { status: CheckStatus | "cost"; text: string };

function DecisionCard({ req, onDetails }: { req: AnyRequest; onDetails(): void }) {
  const w = getWorker(req.workerId);
  const e = req.explanations.admin;
  const hrNote = req.hrDecision?.action === "clear" ? [...req.history].reverse().find((h) => h.role === "hr") : undefined;
  const { heading, sub, lines, meter } = cardContent(req);

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-display font-bold">
            {w.name} · {heading}
          </div>
          <div className="text-xs text-muted">{sub}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-display text-xl font-extrabold tabular">{valueOf(req)}</div>
          <button onClick={onDetails} className="text-xs font-semibold text-muted hover:text-ink hover:underline">
            Details
          </button>
        </div>
      </div>

      {meter && <div className="mt-3">{meter}</div>}

      {lines.length > 0 && (
        <ul className="mt-3 grid gap-1.5">
          {lines.map((l, i) => (
            <li key={i} className="grid grid-cols-[20px_1fr] gap-2 text-sm">
              {l.status === "cost" ? <span className="mt-0.5 grid size-[18px] place-items-center rounded-full bg-rules-bg text-[11px] font-bold text-rules">$</span> : <CheckIcon status={l.status} />}
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}

      {hrNote && (
        <div className="mt-3 rounded-lg border border-hr/40 bg-hr-bg px-3 py-2.5 text-sm">
          <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-hr">Reviewed by Pebl HR · {hrSpecialist.name}</div>
          {req.explanations.hr && <p>{req.explanations.hr.text}</p>}
          {req.explanations.hr?.suggestedAction && (
            <p className="mt-1">
              <span className="font-semibold text-hr">HR suggests: </span>
              {req.explanations.hr.suggestedAction}
            </p>
          )}
          {hrNote.note && (
            <p className="mt-1">
              <span className="font-semibold text-hr">Resolution note: </span>“{hrNote.note}”
            </p>
          )}
          <p className="mt-1 text-xs text-muted">Pebl HR has cleared the compliance side. The business decision is yours.</p>
        </div>
      )}

      <AdvisoryNote req={req} className="mt-3" />

      <div className="mt-3 rounded-lg bg-ai-bg px-3 py-2.5">
        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ai">
          <SparkIcon /> <span className="font-mono uppercase tracking-wide">{req.kind === "expense" ? "AI summary" : "AI suggestion"}</span>
          {e && <AiSource e={e} />}
        </div>
        {e?.headline && <p className="font-display font-bold text-ai">Suggestion: {e.headline}</p>}
        <p className={cx("text-[15px]", e?.pending && "shimmer rounded")}>{e?.text}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="text-admin">✓ {req.evaluation.checks.filter((c) => c.status === "pass").length} compliance checks passed</span>
      </div>

      <div className="mt-4">
        <RequestActions req={req} role="admin" compact />
      </div>
    </Card>
  );
}

function cardContent(req: AnyRequest): { heading: string; sub: string; lines: Line[]; meter?: React.ReactNode } {
  switch (req.kind) {
    case "expense":
      return expenseCard(req);
    case "leave":
      return leaveCard(req);
    case "overtime":
      return overtimeCard(req);
    case "timesheet":
      return timesheetCard(req);
  }
}

function expenseCard(r: ExpenseRequest) {
  return {
    heading: categoryLabel[r.data.category],
    sub: `${r.data.merchant} · ${shortDate(r.data.date)} · ${getWorker(r.workerId).country}${r.data.currency !== r.evaluation.payroll.currency ? ` · from ${money(r.data.amount, r.data.currency)}` : ""}`,
    lines: [],
  };
}

function leaveCard(r: LeaveRequest) {
  const i = r.insight;
  const lines: Line[] = [];
  const bal = r.evaluation.checks.find((c) => c.id === "balance");
  if (bal) {
    lines.push({
      status: bal.status,
      text: i.expiring
        ? `Within entitlement: ${i.balanceBefore} days left, ${i.expiring.days} of them expire ${rangeLabel(i.expiring.date, i.expiring.date)} under local rules`
        : `Within entitlement: ${i.balanceBefore} days left, ${i.balanceAfter} after this`,
    });
  }
  const notice = r.evaluation.checks.find((c) => c.id === "notice");
  if (notice) lines.push({ status: notice.status, text: notice.status === "pass" ? "Meets the company's 2-week notice policy" : notice.detail });
  for (const a of i.teamAway) lines.push({ status: "borderline", text: `${a.name.split(" ")[0]} on your team is also away ${rangeLabel(a.start, a.end)}` });
  if (i.holidaysInRange.length) lines.push({ status: "info", text: `${i.holidaysInRange.length} public holiday${i.holidaysInRange.length === 1 ? "" : "s"} in the range, not deducted` });
  return { heading: leaveLabel[r.data.type], sub: `${rangeLabel(r.data.start, r.data.end)} · ${i.workingDays} days · ${i.payTreatment}`, lines };
}

function overtimeCard(r: OvertimeRequest) {
  const i = r.insight;
  const w = getWorker(r.workerId);
  const lines: Line[] = [
    { status: "pass", text: `Overtime-eligible${i.prerequisite ? ` · ${i.prerequisite} on file` : ""}` },
    { status: "pass", text: `Brings monthly overtime to ${i.after} of ${i.limit} hours (${i.legalCap !== null ? `company limit; legal cap ${i.legalCap}` : "company limit"})` },
  ];
  if (i.forecast > i.limit) lines.push({ status: "borderline", text: `At the current pace, forecast to reach ${i.forecast} hours by month-end` });
  if (i.overBudget) lines.push({ status: "borderline", text: "Over the monthly overtime budget (your policy, your call)" });
  lines.push({ status: "cost", text: `Cost: ${r.data.hours} hours at a ${i.premiumPct}% premium (${money(i.cost, w.currency)})` });
  return {
    heading: "Overtime request",
    sub: `${dayName(r.data.date)} ${rangeLabel(r.data.date, r.data.date)} · ${r.data.hours} hrs · ${w.country}${r.data.reason ? ` · ${r.data.reason}` : ""}`,
    lines,
    meter: <OvertimeMeter used={i.usedBefore} adding={r.data.hours} limit={i.limit} legalCap={i.legalCap} forecast={i.forecast} />,
  };
}

function timesheetCard(r: TimesheetRequest) {
  const i = r.insight;
  const w = getWorker(r.workerId);
  const unapprovedCost = i.overtimeHours ? (i.unapproved * i.cost) / i.overtimeHours : 0;
  const sub = `Week of ${rangeLabel(r.data.weekStart, r.data.weekStart)} · ${i.totalHours} hrs${r.data.note ? ` · “${r.data.note}”` : ""}`;
  // After an HR incident review, show what actually happened rather than assuming only missed pre-approval.
  if (r.hrDecision) {
    const issues = r.evaluation.checks.filter((c) => c.status === "fail" || c.status === "borderline");
    return {
      heading: "Timesheet",
      sub,
      lines: [
        { status: (i.monthAfter > i.limit ? "fail" : "pass") as CheckStatus, text: `${i.overtimeHours} overtime hours; month total ${i.monthAfter} of ${i.limit}` },
        ...issues.map((c) => ({ status: c.status, text: `${c.label}: ${c.detail}` })),
        { status: "cost" as const, text: `Overtime pay: ${money(i.cost, w.currency)}. Hours worked must be paid.` },
      ],
    };
  }
  return {
    heading: "Timesheet",
    sub,
    lines: [
      { status: "info" as const, text: `${i.unapproved} overtime hours worked without pre-approval` },
      { status: "pass" as const, text: `Within the limit: ${i.monthAfter} of ${i.limit} hours this month` },
      { status: "cost" as const, text: `Cost: ${money(unapprovedCost, w.currency)} for those hours. Hours worked must be paid.` },
    ],
  };
}

// ---------------------------------------------------------------------------
// Team: who's away and overtime against limits (TM-5, TM-8, LV-13)
// ---------------------------------------------------------------------------

function TeamPage({ onOpen }: { onOpen(id: string): void }) {
  const demo = useDemo();
  return (
    <>
      <PageHeader title="Team" sub="Overtime against each person's effective limit, with alerts at 80% and 90%, and upcoming leave: who's away, never why." />
      <div className="grid gap-3">
        {workers.map((w) => {
          const st = overtimeStatus(w, demo.requests, demo.policy);
          const L = overtimeLimits(w, demo.policy);
          const away = teamLeave(w.team, demo.requests).filter((r) => r.workerId === w.id && r.data.end >= DEMO_TODAY);
          return (
            <Card key={w.id} className="grid gap-3 p-4 md:grid-cols-[200px_minmax(0,1fr)_200px] md:items-center">
              <div>
                <div className="font-display font-bold">{w.name}</div>
                <div className="text-xs text-muted">
                  {w.title} · {w.country}
                </div>
              </div>
              <div>
                {!timeRules[w.country].covered ? (
                  <p className="text-sm text-muted">Working-time rules for {w.country} aren&apos;t covered yet, so Pebl HR handles timesheets.</p>
                ) : !st.eligible ? (
                  <p className="text-sm text-muted">Exempt from overtime (classification set by Pebl HR).</p>
                ) : !st.switchedOn ? (
                  <p className="text-sm text-danger">Overtime switched off.</p>
                ) : (
                  <>
                    <OvertimeMeter used={st.committed} adding={st.pending} limit={st.limit} legalCap={L.legalCap} forecast={st.forecast} />
                    {st.alerts.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {st.alerts.map((a, i) => (
                          <span key={i} className={cx("rounded-md px-2 py-0.5 text-xs font-semibold", a.level === "forecast" ? "bg-hr-bg text-hr" : a.level === "manager" ? "bg-danger-bg text-danger" : "bg-rules-bg text-rules")}>
                            {a.level === "forecast" ? `Forecast ${st.forecast} of ${st.limit}` : a.level === "manager" ? "90%: stop or reschedule" : "80% heads-up"}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="text-sm">
                {away.length ? (
                  away.map((r) => (
                    <button key={r.id} onClick={() => onOpen(r.id)} className="block text-left hover:underline">
                      Away {rangeLabel(r.data.start, r.data.end)} {r.status !== "approved" && <span className="text-muted">(pending)</span>}
                    </button>
                  ))
                ) : (
                  <span className="text-muted">No leave booked</span>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Policy (layer 2), with law-as-floor checks at onboarding
// ---------------------------------------------------------------------------

function PolicyPage() {
  const demo = useDemo();
  const [tab, setTab] = useState<"expense" | "leave" | "hours" | "time">("expense");
  return (
    <>
      <PageHeader
        title="Policy"
        sub={`Lumen Robotics' own rules (layer 2), set at onboarding from Pebl's country templates. Version ${demo.policy.version}, effective ${shortDate(demo.policy.effectiveFrom)}. Conflicts with local law are caught here, not when a request fails.`}
      />
      <div role="tablist" className="mb-5 flex gap-1 border-b border-line">
        {(
          [
            ["expense", "Expenses"],
            ["leave", "Leave"],
            ["hours", "Working hours"],
            ["time", "Overtime"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx("border-b-[3px] px-3 py-2 font-display text-sm font-bold", tab === id ? "border-rules text-ink" : "border-transparent text-muted hover:text-ink")}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "expense" && <ExpensePolicyTab />}
      {tab === "leave" && <LeavePolicyTab />}
      {tab === "hours" && <WorkingHoursTab />}
      {tab === "time" && <OvertimePolicyTab />}
    </>
  );
}
