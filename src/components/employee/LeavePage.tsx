"use client";

import { useState } from "react";
import { addDays, isWeekend, rangeLabel, weekStartOf } from "@/lib/calendar";
import { client, DEMO_TODAY, getWorker } from "@/lib/data";
import { countLeaveDays, evaluateLeave, holidaysFor, leaveBalances, leaveLabel, teamLeave, tierFor } from "@/lib/engine/leave";
import { useDemo } from "@/lib/store";
import type { AnyRequest, LeaveData, LeaveRequest, LeaveType } from "@/lib/types";
import { RequestTable } from "../RequestTable";
import { ResultPanel } from "../ResultPanel";
import { CheckIcon } from "../request-parts";
import { ActorChip, Button, Card, cx, Eyebrow, PageHeader, Required, SparkIcon } from "../ui";

/** Today, or Friday if today is a weekend, so a sick day always covers a working day. */
const lastWorkingDay = isWeekend(DEMO_TODAY) ? addDays(weekStartOf(DEMO_TODAY), 4) : DEMO_TODAY;

const SCENARIOS: { label: string; hint: string; data: Partial<LeaveData> }[] = [
  { label: "Vacation Dec 14–18", hint: "Manager card: 5 days expire Dec 31", data: { type: "vacation", start: "2026-12-14", end: "2026-12-18", note: "Winter break" } },
  { label: "Christmas break", hint: "Public holidays in the range aren't deducted", data: { type: "vacation", start: "2026-12-21", end: "2027-01-01", note: "Christmas with family" } },
  { label: "Sick today", hint: "Protected leave: approved automatically", data: { type: "sick", start: lastWorkingDay, end: lastWorkingDay, note: "" } },
  { label: "Paternity leave", hint: "Statutory leave goes to Pebl HR", data: { type: "paternity", start: "2026-11-16", end: "2026-11-27", note: "Baby due Nov 14" } },
  { label: "Two weeks in November", hint: "More than the balance: split into paid and unpaid", data: { type: "vacation", start: "2026-11-16", end: "2026-11-27", note: "Trip to Lahore" } },
  { label: "Next week", hint: "Misses the 2-week notice period: the manager decides, with a disclaimer", data: { type: "vacation", start: addDays(weekStartOf(DEMO_TODAY), 10), end: addDays(weekStartOf(DEMO_TODAY), 11), note: "" } },
];

const tierText = {
  auto: { label: "Approved automatically", actor: "admin" as const, sub: "Protected leave the employer can't refuse. Your manager is notified." },
  manager: { label: `Your manager decides`, actor: "admin" as const, sub: "They get a decision card with the compliance check and an AI suggestion." },
  hr: { label: "Pebl HR reviews", actor: "hr" as const, sub: "Statutory pay, documents and job protection are checked by a specialist." },
};

