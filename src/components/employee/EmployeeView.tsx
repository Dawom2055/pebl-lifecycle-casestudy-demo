"use client";

import { useState } from "react";
import { getWorker } from "@/lib/data";
import { titleOf } from "@/lib/describe";
import { money } from "@/lib/format";
import { leaveBalances } from "@/lib/engine/leave";
import { nudgesFor } from "@/lib/engine/nudges";
import { overtimeStatus, sheetFor } from "@/lib/engine/time";
import { useDemo } from "@/lib/store";
import type { AnyRequest, ExpenseRequest, LeaveRequest } from "@/lib/types";
import { Alfie } from "../Alfie";
import { AppShell } from "../AppShell";
import { RequestDetail } from "../RequestDetail";
import { RequestTable } from "../RequestTable";
import { Button, Card, cx, Eyebrow, PageHeader, SparkIcon, StatusBadge } from "../ui";
import { LeavePage } from "./LeavePage";
import { NewExpense } from "./NewExpense";
import { TimePage } from "./TimePage";

const ATTENTION = new Set(["needs_fix", "info_requested", "changes_suggested"]);

export function EmployeeView() {
  const demo = useDemo();
  const mine = demo.requests.filter((r) => r.workerId === demo.actingWorkerId);
  const attention = mine.filter((r) => ATTENTION.has(r.status));
  const section = demo.section.employee;
  const [open, setOpen] = useState<string | null>(null);
  const [fixExpense, setFixExpense] = useState<ExpenseRequest | null>(null);
  const [fixLeave, setFixLeave] = useState<LeaveRequest | null>(null);
  const openReq = open ? demo.requests.find((r) => r.id === open) ?? null : null;

  const startFix = (req: AnyRequest) => {
    setOpen(null);
    if (req.kind === "expense") {
      setFixExpense(req);
      demo.setSection("employee", "new");
    } else if (req.kind === "leave") {
      setFixLeave(req);
      demo.setSection("employee", "leave");
    } else {
      demo.setSection("employee", "time");
    }
  };

  return (
    <AppShell
      aside={<Alfie role="employee" onOpen={setOpen} className="h-full" />}
      nav={[
        { id: "home", label: "Home", count: attention.length || undefined },
        { id: "expenses", label: "Expenses" },
        { id: "new", label: "New expense" },
        { id: "leave", label: "Leave" },
        { id: "time", label: "Time" },
      ]}
    >
      {section === "home" && <Home mine={mine} attention={attention} onOpen={setOpen} />}
      {section === "expenses" && (
        <>
          <PageHeader title="My expenses" sub="Every request shows where it is in the pipeline and why." actions={<Button variant="worker" onClick={() => demo.setSection("employee", "new")}>New expense</Button>} />
          <RequestTable rows={mine.filter((r) => r.kind === "expense")} onOpen={setOpen} />
        </>
      )}
      {section === "new" && (
        <>
          <PageHeader title={fixExpense ? `Fix ${fixExpense.id}` : "New expense"} sub="AI reads the receipt, you confirm it, and the rules engine checks it the moment you submit." />
          <NewExpense
            key={`${demo.actingWorkerId}-${fixExpense?.id ?? "new"}`}
            fixing={fixExpense}
            onDone={() => {
              setFixExpense(null);
              demo.setSection("employee", "expenses");
            }}
          />
        </>
      )}
      {section === "leave" && <LeavePage key={`${demo.actingWorkerId}-${fixLeave?.id ?? "new"}`} fixing={fixLeave} onFixed={() => setFixLeave(null)} onOpen={setOpen} />}
      {section === "time" && <TimePage key={demo.actingWorkerId} onOpen={setOpen} />}
      <RequestDetail req={openReq} role="employee" onClose={() => setOpen(null)} onFix={startFix} />
    </AppShell>
  );
}

