"use client";

import { useState } from "react";
import { addDays, dayName, isWeekend, rangeLabel, workedHours } from "@/lib/calendar";
import { CURRENT_WEEK, DEMO_TODAY, getWorker, timeRules } from "@/lib/data";
import { money } from "@/lib/format";
import { evaluateOvertime, evaluateTimesheet, monthLabel, overtimeBlockers, overtimeLimits, overtimeStatus, prefillWeek, sheetFor } from "@/lib/engine/time";
import { useDemo } from "@/lib/store";
import type { OvertimeData, TimesheetDay } from "@/lib/types";
import { RequestTable } from "../RequestTable";
import { ResultPanel } from "../ResultPanel";
import { CheckIcon, OvertimeMeter } from "../request-parts";
import { ActorChip, Button, Card, cx, Eyebrow, PageHeader, Required, StatusBadge } from "../ui";

function nextWorkingDay(iso: string) {
  let d = addDays(iso, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

const SHEET_SCENARIOS: { label: string; hint: string; edits: Record<number, Partial<TimesheetDay>> }[] = [
  { label: "As pre-filled", hint: "Matches the schedule and approved overtime: approved automatically", edits: {} },
  { label: "+3 hrs Friday", hint: "Overtime without pre-approval, within the limit: manager confirms", edits: { 4: { end: "20:30" } } },
  { label: "+4 hrs Mon–Wed", hint: "Takes the month over the company limit: HR incident", edits: { 0: { end: "21:30" }, 1: { end: "21:30" }, 2: { end: "21:30" } } },
  { label: "14-hour Wednesday", hint: "Long day and a missed rest period: HR incident", edits: { 2: { start: "08:00", end: "22:30" }, 3: { start: "07:00", end: "19:30" } } },
];

export function TimePage({ onOpen }: { onOpen(id: string): void }) {
  const demo = useDemo();
  const worker = getWorker(demo.actingWorkerId);
  const law = timeRules[worker.country];
  const L = overtimeLimits(worker, demo.policy);
  const st = overtimeStatus(worker, demo.requests, demo.policy);
  const sheet = sheetFor(worker.id, demo.requests);
  const mine = demo.requests.filter((r) => (r.kind === "overtime" || r.kind === "timesheet") && r.workerId === worker.id);

  const [ot, setOt] = useState<OvertimeData>({ date: nextWorkingDay(DEMO_TODAY), hours: 2, reason: "" });
  const [days, setDays] = useState<TimesheetDay[]>(() => prefillWeek(worker, demo.requests));
  const [note, setNote] = useState("");
  const [resultId, setResultId] = useState<string | null>(null);
  const result = resultId ? demo.requests.find((r) => r.id === resultId) : undefined;

  const otPreview = evaluateOvertime(ot, worker, demo.policy, demo.requests);
  const blockers = overtimeBlockers(otPreview.evaluation);
  const sheetPreview = evaluateTimesheet({ weekStart: CURRENT_WEEK, days, note }, worker, demo.policy, demo.requests);

  if (result) return <ResultPanel req={result} onDone={() => setResultId(null)} onFix={() => setResultId(null)} />;

  const exempt = worker.classification === "salaried_exempt";
  const editDay = (date: string, patch: Partial<TimesheetDay>) => setDays((ds) => ds.map((d) => (d.date === date ? { ...d, ...patch } : d)));
  const base = prefillWeek(worker, demo.requests);

  return (
    <>
      <PageHeader title="Time" sub="Limits apply before overtime is worked, not after. Every hour you work is recorded and paid." />

      {!law.covered && <p className="mb-5 rounded-xl bg-hr-bg px-4 py-3 text-sm text-hr">{law.coverageNote} Your timesheets and overtime requests go to Pebl HR.</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">Overtime in {monthLabel()}</h2>
            <span className="text-xs text-muted">{L.legalCap !== null ? `Company limit ${L.client.monthlyLimit} · legal cap ${L.legalCap}` : `Company limit ${L.client.monthlyLimit}`}</span>
          </div>
          {exempt ? (
            <p className="mt-3 text-sm text-muted">Pebl HR has classified you as salaried, exempt. Overtime pay doesn&apos;t apply, but your hours are still recorded for rest and working-time rules.</p>
          ) : !st.switchedOn ? (
            <p className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">Overtime is switched off: {L.prerequisiteMissing ? `no ${law.prerequisite} on file.` : "Lumen doesn't allow overtime here."}</p>
          ) : (
            <>
              <p className="mt-3 font-display text-xl font-extrabold">
                You can work up to {st.remaining} more overtime hour{st.remaining === 1 ? "" : "s"} this month.
              </p>
              <div className="mt-3">
                <OvertimeMeter used={st.committed} adding={st.pending} limit={st.limit} legalCap={L.legalCap} forecast={st.forecast} />
              </div>
              <ul className="mt-3 grid gap-1.5">
                {st.alerts.map((a, i) => (
                  <li key={i} className={cx("rounded-lg px-3 py-2 text-sm", a.level === "forecast" ? "bg-hr-bg text-hr" : a.level === "manager" ? "bg-danger-bg text-danger" : "bg-rules-bg text-rules")}>
                    {a.level === "forecast" ? "AI forecast: " : a.level === "manager" ? "90% alert: " : "80% heads-up: "}
                    {a.text}
                  </li>
                ))}
                {!st.alerts.length && <li className="text-sm text-muted">On track. Alerts start at 80% of your limit.</li>}
              </ul>
            </>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Request overtime</h2>
            <ActorChip actor="rules">Checked before you send</ActorChip>
          </div>
          <div className="grid grid-cols-[1fr_90px] gap-3">
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-muted">
                Date <Required />
              </span>
              <input type="date" min={addDays(DEMO_TODAY, 1)} value={ot.date} onChange={(e) => setOt({ ...ot, date: e.target.value })} className={inputCls} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-semibold text-muted">
                Hours <Required />
              </span>
              <input type="number" min={0.5} max={12} step={0.5} value={ot.hours} onChange={(e) => setOt({ ...ot, hours: Number(e.target.value) || 0 })} className={cx(inputCls, "tabular")} />
            </label>
            <label className="col-span-2 grid gap-1">
              <span className="text-xs font-semibold text-muted">Reason</span>
              <input value={ot.reason} onChange={(e) => setOt({ ...ot, reason: e.target.value })} placeholder="e.g. Release cut-over" className={inputCls} />
            </label>
          </div>
          <ul className="mt-3 grid gap-1.5">
            {otPreview.evaluation.checks
              .filter((c) => c.status !== "pass" || ["limit", "rest", "daily_max"].includes(c.id))
              .map((c) => (
                <li key={c.id} className="grid grid-cols-[20px_1fr] gap-2 text-sm">
                  <CheckIcon status={c.status} />
                  <span className="text-muted">
                    <span className="font-semibold text-ink">{c.label}.</span> {c.detail}
                  </span>
                </li>
              ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="worker"
              disabled={blockers.length > 0 || ot.hours <= 0 || exempt}
              onClick={() => {
                const req = demo.submitOvertime(worker.id, ot);
                setResultId(req.id);
              }}
            >
              Request {ot.hours} hour{ot.hours === 1 ? "" : "s"}
            </Button>
            {blockers.some((b) => b.id === "limit") && st.remaining > 0 && (
              <Button size="sm" onClick={() => setOt({ ...ot, hours: st.remaining })}>
                Request {st.remaining} instead
              </Button>
            )}
            {!blockers.length && <span className="text-xs text-muted">Cost {money(otPreview.insight.cost, worker.currency)} at a {otPreview.insight.premiumPct}% premium</span>}
          </div>
          {blockers.length > 0 && <p className="mt-2 text-xs text-muted">This can&apos;t be requested as it stands, so it never becomes something a manager could approve by mistake.</p>}
        </Card>
      </div>

      <Card className="mt-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">Timesheet · week of {rangeLabel(CURRENT_WEEK, CURRENT_WEEK)}</h2>
            <p className="text-sm text-muted">Pre-filled from your schedule plus approved overtime and leave. Confirm it, or edit any day you worked differently.</p>
          </div>
          <ActorChip actor="ai">Pre-filled</ActorChip>
        </div>

        {sheet ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sunken px-4 py-3">
            <span className="text-sm">
              Submitted {sheet.id}: <b>{sheet.insight.totalHours} hours</b>
              {sheet.insight.overtimeHours ? `, ${sheet.insight.overtimeHours} overtime` : ""}
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge status={sheet.status} />
              <Button size="sm" onClick={() => onOpen(sheet.id)}>
                View
              </Button>
            </span>
          </div>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-muted">
                    <th className="py-1.5 pr-3 font-medium">Day</th>
                    <th className="py-1.5 pr-3 font-medium">Start</th>
                    <th className="py-1.5 pr-3 font-medium">End</th>
                    <th className="py-1.5 pr-3 font-medium">Break (min)</th>
                    <th className="py-1.5 text-right font-medium">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d, i) => {
                    const h = d.off ? 0 : workedHours(d.start, d.end, d.breakMin);
                    const changed = JSON.stringify(d) !== JSON.stringify(base[i]);
                    return (
                      <tr key={d.date} className={cx("border-t border-line-soft", changed && "bg-worker-bg/50")}>
                        <td className="py-1.5 pr-3 font-semibold">
                          {dayName(d.date)} {rangeLabel(d.date, d.date)}
                        </td>
                        {d.off ? (
                          <td colSpan={3} className="py-1.5 pr-3 text-muted">
                            {d.off}
                          </td>
                        ) : (
                          <>
                            <td className="py-1 pr-3">
                              <input type="time" value={d.start} onChange={(e) => editDay(d.date, { start: e.target.value })} className={timeCls} aria-label={`${dayName(d.date)} start`} />
                            </td>
                            <td className="py-1 pr-3">
                              <input type="time" value={d.end} onChange={(e) => editDay(d.date, { end: e.target.value })} className={timeCls} aria-label={`${dayName(d.date)} end`} />
                            </td>
                            <td className="py-1 pr-3">
                              <input
                                type="number"
                                min={0}
                                step={5}
                                value={d.breakMin}
                                onChange={(e) => editDay(d.date, { breakMin: Number(e.target.value) || 0 })}
                                className={cx(timeCls, "w-20")}
                                aria-label={`${dayName(d.date)} break`}
                              />
                            </td>
                          </>
                        )}
                        <td className={cx("py-1.5 text-right font-mono tabular", h >= 13 && "font-bold text-danger", h > 8 && h < 13 && "text-hr")}>{h ? h.toFixed(1) : "–"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <Eyebrow className="mb-2">AI flags</Eyebrow>
                <ul className="grid gap-1.5">
                  {sheetPreview.evaluation.checks
                    .filter((c) => c.status !== "pass" || c.id === "limit")
                    .map((c) => (
                      <li key={c.id} className="grid grid-cols-[20px_1fr] gap-2 text-sm">
                        <CheckIcon status={c.status} />
                        <span className="text-muted">
                          <span className="font-semibold text-ink">{c.label}.</span> {c.detail}
                        </span>
                      </li>
                    ))}
                  {sheetPreview.insight.longDays.map((d) => (
                    <li key={d} className="grid grid-cols-[20px_1fr] gap-2 text-sm">
                      <CheckIcon status="borderline" />
                      <span className="text-muted">
                        <span className="font-semibold text-ink">Unusual day.</span> {d}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid content-start gap-3">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-muted">Note (optional)</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="e.g. Stayed late for the release on Friday" />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="worker"
                    onClick={() => {
                      const req = demo.submitTimesheet(worker.id, { weekStart: CURRENT_WEEK, days, note });
                      setResultId(req.id);
                    }}
                  >
                    Confirm {sheetPreview.insight.totalHours} hours
                  </Button>
                  <Button variant="ghost" onClick={() => setDays(base)}>
                    Reset to pre-filled
                  </Button>
                </div>
                {worker.id === "w-muhammad" && (
                  <div>
                    <Eyebrow className="mb-1.5">Try a scenario</Eyebrow>
                    <div className="flex flex-wrap gap-2">
                      {SHEET_SCENARIOS.map((s) => (
                        <button key={s.label} title={s.hint} onClick={() => setDays(base.map((d, i) => ({ ...d, ...(s.edits[i] ?? {}) })))} className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold hover:border-worker">
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </Card>

      <section className="mt-6">
        <Eyebrow className="mb-2">My time requests</Eyebrow>
        <RequestTable rows={mine} onOpen={onOpen} empty="No overtime requests or timesheets yet." />
      </section>
    </>
  );
}

const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-worker";
const timeCls = "rounded-md border border-line bg-surface px-2 py-1 font-mono text-sm tabular outline-none focus:border-worker";
