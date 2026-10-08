"use client";

import { useState } from "react";
import { rangeLabel } from "@/lib/calendar";
import { countryRules, leaveRules, timeRules } from "@/lib/data";
import { guardrails, scheduledDayHours, type Guardrail } from "@/lib/engine/guardrails";
import { money } from "@/lib/format";
import { useDemo } from "@/lib/store";
import type { ClientPolicy, CountryCode, Currency, OvertimeCountryPolicy, WorkingHoursPolicy } from "@/lib/types";
import { Button, Card, cx, Eyebrow, SparkIcon } from "../ui";

type Warning = { tone: "block" | "conflict" | "info"; text: string };

const currencies: Currency[] = ["GBP", "USD", "CAD", "EUR", "JPY"];
const currencyCountry: Record<Currency, CountryCode> = { GBP: "UK", USD: "US", CAD: "CA", EUR: "DE", JPY: "JP" };
const countries: CountryCode[] = ["UK", "US", "DE", "JP", "CA"];

function Warnings({ items }: { items: Warning[] }) {
  if (!items.length) return null;
  return (
    <ul className="grid gap-2">
      {items.map((w, i) => (
        <li key={i} className={cx("rounded-lg px-3 py-2 text-sm", w.tone === "info" ? "bg-rules-bg text-rules" : "bg-danger-bg text-danger")}>
          {w.tone === "block" && <b>Can&apos;t save: </b>}
          {w.text}
        </li>
      ))}
    </ul>
  );
}

/**
 * Prevention: the draft policy checked against each country's law as it's edited. A setting that
 * breaks the law blocks saving, with the legal value one click away.
 */