export function LeavePage({ fixing, onFixed, onOpen }: { fixing: LeaveRequest | null; onFixed(): void; onOpen(id: string): void }) {
  const demo = useDemo();
  const worker = getWorker(fixing?.workerId ?? demo.actingWorkerId);
  const balances = leaveBalances(worker, demo.requests, demo.policy, fixing?.id);
  const [form, setForm] = useState<LeaveData>(fixing?.data ?? { type: "vacation", start: "", end: "", halfDay: false, note: "" });
  const [resultId, setResultId] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const result = resultId ? demo.requests.find((r) => r.id === resultId) : undefined;
  const mine = demo.requests.filter((r) => r.kind === "leave" && r.workerId === worker.id);
  const team = teamLeave(worker.team, demo.requests).filter((r) => r.workerId !== worker.id && r.data.end >= DEMO_TODAY);
  const holidays = holidaysFor(worker).filter((h) => h.date >= DEMO_TODAY);

  const ready = !!form.start && !!form.end;
  const preview = (ready ? evaluateLeave(form, worker, demo.policy, demo.requests, fixing?.id) : null);
  const days = ready ? countLeaveDays(worker, form).count : 0;
  const tier = ready ? tierFor(form.type, days, worker, demo.policy) : null;
  const fails = preview?.evaluation.checks.filter((c) => c.status === "fail") ?? [];
  const blocking = fails.filter((c) => c.fixable);
  const balanceShort = preview && preview.insight.balanceAfter !== null && preview.insight.balanceAfter < 0 ? -preview.insight.balanceAfter : 0;
  const docNeeded = preview?.evaluation.checks.some((c) => c.id === "document" && c.status !== "pass") ?? false;

  const set = (patch: Partial<LeaveData>) => setForm((f) => ({ ...f, ...patch, unpaidSplit: patch.start || patch.end || patch.type ? undefined : f.unpaidSplit }));

  function submit() {
    const req = demo.submitLeave(worker.id, form, fixing?.id);
    setResultId(req.id);
    onFixed();
  }

  if (result) {
    return (
      <ResultPanel
        req={result as AnyRequest}
        onDone={() => {
          setResultId(null);
          setForm({ type: "vacation", start: "", end: "", halfDay: false, note: "" });
        }}
        onFix={() => {
          if (result.kind === "leave") setForm(result.data);
          setResultId(null);
        }}
      />
    );
  }

  return (
    <>
      <PageHeader title={fixing ? `Fix ${fixing.id}` : "Leave"} sub="You only see the leave types you're eligible for, with live balances. Problems are flagged before you submit." />

      <section className="mb-6">
        <Eyebrow className="mb-2">Your balances · {worker.country}</Eyebrow>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {balances.map((b) => (
            <button
              key={b.type}
              onClick={() => set({ type: b.type })}
              className={cx("rounded-xl border bg-surface px-3 py-2.5 text-left transition hover:border-worker", form.type === b.type ? "border-worker ring-1 ring-worker" : "border-line")}
            >
              <div className="text-xs font-semibold text-muted">{b.label}</div>
              <div className="font-display text-xl font-extrabold tabular">
                {b.available === null ? <span className="text-base">As needed</span> : `${b.available} day${b.available === 1 ? "" : "s"}`}
              </div>
              <div className="truncate text-[11px] text-faint">{b.pending ? `${b.pending} pending · ` : ""}{b.note}</div>
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Request leave</h2>
            <ActorChip actor="worker">You choose</ActorChip>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-xs font-semibold text-muted">
                Leave type <Required />
              </span>
              <select value={form.type} onChange={(e) => set({ type: e.target.value as LeaveType })} className={inputCls}>
                {balances.map((b) => (
                  <option key={b.type} value={b.type}>
                    {leaveLabel[b.type]} {b.available === null ? "" : `(${b.available} left)`}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-muted">
                From <Required />
              </span>
              <input type="date" value={form.start} onChange={(e) => set({ start: e.target.value, end: form.end && form.end >= e.target.value ? form.end : e.target.value })} className={inputCls} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-muted">
                To <Required />
              </span>
              <input type="date" value={form.end} min={form.start} onChange={(e) => set({ end: e.target.value })} className={inputCls} />
            </label>
            {form.start && form.start === form.end && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={form.halfDay} onChange={(e) => setForm({ ...form, halfDay: e.target.checked })} className="size-4 accent-worker" />
                Half day
              </label>
            )}
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-xs font-semibold text-muted">Note (optional)</span>
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={inputCls} placeholder="Anything your manager should know" />
            </label>
          </div>

          {docNeeded && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-sm">
              <span>{form.type === "sick" ? "A doctor's note is needed for this many days." : "This leave type needs a supporting document."}</span>
              <Button
                size="sm"
                onClick={() =>
                  setForm({
                    ...form,
                    document: {
                      name: form.type === "sick" ? "fit-note.pdf" : "supporting-document.pdf",
                      read: { name: { value: worker.name, confidence: 0.96 }, start: { value: form.start, confidence: 0.93 }, end: { value: form.end, confidence: 0.92 } },
                    },
                  })
                }
              >
                Attach demo document
              </Button>
            </div>
          )}
          {form.document && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-ai">
              <SparkIcon /> AI read {form.document.name}: {form.document.read.name.value}, {rangeLabel(form.document.read.start.value, form.document.read.end.value)}
            </p>
          )}

          {balanceShort > 0 && (
            <label className="mt-4 flex items-start gap-2 rounded-lg bg-worker-bg px-3 py-2.5 text-sm">
              <input type="checkbox" checked={!!form.unpaidSplit} onChange={(e) => setForm({ ...form, unpaidSplit: e.target.checked ? balanceShort : undefined })} className="mt-0.5 size-4 accent-worker" />
              <span>
                You&apos;re {balanceShort} day{balanceShort === 1 ? "" : "s"} short. Take {balanceShort} as unpaid and the rest as paid?
              </span>
            </label>
          )}
          {form.unpaidSplit ? (
            <p className="mt-2 text-sm text-worker">
              {days - form.unpaidSplit} paid, {form.unpaidSplit} unpaid.{" "}
              <button className="underline" onClick={() => setForm({ ...form, unpaidSplit: undefined })}>
                Undo
              </button>
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button variant="worker" disabled={!ready || blocking.length > 0} onClick={submit}>
              {fixing ? "Resubmit" : "Submit request"}
            </Button>
            {fails.length > blocking.length && blocking.length === 0 && <span className="text-sm text-hr">This will go to Pebl HR because a policy check fails.</span>}
          </div>

          <div className="mt-6 border-t border-line pt-4">
            <button onClick={() => setOpen(!open)} className="mb-2 font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted">
              Try a scenario {open ? "▾" : "▸"}
            </button>
            {open && (
              <div className="flex flex-wrap gap-2">
                {SCENARIOS.filter((s) => s.data.type !== "paternity" || balances.some((b) => b.type === "paternity")).map((s) => (
                  <button key={s.label} title={s.hint} onClick={() => setForm({ halfDay: false, note: "", ...s.data } as LeaveData)} className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold hover:border-worker">
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>

        <div className="grid content-start gap-4">
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <ActorChip actor="ai">AI pre-check</ActorChip>
              <span className="text-xs text-muted">before you submit</span>
            </div>
            {!preview ? (
              <p className="text-sm text-muted">Pick your dates and the balance, notice period, public holidays and overlaps are checked here as you go.</p>
            ) : (
              <ul className="grid gap-2">
                {preview.evaluation.checks
                  .filter((c) => ["dates", "holidays", "balance", "notice", "blackout", "max_consecutive", "document", "overlap", "expiry", "coverage"].includes(c.id))
                  .map((c) => (
                    <li key={c.id} className="grid grid-cols-[20px_1fr] gap-2 text-sm">
                      <CheckIcon status={c.status} />
                      <span>
                        <span className="font-semibold">{c.label}.</span> <span className="text-muted">{c.detail}</span>
                      </span>
                    </li>
                  ))}
              </ul>
            )}
            {tier && (
              <div className="mt-3 rounded-lg bg-sunken px-3 py-2 text-sm">
                <div className="flex items-center gap-2 font-semibold">
                  Who decides: <ActorChip actor={tierText[tier].actor}>{tierText[tier].label}</ActorChip>
                </div>
                <div className="mt-1 text-muted">{tierText[tier].sub}</div>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <Eyebrow className="mb-2">Team calendar · {worker.team}</Eyebrow>
            {team.length ? (
              <ul className="grid gap-1 text-sm">
                {team.map((r) => (
                  <li key={r.id}>
                    <span className="font-semibold">{getWorker(r.workerId).name.split(" ")[0]}</span> away {rangeLabel(r.data.start, r.data.end)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No one else on the team has leave booked.</p>
            )}
            <p className="mt-2 text-xs text-faint">Shows who&apos;s away, never why.</p>
          </Card>

          <Card className="p-4">
            <Eyebrow className="mb-2">Public holidays · approved automatically</Eyebrow>
            <ul className="grid gap-1 text-sm">
              {holidays.map((h) => (
                <li key={h.date} className="flex justify-between gap-2">
                  <span>{h.name}</span>
                  <span className="font-mono text-xs text-muted">{rangeLabel(h.date, h.date)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-faint">Never deducted from your balance. {client.name} observes the {worker.country} calendar.</p>
          </Card>
        </div>
      </div>

      <section className="mt-6">
        <Eyebrow className="mb-2">My leave</Eyebrow>
        <RequestTable rows={mine} onOpen={onOpen} empty="No leave requests yet." />
      </section>
    </>
  );
}

const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-worker";

