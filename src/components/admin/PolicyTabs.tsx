"use client";

import { useState } from "react";
import { rangeLabel } from "@/lib/calendar";
import { countryRules, leaveRules, timeRules } from "@/lib/data";
import { money } from "@/lib/format";
import { useDemo } from "@/lib/store";
import type { CountryCode, Currency, OvertimeCountryPolicy } from "@/lib/types";
import { Button, Card, cx, Eyebrow } from "../ui";

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
  const [notice, setNotice] = useState(String(p.noticeDays));
  const [maxRun, setMaxRun] = useState(String(p.maxConsecutiveDays));
  const [carry, setCarry] = useState(String(p.carryoverMaxDays));
  const [perks, setPerks] = useState(p.perks);
  const [blackouts, setBlackouts] = useState(p.blackouts);
  const [autoVac, setAutoVac] = useState(p.autoApproveVacationUpToDays);
  const [newBlackout, setNewBlackout] = useState({ start: "", end: "", label: "" });

  const warnings: Warning[] = [];
  for (const c of countries) {
    const rule = leaveRules[c];
    const min = rule.vacation?.minimumDays ?? 0;
    // UK bank holidays can count toward the 5.6 weeks; the client grants them on top of PTO.
    const holidays = c === "UK" ? 8 : 0;
    if (rule.covered && vacation[c] + holidays < min) {
      warnings.push({ tone: "block", text: `${c}: ${vacation[c]} days${holidays ? ` plus ${holidays} bank holidays` : ""} is below the legal minimum of ${min}. ${rule.vacation?.description}` });
    }
  }
  if (Number(carry) > 0 && countries.some((c) => leaveRules[c].carryover?.expiresOn === "03-31")) {
    warnings.push({ tone: "info", text: "Germany and Japan carry leave to a later deadline by law, so the carryover cap applies to UK and US workers only." });
  }

  const save = () =>
    demo.updateLeavePolicy({
      vacationDays: vacation,
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
                <input inputMode="numeric" value={vacation[c]} onChange={(e) => setVacation({ ...vacation, [c]: Number(e.target.value) || 0 })} className="w-full min-w-0 rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink tabular" />
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

        <Warnings items={warnings} />
        <SaveButton blocked={warnings.some((w) => w.tone === "block")} onClick={save} />
      </Card>
      <div className="grid content-start gap-4">
        <Card className="p-4">
          <Eyebrow className="mb-2">Statutory minimums (layer 1)</Eyebrow>
          <ul className="grid gap-2 text-sm">
            {countries.map((c) => (
              <li key={c}>
                <b>{c}</b> <span className="text-muted">{leaveRules[c].covered ? leaveRules[c].vacation?.description : leaveRules[c].coverageNote}</span>
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

  const warnings: Warning[] = [];
  for (const c of countries) {
    const law = timeRules[c];
    const p = draft[c];
    if (!law.covered) continue;
    if (law.monthlyOvertimeCap !== null && p.monthlyLimit > law.monthlyOvertimeCap) {
      warnings.push({ tone: "block", text: `${c}: a ${p.monthlyLimit}-hour monthly limit is above the legal cap of ${law.monthlyOvertimeCap} (${law.capNote}). The law is the ceiling (TM-1).` });
    }
    if (law.prerequisite && c === "JP" && p.allowed && !p.article36OnFile) {
      warnings.push({ tone: "conflict", text: `JP: no ${law.prerequisite} on file, so overtime stays switched off for Japan-based workers until it's signed (TM-2).` });
    }
    const premium = Math.max(p.premiumPct, law.statutoryPremiumPct);
    if (p.premiumPct < law.statutoryPremiumPct) warnings.push({ tone: "info", text: `${c}: the law requires at least a ${law.statutoryPremiumPct}% premium, so ${premium}% is paid.` });
  }

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
              const over = law.covered && law.monthlyOvertimeCap !== null && p.monthlyLimit > law.monthlyOvertimeCap;
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
                    <input inputMode="numeric" value={p.premiumPct} onChange={(e) => set(c, { premiumPct: Number(e.target.value) || 0 })} className={cx(numCls, "w-16")} aria-label={`Premium ${c}`} />
                    <span className="ml-1 text-muted">%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-faint">Each worker&apos;s effective limit is the stricter of your limit and the legal cap (TM-4). Classification is set by Pebl HR, not here.</p>
      </Card>
      <Warnings items={warnings} />
      <SaveButton blocked={warnings.some((w) => w.tone === "block")} onClick={save} />
    </div>
  );
}