function PolicyCheck({ rows, onFix }: { rows: Guardrail[]; onFix(g: Guardrail): void }) {
  const blocks = rows.filter((r) => r.status === "block");
  const infos = rows.filter((r) => r.status === "info");
  const checked = rows.filter((r) => r.status !== "locked");
  const passing = checked.filter((r) => r.status === "ok").length;
  const countries = [...new Set(rows.filter((r) => r.status !== "info").map((r) => r.country))];
  return (
    <section className={cx("rounded-xl border-2 p-4", blocks.length ? "border-danger/40 bg-danger-bg" : "border-admin/40 bg-admin-bg")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <SparkIcon className="text-ai" />
        <h3 className="font-display font-bold">Pebl AI policy check</h3>
        <span className={cx("text-sm font-semibold", blocks.length ? "text-danger" : "text-admin")}>
          {blocks.length ? `${blocks.length} setting${blocks.length === 1 ? "" : "s"} break local law` : `${passing} of ${checked.length} settings meet local law`}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted">Checked live against verified {countries.join(", ")} rules. You can be stricter than the law, never looser.</p>
      {blocks.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {blocks.map((g) => (
            <li key={g.country + g.setting} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
              <span className="min-w-0">
                <b>
                  {g.country} · {g.setting}:
                </b>{" "}
                {g.message} {g.rule && <span className="font-mono text-[11px] text-faint">{g.rule}</span>}
              </span>
              {g.fix && (
                <Button size="sm" variant="primary" onClick={() => onFix(g)}>
                  {g.fix.label}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {infos.length > 0 && (
        <ul className="mt-2 grid gap-1">
          {infos.map((g) => (
            <li key={g.country + g.setting} className="text-xs text-muted">
              <b>
                {g.country} · {g.setting}:
              </b>{" "}
              {g.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Red outline on an input whose setting breaks the law. */
const blocked = (rows: Guardrail[], c: CountryCode, setting: string) => rows.some((r) => r.country === c && r.setting === setting && r.status === "block");

function SaveButton({ blocked, onClick }: { blocked: boolean; onClick(): void }) {
  const { policy } = useDemo();
  const [a, b] = policy.version.split(".").map(Number);
  return (
    <div>
      <Button variant="primary" disabled={blocked} onClick={onClick}>
        Save as version {a}.{b + 1}
      </Button>
    </div>
  );
}

const numCls = "w-20 rounded-lg border border-line px-2 py-1 text-sm tabular";

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export function ExpensePolicyTab() {
  const demo = useDemo();
  const p = demo.policy.expenses;
  const [mealCap, setMealCap] = useState(p.mealCapPerPerson);
  const [windowDays, setWindowDays] = useState(String(p.submitWithinDays));
  const [optIn, setOptIn] = useState(p.optInAutoApproveUnder !== null);
  const [optInAmount, setOptInAmount] = useState(String(p.optInAutoApproveUnder?.GBP ?? 25));
  const [mileage, setMileage] = useState(p.reimburseMileage);

  const warnings: Warning[] = [];
  for (const c of currencies) {
    const tf = countryRules[currencyCountry[c]].expenses.mealTaxFreePerPerson;
    if (tf && mealCap[c] > tf.amount) warnings.push({ tone: "info", text: `${currencyCountry[c]}: a ${money(mealCap[c], c)} meal cap is above the ${money(tf.amount, c)} tax-free limit. The excess is still reimbursed and reported to payroll as taxable.` });
    if (mealCap[c] <= 0) warnings.push({ tone: "block", text: `${currencyCountry[c]}: the meal cap must be above zero.` });
  }
  if (!mileage) {
    const floor = countryRules.US.expenses.reimbursementFloor;
    warnings.push({ tone: "conflict", text: `Conflicts with ${floor?.description ?? "local law"} The law is the floor, so mileage stays reimbursable for California-based workers whatever this setting says.` });
  }

  const save = () => {
    const ratio = Number(optInAmount) / (p.autoClearThreshold.GBP || 1);
    demo.updateExpensePolicy({
      mealCapPerPerson: mealCap,
      submitWithinDays: Math.max(1, Number(windowDays) || 30),
      reimburseMileage: mileage,
      optInAutoApproveUnder: optIn ? (Object.fromEntries(currencies.map((c) => [c, Math.min(p.autoClearThreshold[c], Math.round(p.autoClearThreshold[c] * ratio))])) as Record<Currency, number>) : null,
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="grid gap-6 p-5">
        <section>
          <h2 className="font-bold">Meal cap per person</h2>
          <p className="text-sm text-muted">Checked in each worker&apos;s payroll currency.</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {currencies.map((c) => (
              <label key={c} className="grid gap-1 text-xs font-semibold text-muted">
                {currencyCountry[c]} ({c})
                <input inputMode="decimal" value={mealCap[c]} onChange={(e) => setMealCap({ ...mealCap, [c]: Number(e.target.value) || 0 })} className="w-full min-w-0 rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink tabular" />
              </label>
            ))}
          </div>
        </section>
        <section className="grid gap-1">
          <h2 className="font-bold">Submission window</h2>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            Expenses must be submitted within
            <input inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} className={numCls} />
            days.
          </label>
        </section>
        <section className="grid gap-2">
          <h2 className="font-bold">Auto-approve small compliant expenses</h2>
          <p className="text-sm text-muted">Skip your one-tap approval for expenses that clear every check below an amount you set (EXP-15). They go straight to payroll.</p>
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="size-4 accent-admin" />
            Auto-approve under
            <input inputMode="decimal" disabled={!optIn} value={optInAmount} onChange={(e) => setOptInAmount(e.target.value)} className={cx(numCls, "disabled:opacity-50")} />
            GBP (scaled for other currencies)
          </label>
        </section>
        <section className="grid gap-2">
          <h2 className="font-bold">Business mileage</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={mileage} onChange={(e) => setMileage(e.target.checked)} className="size-4 accent-admin" />
            Reimburse business mileage at the country rate
          </label>
        </section>
        <Warnings items={warnings} />
        <SaveButton blocked={warnings.some((w) => w.tone === "block")} onClick={save} />
      </Card>
      <div className="grid content-start gap-4">
        <Card className="p-4">
          <Eyebrow className="mb-2">Set by Pebl compliance</Eyebrow>
          <p className="text-sm text-muted">These thresholds belong to Pebl&apos;s routing policy, not the client. Anything above them goes to HR.</p>
          <ul className="mt-3 grid gap-1 text-sm">
            {currencies.map((c) => (
              <li key={c} className="flex justify-between">
                <span>Auto-clear limit, {currencyCountry[c]}</span>
                <span className="font-mono tabular">{money(p.autoClearThreshold[c], c)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <LayersCard />
      </div>
    </div>
  );
}

function LayersCard() {
  return (
    <Card className="p-4">
      <Eyebrow className="mb-2">How the layers interact</Eyebrow>
      <ul className="grid gap-2 text-sm">
        <li>
          <b>The law is the floor.</b> <span className="text-muted">You can be stricter than local law, never looser.</span>
        </li>
        <li>
          <b>Over a limit isn&apos;t always a no.</b> <span className="text-muted">Excess expenses become taxable; hours worked are always paid.</span>
        </li>
        <li>
          <b>Versions have dates.</b> <span className="text-muted">Past decisions keep the version they used.</span>
        </li>
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export function LeavePolicyTab() {
  const demo = useDemo();
  const p = demo.policy.leave;
  const [vacation, setVacation] = useState(p.vacationDays);
  const [sick, setSick] = useState(p.sickPaidDays);
  const [notice, setNotice] = useState(String(p.noticeDays));
  const [maxRun, setMaxRun] = useState(String(p.maxConsecutiveDays));
  const [carry, setCarry] = useState(String(p.carryoverMaxDays));
  const [perks, setPerks] = useState(p.perks);
  const [blackouts, setBlackouts] = useState(p.blackouts);
  const [autoVac, setAutoVac] = useState(p.autoApproveVacationUpToDays);
  const [newBlackout, setNewBlackout] = useState({ start: "", end: "", label: "" });

  const draft: ClientPolicy = { ...demo.policy, leave: { ...p, vacationDays: vacation, sickPaidDays: sick, carryoverMaxDays: Math.max(0, Number(carry) || 0) } };
  const rows = guardrails(draft).filter((g) => g.area === "leave");
  const fix = (g: Guardrail) => {
    const next = g.fix!.apply(draft);
    setVacation(next.leave.vacationDays);
    setSick(next.leave.sickPaidDays);
  };

  const save = () =>
    demo.updateLeavePolicy({
      vacationDays: vacation,
      sickPaidDays: sick,
      noticeDays: Math.max(0, Number(notice) || 0),
      maxConsecutiveDays: Math.max(1, Number(maxRun) || 15),
      carryoverMaxDays: Math.max(0, Number(carry) || 0),
      perks,
      blackouts,
      autoApproveVacationUpToDays: autoVac,
    });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="grid gap-6 p-5">
        <section>
          <h2 className="font-bold">Paid vacation days</h2>
          <p className="text-sm text-muted">Per year, by country. Can&apos;t go below the statutory minimum.</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {countries.map((c) => (
              <label key={c} className="grid gap-1 text-xs font-semibold text-muted">
                {c} <span className="font-normal text-faint">law: {leaveRules[c].covered ? `${leaveRules[c].vacation?.minimumDays ?? 0}${c === "UK" ? " incl. BH" : ""}` : "provincial"}</span>
                <input inputMode="numeric" value={vacation[c]} onChange={(e) => setVacation({ ...vacation, [c]: Number(e.target.value) || 0 })} className={cx("w-full min-w-0 rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink tabular", blocked(rows, c, "Paid vacation") && "border-danger text-danger")} />
              </label>
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-bold">Paid sick days</h2>
          <p className="text-sm text-muted">Per year, by country. Can&apos;t go below what the law guarantees.</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {countries.map((c) => (
              <label key={c} className="grid gap-1 text-xs font-semibold text-muted">
                {c} <span className="font-normal text-faint">law: {leaveRules[c].covered ? (leaveRules[c].sick?.minPaidDays ? `${leaveRules[c].sick?.minPaidDays} min` : "company") : "provincial"}</span>
                <input inputMode="numeric" value={sick[c]} onChange={(e) => setSick({ ...sick, [c]: Number(e.target.value) || 0 })} className={cx("w-full min-w-0 rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink tabular", blocked(rows, c, "Paid sick days") && "border-danger text-danger")} />
              </label>
            ))}
          </div>
        </section>

        <section className="grid gap-2 text-sm">
          <h2 className="font-bold">Planned leave rules</h2>
          <label className="flex flex-wrap items-center gap-2">
            Notice period
            <input inputMode="numeric" value={notice} onChange={(e) => setNotice(e.target.value)} className={numCls} />
            days
          </label>
          <label className="flex flex-wrap items-center gap-2">
            Maximum consecutive working days
            <input inputMode="numeric" value={maxRun} onChange={(e) => setMaxRun(e.target.value)} className={numCls} />
          </label>
          <label className="flex flex-wrap items-center gap-2">
            Carry over up to
            <input inputMode="numeric" value={carry} onChange={(e) => setCarry(e.target.value)} className={numCls} />
            days into next year
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="checkbox" checked={autoVac !== null} onChange={(e) => setAutoVac(e.target.checked ? 2 : null)} className="size-4 accent-admin" />
            Auto-approve vacation up to
            <input inputMode="numeric" disabled={autoVac === null} value={autoVac ?? ""} onChange={(e) => setAutoVac(Number(e.target.value) || 1)} className={cx(numCls, "disabled:opacity-50")} />
            days (LV-16)
          </label>
        </section>

        <section>
          <h2 className="font-bold">Blackout periods</h2>
          <ul className="mt-2 grid gap-1.5">
            {blackouts.map((b, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sunken px-3 py-1.5 text-sm">
                <span>
                  <b>{b.label}</b> · {rangeLabel(b.start, b.end)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setBlackouts(blackouts.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <input placeholder="Label" value={newBlackout.label} onChange={(e) => setNewBlackout({ ...newBlackout, label: e.target.value })} className="rounded-lg border border-line px-2 py-1 text-sm" />
            <input type="date" value={newBlackout.start} onChange={(e) => setNewBlackout({ ...newBlackout, start: e.target.value })} className="rounded-lg border border-line px-2 py-1 text-sm" />
            <input type="date" value={newBlackout.end} min={newBlackout.start} onChange={(e) => setNewBlackout({ ...newBlackout, end: e.target.value })} className="rounded-lg border border-line px-2 py-1 text-sm" />
            <Button
              size="sm"
              disabled={!newBlackout.label || !newBlackout.start || !newBlackout.end}
              onClick={() => {
                setBlackouts([...blackouts, newBlackout]);
                setNewBlackout({ start: "", end: "", label: "" });
              }}
            >
              Add
            </Button>
          </div>
          <p className="mt-1 text-xs text-faint">Blackouts apply to planned leave only. Protected and statutory leave can&apos;t be blocked.</p>
        </section>

        <section>
          <h2 className="font-bold">Approval tiers</h2>
          <p className="text-sm text-muted">You can move your own perks between tiers. Statutory leave can&apos;t move down (LV-6).</p>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {(["floating", "birthday", "volunteer"] as const).map((k) => (
                <tr key={k} className="border-t border-line-soft">
                  <td className="py-1.5">
                    {k === "floating" ? "Floating holiday" : k === "birthday" ? "Birthday day" : "Volunteer days"} ({perks[k].days})
                  </td>
                  <td className="py-1.5 text-right">
                    <select value={perks[k].tier} onChange={(e) => setPerks({ ...perks, [k]: { ...perks[k], tier: e.target.value as "auto" | "manager" } })} className="rounded-md border border-line px-2 py-1 text-sm">
                      <option value="auto">Approved automatically</option>
                      <option value="manager">Manager decides</option>
                    </select>
                  </td>
                </tr>
              ))}
              {[
                ["Vacation", "Manager decides"],
                ["Sick leave (short), bereavement", "Approved automatically (protected)"],
                ["Paternity, maternity, parental", "Pebl HR (statutory)"],
              ].map(([a, b]) => (
                <tr key={a} className="border-t border-line-soft text-muted">
                  <td className="py-1.5">{a}</td>
                  <td className="py-1.5 text-right">{b} · locked</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <PolicyCheck rows={rows} onFix={fix} />
        <SaveButton blocked={rows.some((r) => r.status === "block")} onClick={save} />
      </Card>
      <div className="grid content-start gap-4">
        <Card className="p-4">
          <Eyebrow className="mb-2">Set by law · locked</Eyebrow>
          <p className="mb-2 text-xs text-muted">Workers always get these. You can add to them, never remove them.</p>
          <ul className="grid gap-2 text-sm">
            {rows
              .filter((r) => r.status === "locked")
              .map((r) => (
                <li key={r.country + r.setting}>
                  <b>{r.country}</b> <span className="text-muted">{r.setting === "Carryover" ? r.message : r.law}</span>
                </li>
              ))}
          </ul>
        </Card>
        <LayersCard />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overtime
// ---------------------------------------------------------------------------

export function OvertimePolicyTab() {
  const demo = useDemo();
  const [draft, setDraft] = useState(demo.policy.overtime);
  const set = (c: CountryCode, patch: Partial<OvertimeCountryPolicy>) => setDraft({ ...draft, [c]: { ...draft[c], ...patch } });

  const rows = guardrails({ ...demo.policy, overtime: draft }).filter((g) => g.area === "overtime");
  const fix = (g: Guardrail) => setDraft(g.fix!.apply({ ...demo.policy, overtime: draft }).overtime);

  const save = () => {
    for (const c of countries) if (JSON.stringify(draft[c]) !== JSON.stringify(demo.policy.overtime[c])) demo.updateOvertimePolicy(c, draft[c]);
  };

  return (
    <div className="grid gap-5">
      <Card className="overflow-x-auto p-5">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-3 font-medium">Country</th>
              <th className="py-1.5 pr-3 font-medium">Allowed</th>
              <th className="py-1.5 pr-3 font-medium">Monthly limit</th>
              <th className="py-1.5 pr-3 font-medium">Legal cap</th>
              <th className="py-1.5 pr-3 font-medium">Approval</th>
              <th className="py-1.5 pr-3 font-medium">Monthly budget</th>
              <th className="py-1.5 font-medium">Premium</th>
            </tr>
          </thead>
          <tbody>
            {countries.map((c) => {
              const law = timeRules[c];
              const p = draft[c];
              const over = blocked(rows, c, "Monthly overtime limit");
              return (
                <tr key={c} className="border-t border-line-soft align-middle">
                  <td className="py-2 pr-3 font-semibold">
                    {c}
                    {!law.covered && <div className="text-xs font-normal text-muted">Provincial: HR handles</div>}
                    {c === "JP" && (
                      <label className="mt-1 flex items-center gap-1.5 text-xs font-normal">
                        <input type="checkbox" checked={!!p.article36OnFile} onChange={(e) => set(c, { article36OnFile: e.target.checked })} className="accent-admin" />
                        Article 36 on file
                      </label>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <input type="checkbox" checked={p.allowed} onChange={(e) => set(c, { allowed: e.target.checked })} className="size-4 accent-admin" aria-label={`Overtime allowed in ${c}`} />
                  </td>
                  <td className="py-2 pr-3">
                    <input inputMode="numeric" value={p.monthlyLimit} onChange={(e) => set(c, { monthlyLimit: Number(e.target.value) || 0 })} className={cx(numCls, over && "border-danger text-danger")} aria-label={`Monthly limit ${c}`} />
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs text-muted">{law.covered ? (law.monthlyOvertimeCap ?? "none") : "–"}</td>
                  <td className="py-2 pr-3">
                    <select value={p.mode} onChange={(e) => set(c, { mode: e.target.value as OvertimeCountryPolicy["mode"] })} className="rounded-md border border-line px-2 py-1 text-sm">
                      <option value="pre_approval">Manager pre-approves</option>
                      <option value="auto_within_limit">Auto within the limit</option>
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <input inputMode="numeric" value={p.monthlyBudget} onChange={(e) => set(c, { monthlyBudget: Number(e.target.value) || 0 })} className={cx(numCls, "w-28")} aria-label={`Budget ${c}`} />
                  </td>
                  <td className="py-2">
                    <input inputMode="numeric" value={p.premiumPct} onChange={(e) => set(c, { premiumPct: Number(e.target.value) || 0 })} className={cx(numCls, "w-16", blocked(rows, c, "Overtime premium") && "border-danger text-danger")} aria-label={`Premium ${c}`} />
                    <span className="ml-1 text-muted">%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-faint">Each worker&apos;s effective limit is the stricter of your limit and the legal cap (TM-4). Classification is set by Pebl HR, not here.</p>
      </Card>
      <PolicyCheck rows={rows} onFix={fix} />
      <SaveButton blocked={rows.some((r) => r.status === "block")} onClick={save} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Working hours
// ---------------------------------------------------------------------------

export function WorkingHoursTab() {
  const demo = useDemo();
  const [draft, setDraft] = useState(demo.policy.workingHours);
  const set = (c: CountryCode, patch: Partial<WorkingHoursPolicy>) => setDraft({ ...draft, [c]: { ...draft[c], ...patch } });
  const policy: ClientPolicy = { ...demo.policy, workingHours: draft };
  const rows = guardrails(policy).filter((g) => g.area === "hours");
  const fix = (g: Guardrail) => setDraft(g.fix!.apply(policy).workingHours);
  const save = () => {
    for (const c of countries) if (JSON.stringify(draft[c]) !== JSON.stringify(demo.policy.workingHours[c])) demo.updateWorkingHours(c, draft[c]);
  };
  const timeCls = "rounded-lg border border-line px-2 py-1 text-sm tabular";

  return (
    <div className="grid gap-5">
      <Card className="overflow-x-auto p-5">
        <p className="mb-3 text-sm text-muted">Your standard working day in each country. Employees&apos; timesheets are pre-filled from it, so it has to be legal before anyone works it.</p>
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-3 font-medium">Country</th>
              <th className="py-1.5 pr-3 font-medium">Start</th>
              <th className="py-1.5 pr-3 font-medium">End</th>
              <th className="py-1.5 pr-3 font-medium">Unpaid break</th>
              <th className="py-1.5 pr-3 font-medium">Days / week</th>
              <th className="py-1.5 pr-3 font-medium">Hours</th>
              <th className="py-1.5 font-medium">The law</th>
            </tr>
          </thead>
          <tbody>
            {countries.map((c) => {
              const law = timeRules[c];
              const w = draft[c];
              const day = scheduledDayHours(policy, c);
              const dayBad = blocked(rows, c, "Working day") || blocked(rows, c, "Working week");
              return (
                <tr key={c} className="border-t border-line-soft align-middle">
                  <td className="py-2 pr-3 font-semibold">{c}</td>
                  <td className="py-2 pr-3">
                    <input type="time" value={w.start} onChange={(e) => set(c, { start: e.target.value })} className={timeCls} aria-label={`Start ${c}`} />
                  </td>
                  <td className="py-2 pr-3">
                    <input type="time" value={w.end} onChange={(e) => set(c, { end: e.target.value })} className={cx(timeCls, dayBad && "border-danger text-danger")} aria-label={`End ${c}`} />
                  </td>
                  <td className="py-2 pr-3">
                    <input inputMode="numeric" value={w.breakMin} onChange={(e) => set(c, { breakMin: Number(e.target.value) || 0 })} className={cx(numCls, "w-16", blocked(rows, c, "Break") && "border-danger text-danger")} aria-label={`Break ${c}`} />
                    <span className="ml-1 text-muted">min</span>
                  </td>
                  <td className="py-2 pr-3">
                    <select value={w.daysPerWeek} onChange={(e) => set(c, { daysPerWeek: Number(e.target.value) })} className={cx("rounded-md border border-line px-2 py-1 text-sm", blocked(rows, c, "Working week") && "border-danger text-danger")} aria-label={`Days per week ${c}`}>
                      {[4, 5, 6].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={cx("py-2 pr-3 font-mono text-xs tabular", dayBad ? "text-danger" : "text-muted")}>
                    {Math.round(day * 10) / 10} / day · {Math.round(day * w.daysPerWeek * 10) / 10} / wk
                  </td>
                  <td className="py-2 text-xs text-muted">{law.covered ? law.scheduleNote : law.coverageNote}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <PolicyCheck rows={rows} onFix={fix} />
      <SaveButton blocked={rows.some((r) => r.status === "block")} onClick={save} />
    </div>
  );
}
