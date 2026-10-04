"use client";

import { useState } from "react";
import { countryRules, getWorker, unlockConfig, workers } from "@/lib/data";
import { kindLabel, titleOf, valueOf } from "@/lib/describe";
import { money } from "@/lib/format";
import { overtimeStatus } from "@/lib/engine/time";
import { useDemo } from "@/lib/store";
import type { AnyRequest, Classification, Combination } from "@/lib/types";
import { AppShell } from "../AppShell";
import { RequestDetail } from "../RequestDetail";
import { RequestTable } from "../RequestTable";
import { Button, Card, cx, Empty, Eyebrow, PageHeader, SparkIcon } from "../ui";

export function HrView() {
  const demo = useDemo();
  const [open, setOpen] = useState<string | null>(null);
  const queue = demo.requests.filter((r) => r.status === "hr_review");
  const waiting = demo.requests.filter((r) => r.status === "info_requested");
  const decided = demo.requests.filter((r) => r.hrDecision && r.status !== "hr_review");
  const audit = demo.requests.filter((r) => r.auditSampled);
  const auditOpen = audit.filter((r) => !r.auditResult);
  const noTouch = demo.requests.filter((r) => r.routing.outcome !== "hr_exception" && r.routing.outcome !== "back_to_worker");
  const forecastAlerts = workers
    .map((w) => ({ w, st: overtimeStatus(w, demo.requests, demo.policy) }))
    .filter(({ st }) => st.eligible && st.switchedOn && st.alerts.some((a) => a.level === "forecast"));
  const section = demo.section.hr;
  const openReq = open ? demo.requests.find((r) => r.id === open) ?? null : null;
  const [tab, setTab] = useState<QueueTab>("all");
  const shown = queue.filter((r) => inTab(r, tab));
  const showAlerts = (tab === "all" || tab === "time") && forecastAlerts.length > 0;

  return (
    <AppShell
      nav={[
        { id: "queue", label: "Exception queue", count: queue.length || undefined },
        { id: "audit", label: "5% audit", count: auditOpen.length || undefined },
        { id: "decided", label: "Decided" },
        { id: "trust", label: "Trust dashboard" },
        { id: "workers", label: "Workers" },
        { id: "all", label: "All requests" },
      ]}
    >
      {section === "queue" && (
        <>
          <PageHeader title="Exception queue" sub="Only what needs a person, across expenses, leave and time. Each item arrives with the flag reason, the rule results and a suggested action." />
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Tile label="Waiting on you" value={queue.length} />
            <Tile label="Handled with no HR touch" value={noTouch.length} hint="Auto-cleared, auto-approved or decided by the client's manager" />
            <Tile label="Waiting on the worker" value={waiting.length} />
          </div>

          <div role="tablist" aria-label="Request type" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
            {QUEUE_TABS.map((t) => {
              const n = queue.filter((r) => inTab(r, t.id)).length;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cx(
                    "flex shrink-0 items-center gap-2 border-b-[3px] px-3 py-2 font-display text-sm font-bold",
                    tab === t.id ? "border-hr text-ink" : "border-transparent text-muted hover:text-ink",
                  )}
                >
                  {t.label}
                  <span className={cx("rounded-full px-1.5 text-[11px] tabular", tab === t.id ? "bg-hr text-white" : "bg-sunken text-muted")}>{n}</span>
                </button>
              );
            })}
          </div>

          {showAlerts && (
            <section className="mb-5">
              <Eyebrow className="mb-2">Forecast breach alerts · step in before the limit is crossed</Eyebrow>
              <div className="grid gap-2">
                {forecastAlerts.map(({ w, st }) => (
                  <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hr/40 bg-hr-bg px-4 py-3 text-sm">
                    <span>
                      <span className="font-semibold">{w.name}</span> ({w.country}) · {st.committed} of {st.limit} overtime hours used; AI forecasts <b>{st.forecast}</b> by month-end.
                    </span>
                    <span className="text-xs text-hr">Suggested: agree a plan with the manager now.</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {shown.length === 0 ? (
            <Empty title={tab === "all" ? "Queue is clear" : `No ${QUEUE_TABS.find((t) => t.id === tab)!.label.toLowerCase()} exceptions`}>{QUEUE_TABS.find((t) => t.id === tab)!.empty}</Empty>
          ) : (
            <div className="grid gap-3">
              {shown.map((r) => (
                <QueueItem key={r.id} req={r} history={demo.requests.filter((x) => x.workerId === r.workerId && x.id !== r.id)} onOpen={() => setOpen(r.id)} />
              ))}
            </div>
          )}
        </>
      )}

      {section === "audit" && (
        <>
          <PageHeader title="5% audit" sub={`A random ${unlockConfig.auditSamplePct}% of requests that never reached HR are sampled for review, to catch drift. Target: zero issues.`} />
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Tile label="Sampled" value={audit.length} />
            <Tile label="To review" value={auditOpen.length} />
            <Tile label="Issues found" value={audit.filter((r) => r.auditResult === "issue").length} />
          </div>
          <RequestTable rows={audit} onOpen={setOpen} showWorker empty="Nothing sampled yet." />
        </>
      )}

      {section === "decided" && (
        <>
          <PageHeader title="Decided by HR" sub="Every decision is logged against the system's recommendation. In shadow mode, that's the evidence for unlocking a combination." />
          <RequestTable rows={decided} onOpen={setOpen} showWorker empty="No HR decisions yet in this session." />
        </>
      )}

      {section === "trust" && <TrustDashboard />}
      {section === "workers" && <WorkersPage />}

      {section === "all" && (
        <>
          <PageHeader title="All requests" sub="Including the ones Pebl HR never had to touch." />
          <RequestTable rows={demo.requests} onOpen={setOpen} showWorker />
        </>
      )}
      <RequestDetail req={openReq} role="hr" onClose={() => setOpen(null)} />
    </AppShell>
  );
}

type QueueTab = "all" | "expense" | "time" | "leave";

const QUEUE_TABS: { id: QueueTab; label: string; empty: string }[] = [
  { id: "all", label: "All", empty: "Flagged requests land here. Try the team dinner, paternity leave, or a 14-hour day on the timesheet as the employee." },
  { id: "expense", label: "Expense", empty: "Try the team dinner or the shared dinner as the employee." },
  { id: "time", label: "Time", empty: "Overtime requests in shadow mode and timesheet incidents land here. Try a 14-hour Wednesday on the timesheet." },
  { id: "leave", label: "Leave", empty: "Statutory leave and risky declines land here. Try paternity leave as the employee." },
];

/** Overtime requests and timesheets both belong to the Time module. */
function inTab(r: AnyRequest, tab: QueueTab) {
  if (tab === "all") return true;
  if (tab === "time") return r.kind === "overtime" || r.kind === "timesheet";
  return r.kind === tab;
}

function QueueItem({ req, history, onOpen }: { req: AnyRequest; history: AnyRequest[]; onOpen(): void }) {
  const w = getWorker(req.workerId);
  const e = req.explanations.hr;
  const flags = req.routing.signals.filter((s) => s.id !== "not_unlocked");
  const approved = history.filter((h) => h.status === "approved").length;

  return (
    <button onClick={onOpen} className="w-full text-left">
      <Card className="grid gap-3 p-4 transition hover:border-hr hover:shadow-md sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-sunken px-1.5 py-px font-mono text-[11px] text-muted">{kindLabel[req.kind]}</span>
            <span className="font-display font-bold">{w.name}</span>
            <span className="text-sm text-muted">
              {titleOf(req)} · {w.country}
            </span>
            {req.routing.shadowWould && (
              <span className="rounded bg-rules-bg px-1.5 py-px font-mono text-[11px] text-rules">
                SHADOW · would {req.routing.shadowWould === "auto_clear" ? "auto-approve" : req.routing.shadowWould === "manager" ? "send to manager" : "flag"}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {flags.map((s, i) => (
              <span key={i} className="rounded-md bg-hr-bg px-2 py-0.5 text-xs font-semibold text-hr">
                {s.label}
              </span>
            ))}
          </div>
          {e && (
            <p className={cx("mt-2 flex gap-1.5 text-sm", e.pending && "shimmer rounded")}>
              <SparkIcon className="mt-0.5 shrink-0 text-ai" />
              <span>
                {e.text}
                {e.suggestedAction && <span className="text-hr"> Suggested: {e.suggestedAction}</span>}
              </span>
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-start">
          <span className="font-display text-xl font-extrabold tabular">{valueOf(req)}</span>
          <span className="text-xs text-muted">Worker history: {approved} approved</span>
        </div>
      </Card>
    </button>
  );
}

function Tile({ label, value, hint, suffix }: { label: string; value: number | string; hint?: string; suffix?: string }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-xs font-semibold text-muted" title={hint}>
        {label}
      </div>
      <div className="font-display text-2xl font-extrabold tabular">
        {value}
        {suffix && <span className="text-base text-muted">{suffix}</span>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Trust dashboard: shadow mode, unlock by evidence, reset on rule change
// ---------------------------------------------------------------------------

const pct = (c: Combination) => (c.shadowCases ? (c.agreements / c.shadowCases) * 100 : 0);
const canUnlock = (c: Combination) => c.status === "shadow" && c.shadowCases >= unlockConfig.minCases && pct(c) >= unlockConfig.thresholdPct && c.misses === 0;

function TrustDashboard() {
  const demo = useDemo();
  const all = demo.requests;
  const touched = all.filter((r) => r.routing.outcome === "hr_exception" || r.hrDecision).length;
  const unlockedReqs = all.filter((r) => r.routing.unlocked);
  const autoRate = unlockedReqs.length ? Math.round((unlockedReqs.filter((r) => r.routing.outcome !== "hr_exception").length / unlockedReqs.length) * 100) : 0;
  const totals = demo.combinations.reduce((s, c) => ({ cases: s.cases + c.shadowCases, agree: s.agree + c.agreements }), { cases: 0, agree: 0 });
  const issues = all.filter((r) => r.auditResult === "issue").length;
  const groups = (["expense", "leave", "time"] as const).map((m) => ({ m, rows: demo.combinations.filter((c) => c.key.split(":")[1] === m) }));

  return (
    <>
      <PageHeader title="Trust dashboard" sub="Auto-approval is earned one country and request type at a time. Compliance owns these switches; the system only applies them." />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="HR touches per 100 requests" value={Math.round((touched / Math.max(all.length, 1)) * 100)} hint="Requests a Pebl HR specialist opened, per 100 submitted" />
        <Tile label="Auto-clear rate, unlocked" value={autoRate} suffix="%" hint="Share of requests in unlocked combinations handled without HR" />
        <Tile label="Agreement with HR (shadow)" value={((totals.agree / Math.max(totals.cases, 1)) * 100).toFixed(1)} suffix="%" hint="Target 99.5%+ before any unlock" />
        <Tile label="Issues in the 5% audit" value={issues} hint="Target 0" />
      </div>

      <ol className="mb-6 grid gap-2 text-sm sm:grid-cols-4">
        {[
          ["Shadow mode", "Every request still goes to HR; the system records what it would have decided."],
          ["Unlock by evidence", `${unlockConfig.thresholdPct}%+ agreement over ${unlockConfig.minCases}+ cases and zero misses.`],
          ["Ongoing audit", `HR reviews a random ${unlockConfig.auditSamplePct}% of what skips them.`],
          ["Reset on change", "A rule change sends that combination back to shadow mode."],
        ].map(([t, d], i) => (
          <li key={t} className="rounded-lg border border-line bg-surface px-3 py-2.5">
            <div className="font-display font-bold">
              {i + 1}. {t}
            </div>
            <div className="text-muted">{d}</div>
          </li>
        ))}
      </ol>

      <div className="grid gap-5">
        {groups.map(({ m, rows }) => (
          <Card key={m} className="overflow-x-auto p-4">
            <Eyebrow className="mb-2">{m === "expense" ? "Expenses" : m === "leave" ? "Leave" : "Time"}</Eyebrow>
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-muted">
                  <th className="py-1.5 pr-3 font-medium">Combination</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Cases</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Agreement</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Misses</th>
                  <th className="py-1.5 text-right font-medium">Compliance action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.key} className="border-t border-line-soft">
                    <td className="py-2 pr-3 font-mono text-xs">{c.key}</td>
                    <td className="py-2 pr-3">
                      <span className={cx("rounded-md px-2 py-0.5 text-xs font-semibold", c.status === "unlocked" ? "bg-admin-bg text-admin" : canUnlock(c) ? "bg-ai-bg text-ai" : "bg-rules-bg text-rules")}>
                        {c.status === "unlocked" ? `Unlocked ${c.unlockedOn ?? ""}` : canUnlock(c) ? "Ready to unlock" : "Shadow mode"}
                      </span>
                      {c.resetReason && <div className="mt-0.5 text-xs text-muted">{c.resetReason}</div>}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular">{c.shadowCases}</td>
                    <td className={cx("py-2 pr-3 text-right font-mono tabular", pct(c) >= unlockConfig.thresholdPct ? "text-admin" : "text-muted")}>{c.shadowCases ? `${pct(c).toFixed(1)}%` : "–"}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular">{c.misses}</td>
                    <td className="py-2 text-right">
                      {c.status === "unlocked" ? (
                        <Button size="sm" variant="ghost" onClick={() => demo.resetCombination(c.key, "Reset: country rule changed (new version effective today)")}>
                          Simulate rule change
                        </Button>
                      ) : canUnlock(c) ? (
                        <Button size="sm" variant="primary" onClick={() => demo.unlockCombination(c.key)}>
                          Unlock
                        </Button>
                      ) : (
                        <span className="text-xs text-faint">{c.shadowCases < unlockConfig.minCases ? `${unlockConfig.minCases - c.shadowCases} more cases` : "Below threshold"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
        <EffectiveDates />
      </div>
    </>
  );
}

/** Rules carry effective dates: the same trip is checked against the rate in force on its date. */
function EffectiveDates() {
  const [date, setDate] = useState("2026-03-20");
  const versions = countryRules.UK.expenses.mileage;
  const applied = versions.find((v) => date >= v.effectiveFrom && (!v.effectiveTo || date <= v.effectiveTo));
  return (
    <Card className="p-4">
      <Eyebrow className="mb-2">Rules have effective dates · UK mileage</Eyebrow>
      <table className="w-full text-sm">
        <tbody>
          {versions.map((v) => (
            <tr key={v.version} className={cx("border-t border-line-soft", applied?.version === v.version && "bg-admin-bg")}>
              <td className="py-1.5 pr-3 font-mono text-xs">
                {v.id} v{v.version}
              </td>
              <td className="py-1.5 pr-3">
                {v.effectiveFrom} → {v.effectiveTo ?? "now"}
              </td>
              <td className="py-1.5 text-right font-mono tabular">{money(v.ratePerUnit, "GBP")} / mile</td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        A trip on
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-sm" />
        is checked against <b>{applied ? `v${applied.version} (${money(applied.ratePerUnit, "GBP")} a mile)` : "no rule in force"}</b>.
      </label>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Workers: classification is set by people, not AI (TM-3)
// ---------------------------------------------------------------------------

const classLabel: Record<Classification, string> = {
  salaried_overtime_eligible: "Salaried, overtime-eligible",
  salaried_exempt: "Salaried, exempt",
  hourly: "Hourly",
  unclear: "Not confirmed",
};

function WorkersPage() {
  const demo = useDemo();
  return (
    <>
      <PageHeader title="Workers" sub="Pebl HR sets each worker's classification at onboarding. It decides which time checks run, so it's set by a person, not AI." />
      <Card className="overflow-x-auto p-4">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-3 font-medium">Worker</th>
              <th className="py-1.5 pr-3 font-medium">Country</th>
              <th className="py-1.5 pr-3 font-medium">Classification</th>
              <th className="py-1.5 font-medium">What it means</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id} className="border-t border-line-soft">
                <td className="py-2 pr-3">
                  <div className="font-semibold">{w.name}</div>
                  <div className="text-xs text-muted">{w.title}</div>
                </td>
                <td className="py-2 pr-3">{w.country}</td>
                <td className="py-2 pr-3">
                  <select value={w.classification} onChange={(e) => demo.setClassification(w.id, e.target.value as Classification)} className="rounded-md border border-line px-2 py-1 text-sm">
                    {(Object.keys(classLabel) as Classification[]).map((c) => (
                      <option key={c} value={c}>
                        {classLabel[c]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-muted">
                  {w.classification === "salaried_exempt"
                    ? "No overtime pay; lighter tracking. Hours and rest limits often still apply."
                    : w.classification === "hourly"
                      ? "Every hour logged; overtime paid."
                      : w.classification === "unclear"
                        ? "Timesheets go to HR until confirmed."
                        : "Pre-filled schedule confirmed weekly; overtime paid at the country's premium."}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-faint">Contractors are out of scope: they aren&apos;t EOR employees, and tracking their hours would risk misclassifying them.</p>
      </Card>
    </>
  );
}
