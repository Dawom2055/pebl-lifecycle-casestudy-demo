"use client";

import { dayName, rangeLabel, workedHours } from "@/lib/calendar";
import { getSampleReceipt, getWorker, timeRules } from "@/lib/data";
import { money } from "@/lib/format";
import type { AnyRequest, CheckStatus, Explanation, RuleCheck, TimesheetRequest } from "@/lib/types";
import { ActorChip, cx, Eyebrow, SparkIcon } from "./ui";

// ---------------------------------------------------------------------------
// Pipeline trace: the four shared stages and where this request went.
// ---------------------------------------------------------------------------

const intakeText = (req: AnyRequest) => {
  switch (req.kind) {
    case "expense":
      return req.data.aiRead ? (req.data.aiRead.source === "claude" ? "Claude read the receipt; worker confirmed" : "AI read the receipt; worker confirmed") : "Entered by the worker";
    case "leave":
      return "Picked from eligible types; AI pre-checked the dates";
    case "overtime":
      return "Checked against hours left before submitting";
    case "timesheet":
      return "Pre-filled from the schedule; worker confirmed";
  }
};

function outcomeOf(req: AnyRequest) {
  const r = req.routing;
  if (r.outcome === "back_to_worker") return { title: "Back to worker", sub: "A fixable problem", tone: "worker" as const };
  if (r.outcome === "hr_exception") {
    const title = req.kind === "timesheet" && !r.shadowWould ? "HR incident" : "Pebl HR";
    return { title, sub: r.shadowWould ? "Shadow mode" : `${r.signals.length} signal${r.signals.length === 1 ? "" : "s"}`, tone: "hr" as const };
  }
  if (r.outcome === "manager") return { title: req.kind === "timesheet" ? "Manager confirms" : "Manager decides", sub: "Decision card with an AI suggestion", tone: "admin" as const };
  if (req.kind === "expense") return { title: r.clientAutoApproved ? "Auto-approved" : "Auto-cleared", sub: r.clientAutoApproved ? "Under the client's opt-in limit" : "To the client admin's card", tone: "admin" as const };
  return { title: "Approved automatically", sub: req.kind === "leave" ? "Protected leave; manager notified" : "Within limits; manager notified", tone: "admin" as const };
}

export function PipelineTrace({ req }: { req: AnyRequest }) {
  const { evaluation, routing } = req;
  const fails = evaluation.checks.filter((c) => c.status === "fail").length;
  const borderline = evaluation.checks.filter((c) => c.status === "borderline").length;
  const passed = evaluation.checks.filter((c) => c.status === "pass").length;
  const outcome = outcomeOf(req);

  const stages = [
    { n: 1, title: "Intake", sub: intakeText(req) },
    { n: 2, title: "Rules engine", sub: `${passed} pass${borderline ? ` · ${borderline} borderline` : ""}${fails ? ` · ${fails} fail` : ""}` },
    { n: 3, title: "Risk router", sub: routing.signals.length ? `${routing.signals.length} signal${routing.signals.length === 1 ? "" : "s"} raised` : "No signals" },
  ];
  const toneCls = { admin: "border-admin bg-admin-bg", worker: "border-worker bg-worker-bg", hr: "border-hr bg-hr-bg" }[outcome.tone];

  return (
    <div className="grid gap-2 sm:grid-cols-4">
      {stages.map((s) => (
        <div key={s.n} className="rounded-lg border border-line bg-surface px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Num n={s.n} />
            <span className="text-sm font-bold">{s.title}</span>
          </div>
          <div className="mt-1 text-xs text-muted">{s.sub}</div>
        </div>
      ))}
      <div className={cx("rounded-lg border-2 px-3 py-2.5", toneCls)}>
        <div className="flex items-center gap-2">
          <Num n={4} />
          <span className="text-sm font-bold">{outcome.title}</span>
        </div>
        <div className="mt-1 text-xs text-muted">{outcome.sub}</div>
      </div>
    </div>
  );
}

function Num({ n }: { n: number }) {
  return <span className="grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] border-ink font-display text-[11px] font-extrabold">{n}</span>;
}

// ---------------------------------------------------------------------------
// Rule checks, grouped by layer, with the rule id and version each one used.
// ---------------------------------------------------------------------------

const statusIcon: Record<CheckStatus, { glyph: string; cls: string; label: string }> = {
  pass: { glyph: "✓", cls: "bg-admin-bg text-admin", label: "Pass" },
  borderline: { glyph: "!", cls: "bg-hr-bg text-hr", label: "Borderline" },
  fail: { glyph: "✕", cls: "bg-danger-bg text-danger", label: "Fail" },
  info: { glyph: "i", cls: "bg-rules-bg text-rules", label: "Info" },
};

const layerLabel = { country: "Country rules", client: "Client policy", system: "System checks" } as const;

export function CheckIcon({ status }: { status: CheckStatus }) {
  const s = statusIcon[status];
  return (
    <span aria-label={s.label} className={cx("mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full text-[11px] font-bold", s.cls)}>
      {s.glyph}
    </span>
  );
}

