"use client";

import { useState } from "react";
import { rangeLabel } from "@/lib/calendar";
import { client, countryRules, getWorker, hrSpecialist } from "@/lib/data";
import { subtitleOf, titleOf, valueOf } from "@/lib/describe";
import { dateTime, money } from "@/lib/format";
import { leaveLabel } from "@/lib/engine/leave";
import { hrLinksFor } from "@/lib/hr-links";
import { useDemo } from "@/lib/store";
import type { AnyRequest, LeaveRequest, OvertimeRequest, Role, TimesheetRequest } from "@/lib/types";
import { RequestChat } from "./RequestChat";
import { Alfie } from "./Alfie";
import { SimilarCases } from "./SimilarCases";
import { AdvisoryNote, ChecksList, ExplanationCard, OvertimeMeter, PipelineTrace, ReceiptView, SignalsList, TimesheetTable } from "./request-parts";
import { Button, cx, Eyebrow, Modal, Required, StatusBadge } from "./ui";

const audienceFor = { employee: "worker", admin: "admin", hr: "hr" } as const;

/** Full view of one request: what each stage decided, and the actions open to the current role. */
export function RequestDetail({ req, role, onClose, onFix, onOpen }: { req: AnyRequest | null; role: Role; onClose(): void; onFix?(req: AnyRequest): void; onOpen?(id: string): void }) {
  if (!req) return null;
  const worker = getWorker(req.workerId);
  const explanation = req.explanations[audienceFor[role]] ?? req.explanations.worker;
  const agent = role === "hr";

  return (
    <Modal open onClose={onClose} title={`${req.id} · ${titleOf(req)}`} wide xwide={agent}>
      <div className={cx(agent && "grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]")}>
      <div className="grid min-w-0 gap-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusBadge status={req.status} />
          <span className="font-display text-2xl font-extrabold tabular">{valueOf(req)}</span>
          {req.kind === "expense" && req.data.currency !== req.evaluation.payroll.currency && <span className="text-sm text-muted">from {money(req.data.amount, req.data.currency)}</span>}
          <span className="text-sm text-muted">
            {worker.name} · {worker.country} · {subtitleOf(req)}
          </span>
        </div>

        {role === "admin" && <HrNote req={req} />}
        {role === "admin" && <AdvisoryNote req={req} />}

        <ExplanationCard
          explanation={explanation}
          label={role === "hr" ? "AI analysis for HR" : role === "admin" ? (req.routing.outcome === "manager" ? "AI suggestion" : "AI summary") : "What happens next"}
          tone={role === "hr" ? "hr" : "ai"}
        />

        {role === "hr" && <SimilarCases req={req} onDone={onClose} />}

        <RequestActions req={req} role={role} onDone={onClose} onFix={onFix} />

        {role === "hr" && <HrLinks req={req} />}

        {req.kind === "leave" && <LeavePanel req={req} />}
        {req.kind === "overtime" && <OvertimePanel req={req} />}
        {req.kind === "timesheet" && <TimesheetPanel req={req} />}

        <section>
          <Eyebrow className="mb-2">Pipeline</Eyebrow>
          <PipelineTrace req={req} />
        </section>

        <div className={cx("grid gap-6", req.kind === "expense" && "lg:grid-cols-[minmax(0,1fr)_280px]")}>
          <div className="grid content-start gap-6">
            <section>
              <Eyebrow className="mb-2">Rules engine · two layers</Eyebrow>
              <ChecksList checks={req.evaluation.checks} />
            </section>
            <section>
              <Eyebrow className="mb-2">Risk router signals · combination {req.routing.combination}</Eyebrow>
              <SignalsList req={req} />
              {req.routing.shadowWould && (
                <p className="mt-2 rounded-lg bg-rules-bg px-3 py-2 text-sm text-rules">
                  Shadow mode. The system would have{" "}
                  <b>{req.routing.shadowWould === "auto_clear" ? "approved it automatically" : req.routing.shadowWould === "manager" ? "sent it to the manager" : "sent it to HR"}</b>. HR&apos;s decision is logged against that to build the evidence for unlocking.
                </p>
              )}
            </section>
            <section>
              <Eyebrow className="mb-2">Payroll</Eyebrow>
              <ul className="grid gap-1 text-sm">
                {req.evaluation.payroll.lines.map((l, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-rules" />
                    {l}
                  </li>
                ))}
              </ul>
            </section>
          </div>
          {req.kind === "expense" && (
            <div className="grid content-start gap-4">
              <section>
                <Eyebrow className="mb-2">Receipt</Eyebrow>
                <ReceiptView req={req} />
              </section>
              {req.data.note && (
                <section>
                  <Eyebrow className="mb-1">Purpose</Eyebrow>
                  <p className="text-sm">{req.data.note}</p>
                </section>
              )}
            </div>
          )}
        </div>

        <section>
          <Eyebrow className="mb-2">Audit trail</Eyebrow>
          <ol className="grid gap-1.5 border-l-2 border-line pl-4">
            {req.history.map((h, i) => (
              <li key={i} className="text-sm">
                <span className="font-mono text-[11px] text-faint">{dateTime(h.at)}</span> <span className="font-semibold">{h.actor}</span> <span className="text-muted">{h.action}</span>
                {h.note && <span className="block text-muted">“{h.note}”</span>}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-faint">Every decision stores its inputs, the rule versions used, the routing signals and who acted.</p>
        </section>

        {role === "admin" && <RequestChat key={req.id} req={req} reader="admin" />}
      </div>
      {agent && <Alfie role="hr" key={req.id} focus={req} onOpen={onOpen} className="h-[520px] lg:sticky lg:top-[68px] lg:h-[calc(92vh-100px)] lg:self-start" />}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Module panels
// ---------------------------------------------------------------------------

function LeavePanel({ req }: { req: LeaveRequest }) {
  const i = req.insight;
  return (
    <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
      <Fact label="Leave">
        {leaveLabel[req.data.type]}, {rangeLabel(req.data.start, req.data.end)} · {i.workingDays} working day{i.workingDays === 1 ? "" : "s"}
        {req.data.halfDay ? " (half day)" : ""}
      </Fact>
      <Fact label="Balance">{i.balanceBefore === null ? "As needed" : `${i.balanceBefore} before → ${i.balanceAfter} after`}</Fact>
      <Fact label="Pay treatment">{i.payTreatment}</Fact>
      <Fact label="Team">{i.teamAway.length ? i.teamAway.map((a) => `${a.name.split(" ")[0]} away ${rangeLabel(a.start, a.end)}`).join("; ") : "No one else on the team is away"}</Fact>
      {i.holidaysInRange.length > 0 && <Fact label="Not deducted">{i.holidaysInRange.map((h) => `${rangeLabel(h.date, h.date)} ${h.name}`).join(", ")}</Fact>}
      {i.expiring && <Fact label="Expiring">{`${i.expiring.days} days expire ${rangeLabel(i.expiring.date, i.expiring.date)}`}</Fact>}
      {req.data.note && <Fact label="Note">{req.data.note}</Fact>}
    </section>
  );
}

function OvertimePanel({ req }: { req: OvertimeRequest }) {
  const i = req.insight;
  return (
    <section className="grid gap-3 rounded-xl border border-line bg-surface p-4">
      <OvertimeMeter used={i.usedBefore} adding={req.data.hours} limit={i.limit} legalCap={i.legalCap} forecast={i.forecast} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Fact label="Hours left after">{i.remainingAfter}</Fact>
        <Fact label="Cost">{`${money(i.cost, getWorker(req.workerId).currency)} (${i.premiumPct}% premium)`}</Fact>
        <Fact label="Reason">{req.data.reason || "–"}</Fact>
      </div>
    </section>
  );
}

function TimesheetPanel({ req }: { req: TimesheetRequest }) {
  const i = req.insight;
  return (
    <section className="grid gap-4 rounded-xl border border-line bg-surface p-4">
      <TimesheetTable req={req} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Fact label="Total">{i.totalHours} hrs</Fact>
        <Fact label="Overtime">{`${i.overtimeHours} hrs (${i.preApproved} approved)`}</Fact>
        <Fact label="Month to date">{`${i.monthAfter} of ${i.limit}`}</Fact>
        <Fact label="Overtime pay">{money(i.cost, getWorker(req.workerId).currency)}</Fact>
      </div>
    </section>
  );
}

/** Pebl HR's note from clearing the request, shown at the top for the client admin who makes the final call. */
function HrNote({ req }: { req: AnyRequest }) {
  const entry = [...req.history].reverse().find((h) => h.role === "hr" && h.note && !h.action.startsWith("Audit"));
  if (!entry) return null;
  return (
    <section className="rounded-xl border-l-4 border-hr bg-hr-bg px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow className="text-hr">Note from Pebl HR</Eyebrow>
        <span className="font-mono text-[11px] text-faint">{dateTime(entry.at)}</span>
      </div>
      <p className="mt-1.5 text-[15px] leading-relaxed">“{entry.note}”</p>
      <p className="mt-1.5 text-xs text-muted">
        {entry.actor}, {hrSpecialist.title} · {entry.action}
      </p>
    </section>
  );
}

/** Official sources for the worker's country and this request type, so HR can check a rule without leaving the case. */
function HrLinks({ req }: { req: AnyRequest }) {
  const worker = getWorker(req.workerId);
  const topic = req.kind === "expense" ? "expense" : req.kind === "leave" ? "leave" : "working-time";
  return (
    <section>
      <Eyebrow className="mb-2">
        Need more info? · Official {countryRules[worker.country].name} {topic} sources
      </Eyebrow>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {hrLinksFor(req).map((l) => (
          <a key={l.href + l.hint} href={l.href} target="_blank" rel="noopener noreferrer" className="group rounded-xl border border-line bg-surface px-3 py-2.5 transition hover:border-hr">
            <span className="flex items-center gap-1 text-sm font-semibold group-hover:text-hr">
              {l.label}
              <span aria-hidden className="text-faint">
                ↗
              </span>
            </span>
            <span className="block text-xs text-muted">{l.hint}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actions open to each role
// ---------------------------------------------------------------------------

type Mode = null | "decline" | "info" | "deny" | "clear" | "reply" | "suggest" | "note" | "contact";

export function RequestActions({ req, role, onDone, onFix, compact }: { req: AnyRequest; role: Role; onDone?(): void; onFix?(req: AnyRequest): void; compact?: boolean }) {
  const demo = useDemo();
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [start, setStart] = useState(req.kind === "leave" ? req.insight.clearRange?.start ?? req.data.start : "");
  const [end, setEnd] = useState(req.kind === "leave" ? req.insight.clearRange?.end ?? req.data.end : "");
  const done = () => {
    setMode(null);
    setText("");
    onDone?.();
  };
  const lastNote = [...req.history].reverse().find((h) => h.note && h.role !== "system");

  const form = (opts: { label: string; placeholder: string; required: boolean; dates?: boolean; warn?: string; submit(): void; variant: "primary" | "danger" | "hr" | "worker" }) => (
    <div className="grid gap-2 rounded-xl border border-line bg-surface p-4">
      {opts.warn && <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{opts.warn}</p>}
      {opts.dates && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs font-semibold text-muted">
            From
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-sm text-ink" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-muted">
            To
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-sm text-ink" />
          </label>
        </div>
      )}
      <label className="text-sm font-semibold" htmlFor={`note-${req.id}`}>
        {opts.label} {opts.required && <Required />}
      </label>
      <textarea id={`note-${req.id}`} value={text} onChange={(e) => setText(e.target.value)} placeholder={opts.placeholder} rows={2} className="rounded-lg border border-line px-3 py-2 text-sm" autoFocus />
      <div className="flex gap-2">
        <Button variant={opts.variant} disabled={(opts.required && !text.trim()) || (opts.dates && (!start || !end || end < start))} onClick={opts.submit}>
          Confirm
        </Button>
        <Button variant="ghost" onClick={() => setMode(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );

  // ---- Employee
  if (role === "employee") {
    if (req.status === "needs_fix") {
      return (
        <div className="flex flex-wrap gap-2">
          {onFix && (
            <Button variant="worker" onClick={() => onFix(req)}>
              Fix and resubmit
            </Button>
          )}
          <Button variant="ghost" onClick={() => (demo.withdraw(req.id), done())}>
            Withdraw
          </Button>
        </div>
      );
    }
    if (req.status === "changes_suggested" && req.suggestion) {
      return (
        <div className="rounded-xl border border-worker/40 bg-worker-bg p-4">
          <div className="text-sm font-semibold text-worker">
            {client.admin.name} suggested {rangeLabel(req.suggestion.start, req.suggestion.end)} instead
          </div>
          {req.suggestion.note && <p className="mt-1 text-sm">“{req.suggestion.note}”</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="worker" onClick={() => (demo.acceptSuggestion(req.id), done())}>
              Use these dates
            </Button>
            <Button variant="ghost" onClick={() => (demo.withdraw(req.id), done())}>
              Withdraw
            </Button>
          </div>
        </div>
      );
    }
    if (req.status === "info_requested") {
      if (mode === "reply") return form({ label: "Reply to Pebl HR", placeholder: "Your answer", required: true, submit: () => (demo.workerRespond(req.id, text), done()), variant: "worker" });
      return (
        <div className="rounded-xl border border-worker/40 bg-worker-bg p-4">
          <div className="text-sm font-semibold text-worker">{hrSpecialist.name} asked for more information</div>
          {lastNote?.note && <p className="mt-1 text-sm">“{lastNote.note}”</p>}
          <Button variant="worker" className="mt-3" onClick={() => setMode("reply")}>
            Reply
          </Button>
        </div>
      );
    }
    if (req.status === "denied" && lastNote?.note) return <p className="rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger">Reason given: “{lastNote.note}”</p>;
    if ((req.status === "awaiting_admin" || req.status === "hr_review") && req.kind !== "timesheet" && !compact) {
      return (
        <div>
          <Button variant="ghost" size="sm" onClick={() => (demo.withdraw(req.id), done())}>
            Withdraw request
          </Button>
        </div>
      );
    }
    return null;
  }

  // ---- Client admin / manager
  if (role === "admin") {
    if (req.status === "approved" && req.managerNotice && !req.managerNotice.acknowledged) {
      return (
        <div>
          <Button variant="worker" onClick={() => (demo.acknowledge(req.id), done())}>
            Got it
          </Button>
        </div>
      );
    }
    if (req.status !== "awaiting_admin") return compact ? null : <p className="text-sm text-muted">{statusNote(req)}</p>;
    if (mode === "contact")
      return form({ label: "What do you want Pebl HR to check?", placeholder: "e.g. Is this within local law for Germany? Pebl HR sees this; the worker doesn't.", required: true, submit: () => (demo.adminContactHr(req.id, text), done()), variant: "hr" });
    const contactHr = <Button onClick={() => setMode("contact")}>Contact HR</Button>;

    if (req.kind === "leave") {
      const risk = req.insight.legalRisk
        ? `Declining could stop ${getWorker(req.workerId).name.split(" ")[0]} using ${req.insight.expiring?.days} days of statutory leave before they expire on ${rangeLabel(req.insight.expiring!.date, req.insight.expiring!.date)}. A decline goes to Pebl HR.`
        : undefined;
      if (mode === "suggest")
        return form({ label: "Note to the worker (optional)", placeholder: "e.g. Could you take Dec 14–15 so the team is covered?", required: false, dates: true, submit: () => (demo.adminSuggestDates(req.id, start, end, text), done()), variant: "primary" });
      if (mode === "decline")
        return form({ label: "Reason (the worker sees this)", placeholder: "Managers set the timing, not the entitlement.", required: true, dates: true, warn: risk, submit: () => (demo.adminDecline(req.id, text, { start, end }), done()), variant: "danger" });
      return (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => (demo.adminApprove(req.id), done())}>
            Approve
          </Button>
          <Button onClick={() => setMode("suggest")}>Suggest other dates</Button>
          <Button variant="danger" onClick={() => setMode("decline")}>
            Decline
          </Button>
          {contactHr}
        </div>
      );
    }

    if (req.kind === "overtime") {
      if (mode === "decline") return form({ label: "Reason (the worker sees this)", placeholder: "e.g. Let's move the go-live check to Monday.", required: true, submit: () => (demo.adminDecline(req.id, text), done()), variant: "danger" });
      const partial = req.insight.partialHours;
      return (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => (demo.adminApprove(req.id), done())}>
            Approve
          </Button>
          {partial && <Button onClick={() => (demo.adminApprove(req.id, { hours: partial }), done())}>Approve {partial} hour{partial === 1 ? "" : "s"}</Button>}
          <Button variant="danger" onClick={() => setMode("decline")}>
            Decline
          </Button>
          {contactHr}
        </div>
      );
    }

    if (req.kind === "timesheet") {
      if (mode === "note") return form({ label: "Note on the missed pre-approval", placeholder: "e.g. Please request overtime in advance next time.", required: true, submit: () => (demo.adminApprove(req.id, { note: text }), done()), variant: "primary" });
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => (demo.adminApprove(req.id), done())}>
            Confirm
          </Button>
          <Button onClick={() => setMode("note")}>Add a note</Button>
          {contactHr}
          <span className="text-xs text-muted">Hours already worked must be paid; you can&apos;t refuse them.</span>
        </div>
      );
    }

    if (mode === "decline") return form({ label: "Why are you declining?", placeholder: "The worker sees this reason.", required: true, submit: () => (demo.adminDecline(req.id, text), done()), variant: "danger" });
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => (demo.adminApprove(req.id), done())}>
          Approve
        </Button>
        <Button variant="danger" onClick={() => setMode("decline")}>
          Decline
        </Button>
        {contactHr}
      </div>
    );
  }

  // ---- Pebl HR
  if (req.auditSampled && !req.auditResult && req.status === "approved") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Random audit:</span>
        <Button variant="hr" onClick={() => (demo.resolveAudit(req.id, "no_issue"), done())}>
          No issue
        </Button>
        <Button variant="danger" onClick={() => (demo.resolveAudit(req.id, "issue"), done())}>
          Issue found
        </Button>
      </div>
    );
  }
  if (req.status !== "hr_review") return compact ? null : <p className="text-sm text-muted">{statusNote(req)}</p>;
  // Pebl HR clears the compliance side; for expenses and time the client admin still makes the final call.
  const referral = req.routing.signals.find((s) => s.id === "admin_referral");
  const adminQuestion = referral && [...req.history].reverse().find((h) => h.role === "admin" && h.note)?.note;
  const toAdmin = req.kind !== "leave" || !!referral;
  const clearLabel = toAdmin ? "Send to Admin" : "Clear";
  const clearVariant = toAdmin ? "primary" : "hr";
  if (mode === "clear")
    return form({
      label: req.kind === "leave" && !referral ? "Clear this request" : referral ? "Your answer to the client admin" : "Resolution note and suggestion (the client admin sees this)",
      placeholder:
        req.kind === "timesheet"
          ? "e.g. Pay all 23 hours at the overtime rate. Rest breach recorded; please review the team's workload."
          : req.kind === "overtime"
            ? "e.g. Within the legal cap. Suggest approving 2 hours now and the rest next month."
            : "Optional note",
      required: false,
      submit: () => (demo.hrClear(req.id, text), done()),
      variant: clearVariant,
    });
  if (mode === "info") return form({ label: "What do you need from the worker?", placeholder: "Your question", required: true, submit: () => (demo.hrRequestInfo(req.id, text), done()), variant: "worker" });
  if (mode === "deny") return form({ label: req.kind === "leave" ? "Why isn't this eligible?" : "Reason for denial", placeholder: "The worker sees this reason. Only a person can deny a request.", required: true, submit: () => (demo.hrDeny(req.id, text), done()), variant: "danger" });
  return (
    <div className="grid gap-3">
      {referral && !compact && (
        <div className="rounded-xl border border-hr/40 bg-hr-bg p-4">
          <div className="text-sm font-semibold text-hr">{client.admin.name} asked for Pebl HR&apos;s view</div>
          {adminQuestion && <p className="mt-1 text-sm">“{adminQuestion}”</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={clearVariant} onClick={() => setMode("clear")}>
          {clearLabel}
        </Button>
        <Button onClick={() => setMode("info")}>Ask for info</Button>
        {req.kind !== "timesheet" && (
          <Button variant="danger" onClick={() => setMode("deny")}>
            {req.kind === "leave" ? "Not eligible" : "Deny with reason"}
          </Button>
        )}
        {req.routing.shadowWould && !compact && <span className="text-xs text-muted">Your decision is logged against the system&apos;s recommendation.</span>}
      </div>
    </div>
  );
}

function statusNote(req: AnyRequest) {
  switch (req.status) {
    case "hr_review":
      return "With Pebl HR.";
    case "needs_fix":
      return "Back with the worker to fix. It hasn't reached anyone else.";
    case "info_requested":
      return "Waiting on the worker to answer HR's question.";
    case "changes_suggested":
      return "Waiting on the worker to accept the suggested dates.";
    case "approved":
      return req.kind === "expense" ? `Approved. Paid through payroll.` : "Approved. Balance and payroll updated.";
    case "denied":
      return "Declined by a person, with a reason the worker can see.";
    case "awaiting_admin":
      return `Waiting on ${client.admin.name}.`;
    default:
      return "Withdrawn by the worker.";
  }
}