function Home({ mine, attention, onOpen }: { mine: AnyRequest[]; attention: AnyRequest[]; onOpen(id: string): void }) {
  const demo = useDemo();
  const w = getWorker(demo.actingWorkerId);
  const inFlight = mine.filter((r) => r.status === "awaiting_admin" || r.status === "hr_review");
  const approvedExpenses = mine.filter((r) => r.kind === "expense" && r.status === "approved");
  const approvedTotal = approvedExpenses.reduce((s, r) => s + r.evaluation.payroll.amount, 0);
  const vacation = leaveBalances(w, demo.requests, demo.policy).find((b) => b.type === "vacation")!;
  const ot = overtimeStatus(w, demo.requests, demo.policy);
  const sheet = sheetFor(w.id, demo.requests);
  const nudges = nudgesFor(w, demo.requests, demo.policy);

  return (
    <>
      <PageHeader title={`Hi ${w.name.split(" ")[0]}`} sub="Submit expenses, take leave and log time. Problems are caught when you submit, in plain language." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Needs you" value={String(attention.length)} tone={attention.length ? "text-worker" : undefined} />
        <Stat label="In progress" value={String(inFlight.length)} />
        <Stat label="Expenses approved, to payroll" value={money(approvedTotal, w.currency)} />
      </div>

      {nudges.length > 0 && (
        <section className="mt-6">
          <Eyebrow className="mb-2 flex items-center gap-1.5">
            <SparkIcon className="text-ai" /> Reminders from Pebl AI
          </Eyebrow>
          <div className="grid gap-2 md:grid-cols-2">
            {nudges.map((n) => (
              <div key={n.id} className={cx("flex flex-col rounded-xl border px-4 py-3", n.tone === "hr" ? "border-hr/40 bg-hr-bg" : n.tone === "admin" ? "border-admin/40 bg-admin-bg" : "border-worker/40 bg-worker-bg")}>
                <div className="font-semibold">{n.title}</div>
                <p className="mt-0.5 flex-1 text-sm text-muted">{n.text}</p>
                <Button variant="worker" size="sm" className="mt-2 self-start" onClick={() => demo.setSection("employee", n.action.section)}>
                  {n.action.label}
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {attention.length > 0 && (
        <section className="mt-6">
          <Eyebrow className="mb-2">Needs your attention</Eyebrow>
          <div className="grid gap-2">
            {attention.map((r) => (
              <button key={r.id} onClick={() => onOpen(r.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-worker/40 bg-worker-bg px-4 py-3 text-left">
                <span className="text-sm">
                  <span className="font-semibold">{titleOf(r)}</span> · {r.status === "changes_suggested" ? "Your manager suggested other dates." : r.explanations.worker?.text ?? ""}
                </span>
                <StatusBadge status={r.status} />
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6 grid gap-3 md:grid-cols-3">
        <Card className="flex flex-col p-5">
          <h2 className="font-bold">Expenses</h2>
          <p className="mt-1 flex-1 text-sm text-muted">Snap a receipt. AI fills it in, you confirm, and it&apos;s checked against {w.country} rules and Lumen&apos;s policy instantly.</p>
          <Button variant="worker" className="mt-4 self-start" onClick={() => demo.setSection("employee", "new")}>
            Submit an expense
          </Button>
        </Card>
        <Card className="flex flex-col p-5">
          <h2 className="font-bold">Leave</h2>
          <p className="mt-1 font-display text-2xl font-extrabold tabular">{vacation.available} vacation days</p>
          <p className="flex-1 text-sm text-muted">{vacation.pending ? `${vacation.pending} pending. ` : ""}Eligible types, live balances and checks before you submit.</p>
          <Button variant="worker" className="mt-4 self-start" onClick={() => demo.setSection("employee", "leave")}>
            Request leave
          </Button>
        </Card>
        <Card className="flex flex-col p-5">
          <h2 className="font-bold">Time</h2>
          {ot.eligible && ot.switchedOn ? (
            <p className="mt-1 font-display text-2xl font-extrabold tabular">{ot.remaining} overtime hrs left</p>
          ) : (
            <p className="mt-1 font-display text-lg font-extrabold">{ot.eligible ? "Overtime off" : "Exempt from overtime"}</p>
          )}
          <p className="flex-1 text-sm text-muted">{sheet ? `Timesheet for this week: ${sheet.insight.totalHours} hrs submitted.` : "This week's timesheet is pre-filled and ready to confirm."}</p>
          <Button variant="worker" className="mt-4 self-start" onClick={() => demo.setSection("employee", "time")}>
            {sheet ? "View time" : "Confirm timesheet"}
          </Button>
        </Card>
      </section>

      <section className="mt-6">
        <Eyebrow className="mb-2">Recent</Eyebrow>
        <RequestTable rows={mine.slice(0, 6)} onOpen={onOpen} />
      </section>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className={`font-display text-2xl font-extrabold tabular ${tone ?? ""}`}>{value}</div>
    </Card>
  );
}