export function ChecksList({ checks, compact }: { checks: RuleCheck[]; compact?: boolean }) {
  const groups = (["country", "client", "system"] as const).map((layer) => ({ layer, items: checks.filter((c) => c.layer === layer) })).filter((g) => g.items.length);
  return (
    <div className={cx("grid gap-4", !compact && "sm:grid-cols-2")}>
      {groups.map((g) => (
        <div key={g.layer} className={cx(g.layer === "system" && !compact && "sm:col-span-2")}>
          <Eyebrow className="mb-2">{layerLabel[g.layer]}</Eyebrow>
          <ul className="grid gap-2">
            {g.items.map((c) => (
              <li key={c.id} className="grid grid-cols-[20px_1fr] gap-2 text-sm">
                <CheckIcon status={c.status} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold">{c.label}</span>
                    {c.ruleId && (
                      <span className="font-mono text-[11px] text-faint">
                        {c.ruleId} v{c.ruleVersion}
                      </span>
                    )}
                  </div>
                  <div className="text-muted">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The AI-written explanation for one reader.
// ---------------------------------------------------------------------------

export function ExplanationCard({ explanation, label, tone = "ai" }: { explanation?: Explanation; label: string; tone?: "ai" | "hr" | "worker" }) {
  if (!explanation) return null;
  const bg = { ai: "bg-ai-bg", hr: "bg-hr-bg", worker: "bg-worker-bg" }[tone];
  return (
    <div className={cx("rounded-xl px-4 py-3", bg)}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.06em] text-ai">
          <SparkIcon /> {label}
        </span>
        <AiSource e={explanation} />
      </div>
      {explanation.headline && <p className="font-display text-[15px] font-bold text-ai">Suggestion: {explanation.headline}</p>}
      <p className={cx("text-[15px] leading-relaxed", explanation.pending && "shimmer rounded")}>{explanation.text}</p>
      {explanation.suggestedAction && (
        <p className="mt-2 text-sm">
          <span className="font-semibold text-hr">Suggested action: </span>
          {explanation.suggestedAction}
        </p>
      )}
    </div>
  );
}

export function AiSource({ e }: { e: Explanation }) {
  return <span className="text-[11px] text-muted">{e.pending ? "Claude is writing…" : e.source === "ai" ? "Written by Claude" : "Template (Claude not connected)"}</span>;
}

// ---------------------------------------------------------------------------
// Receipt preview: a rendered demo receipt, an uploaded photo, or a placeholder.
// ---------------------------------------------------------------------------

export function ReceiptView({ req, sampleId, imageUrl, className }: { req?: AnyRequest; sampleId?: string; imageUrl?: string; className?: string }) {
  const expense = req?.kind === "expense" ? req : undefined;
  const id = sampleId ?? expense?.data.receipt.sampleId;
  const img = imageUrl ?? expense?.data.receipt.imageUrl;
  const sample = id ? getSampleReceipt(id) : undefined;

  if (img) {
    // eslint-disable-next-line @next/next/no-img-element -- local data URL from the worker's upload
    return <img src={img} alt="Uploaded receipt" className={cx("w-full rounded-lg border border-line bg-white object-contain", className)} />;
  }

  if (sample) {
    const r = sample.receipt;
    return (
      <div className={cx("receipt-paper mx-auto w-full max-w-[300px] rounded-sm border-y-[6px] border-dashed border-transparent px-5 py-5 text-[12px] leading-relaxed text-ink", r.cropped && "receipt-cropped", className)}>
        <div className="text-center">
          <div className="text-[14px] font-bold uppercase">{r.merchant}</div>
          <div className="text-faint">{r.address}</div>
          <div className="mt-1 text-faint">
            {r.date} · {r.time}
          </div>
        </div>
        <div className="my-3 border-t border-dashed border-line" />
        {r.lines.map((l, i) => (
          <div key={i} className="flex justify-between gap-3">
            <span>{l.desc}</span>
            <span className="tabular">{money(l.amount, r.currency)}</span>
          </div>
        ))}
        <div className="my-3 border-t border-dashed border-line" />
        <div className="flex justify-between text-[13px] font-bold">
          <span>TOTAL</span>
          <span className="tabular">{money(r.total, r.currency)}</span>
        </div>
        <div className="mt-1 flex justify-between text-faint">
          <span>Covers</span>
          <span>{r.covers}</span>
        </div>
        <div className="mt-3 text-center text-faint">{r.taxId ? `VAT/TAX REG ${r.taxId}` : "THANK YOU FOR VISITING"}</div>
      </div>
    );
  }

  return (
    <div className={cx("grid min-h-40 place-items-center rounded-lg border border-dashed border-line bg-sunken p-6 text-center text-sm text-muted", className)}>
      {expense?.data.receipt.kind === "attached" ? "Receipt on file" : "No receipt attached"}
    </div>
  );
}

/** Spending flags the client admin decides on, shown as a disclaimer once the request is with them. */
export function AdvisoryNote({ req, className }: { req: AnyRequest; className?: string }) {
  const advisories = req.routing.advisories ?? [];
  if (!advisories.length || req.status === "hr_review") return null;
  return (
    <div className={cx("rounded-lg border border-hr/40 bg-hr-bg px-3 py-2.5 text-sm", className)}>
      <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-hr">Disclaimer · for your decision</div>
      <ul className="grid gap-1">
        {advisories.map((a) => (
          <li key={a.label}>
            <span className="font-semibold">{a.label}.</span> <span className="text-muted">{a.detail}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-muted">Every compliance check passed, so Pebl HR wasn&apos;t needed. These are flags against the company&apos;s own policy, not the law: approve or decline as you see fit.</p>
    </div>
  );
}

export function SignalsList({ req }: { req: AnyRequest }) {
  // Advisories only show here separately when they didn't go to HR (there they're already in the signals).
  const advisories = req.routing.outcome === "hr_exception" ? [] : (req.routing.advisories ?? []);
  const signals = [...req.routing.signals, ...advisories.map((a) => ({ ...a, label: `${a.label} (disclaimer for the client admin)` }))];
  if (!signals.length) return <p className="text-sm text-muted">No routing signals. Every check passed and the combination is unlocked.</p>;
  return (
    <ul className="grid gap-2">
      {signals.map((s, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <span className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", s.id === "unapproved_hours" || s.id === "tier" ? "bg-admin" : "bg-hr")} />
          <span>
            <span className="font-semibold">{s.label}.</span> <span className="text-muted">{s.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Overtime meter and timesheet table (Time module)
// ---------------------------------------------------------------------------

export function OvertimeMeter({ used, adding = 0, limit, legalCap, forecast }: { used: number; adding?: number; limit: number; legalCap?: number | null; forecast?: number }) {
  const scale = Math.max(limit, used + adding, forecast ?? 0, 1);
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`;
  const over = used + adding > limit;
  return (
    <div className="grid gap-1.5">
      <div
        className="relative h-3 overflow-hidden rounded-full border border-line bg-sunken"
        role="img"
        aria-label={`${used} of ${limit} overtime hours used${adding ? `, plus ${adding} requested` : ""}`}
      >
        <i className={cx("absolute inset-y-0 left-0", used / limit >= 0.9 ? "bg-hr" : "bg-admin")} style={{ width: pct(used) }} />
        {adding > 0 && <i className={cx("absolute inset-y-0", over ? "bg-danger" : "bg-ai/75")} style={{ left: pct(used), width: pct(adding) }} />}
        {forecast !== undefined && forecast > used + adding && <i className="absolute inset-y-0 border-r-2 border-dashed border-hr" style={{ width: pct(forecast) }} />}
        <i className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `calc(${pct(limit)} - 1px)` }} />
      </div>
      <div className="flex flex-wrap justify-between gap-2 font-mono text-[11.5px] text-muted tabular">
        <span>
          {used} used{adding ? ` + ${adding} requested` : ""}
          {forecast !== undefined ? ` · forecast ${forecast}` : ""}
        </span>
        <span>
          limit {limit}
          {legalCap ? ` · legal cap ${legalCap}` : ""}
        </span>
      </div>
    </div>
  );
}

export function TimesheetTable({ req }: { req: TimesheetRequest }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[460px] text-sm">
        <thead>
          <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-muted">
            <th className="py-1.5 pr-3 font-medium">Day</th>
            <th className="py-1.5 pr-3 font-medium">Start</th>
            <th className="py-1.5 pr-3 font-medium">End</th>
            <th className="py-1.5 pr-3 font-medium">Break</th>
            <th className="py-1.5 text-right font-medium">Hours</th>
          </tr>
        </thead>
        <tbody>
          {req.data.days.map((d) => {
            const law = timeRules[getWorker(req.workerId).country];
            const h = d.off ? 0 : workedHours(d.start, d.end, d.breakMin, law.covered ? law.paidBreakUnderMinutes : undefined);
            return (
              <tr key={d.date} className="border-t border-line-soft">
                <td className="py-1.5 pr-3 font-semibold">
                  {dayName(d.date)} {rangeLabel(d.date, d.date)}
                </td>
                {d.off ? (
                  <td colSpan={3} className="py-1.5 pr-3 text-muted">
                    {d.off}
                  </td>
                ) : (
                  <>
                    <td className="py-1.5 pr-3 font-mono tabular">{d.start}</td>
                    <td className="py-1.5 pr-3 font-mono tabular">{d.end}</td>
                    <td className="py-1.5 pr-3 font-mono tabular">{d.breakMin}m</td>
                  </>
                )}
                <td className={cx("py-1.5 text-right font-mono tabular", h >= 13 && "font-bold text-danger", h > 8 && h < 13 && "text-hr")}>{h ? h.toFixed(1) : "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export { ActorChip };
