"use client";

import { useState, type ReactNode } from "react";
import { client, countryRules, leaveRules, timeRules, unlockConfig, workers } from "@/lib/data";
import { guardrails, type Guardrail } from "@/lib/engine/guardrails";
import { convert, money } from "@/lib/format";
import { useDemo } from "@/lib/store";
import type { ClientPolicy, Combination, CountryCode } from "@/lib/types";
import { AppShell } from "./AppShell";
import { Card, cx, Eyebrow, PageHeader, SparkIcon } from "./ui";

type Task = "expense" | "time" | "leave";

const TASKS: { id: Task; label: string; intake: string }[] = [
  { id: "expense", label: "Expense", intake: "A receipt photo. PeblAi reads the merchant, amount, date and tax number, and the employee confirms every field." },
  { id: "time", label: "Time", intake: "An overtime request before the work, or the weekly timesheet after it, pre-filled from the schedule and approved overtime." },
  { id: "leave", label: "Leave", intake: "A leave type and dates. The balance, public holidays and who else on the team is away are worked out automatically." },
];

const COUNTRIES: CountryCode[] = ["UK", "US", "CA", "DE", "JP"];

type View = "prevention" | "assistance" | "pipeline" | "training";
const VIEWS: { id: View; label: string }[] = [
  { id: "prevention", label: "Prevention" },
  { id: "assistance", label: "Assistance" },
  { id: "pipeline", label: "How a request is checked" },
  { id: "training", label: "AI Training" },
];

/** One rule as each layer sees it, and what's applied once both are combined. */
interface Row {
  rule: string;
  law: string;
  company: string;
  applied: string;
}

/** The "Pebl AI" page: how one request is checked against country law and the client's policy. */
export function AiAgentView() {
  const demo = useDemo();
  const [view, setView] = useState<View>("prevention");
  const [task, setTask] = useState<Task>("expense");
  const [country, setCountry] = useState<CountryCode>("UK");
  const name = countryRules[country].name;
  const t = TASKS.find((x) => x.id === task)!;
  const { covered, coverage, lawSource, rows } = layersFor(task, country, demo.policy);
  const combos = demo.combinations.filter((c) => c.key.startsWith(`${country}:${task}:`));

  return (
    <AppShell>
      <PageHeader
        title="How the Pebl AI agent works"
        sub="Pebl AI prevents a company from setting a policy that breaks local law, assists every person who touches a request, and checks each request against the law and the company's policy."
      />

      <Picker<View> label="Show" value={view} onChange={setView} options={VIEWS} />
      <div className="mb-6" />

      {view === "prevention" && <Prevention />}
      {view === "assistance" && <Assistance />}
      {view === "training" && <Training />}
      {view === "pipeline" && (
        <>

      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <Picker<Task> label="Task" value={task} onChange={setTask} options={TASKS.map((x) => ({ id: x.id, label: x.label }))} />
        <Picker<CountryCode> label="Country" value={country} onChange={setCountry} options={COUNTRIES.map((c) => ({ id: c, label: countryRules[c].name.replace("United Kingdom", "UK").replace("United States", "US") }))} />
      </div>

      <div className="grid gap-0">
        {/* 1. Intake */}
        <Stage n={1} tone="worker" title={`A ${t.label.toLowerCase()} request comes in`} className="mx-auto w-full max-w-xl">
          <p className="text-sm">{t.intake}</p>
        </Stage>

        <Split />

        {/* 2. The two layers */}
        <div className="grid gap-4 md:grid-cols-2">
          <Stage n={2} tone="rules" title={`Country law · ${name}`} badge="Fed in by Pebl compliance">
            <p className="mb-3 text-xs text-muted">{lawSource}</p>
            {covered ? (
              <Facts items={rows.filter((r) => r.law !== "–").map((r) => [r.rule, r.law])} />
            ) : (
              <p className="rounded-lg bg-surface px-3 py-2 text-sm">{coverage}</p>
            )}
          </Stage>
          <Stage n={3} tone="admin" title={`Company policy · ${client.name}`} badge={`Set at onboarding · v${demo.policy.version}`}>
            <p className="mb-3 text-xs text-muted">Chosen when the company joined Pebl, starting from Pebl&apos;s country templates. The client admin can change it under Policies; every change is a new version.</p>
            <Facts items={rows.filter((r) => r.company !== "–").map((r) => [r.rule, r.company])} />
          </Stage>
        </div>

        <Merge />

        {/* 3. Interpretation */}
        <Stage n={4} tone="ai" title="Interpret both layers together" badge="Rules engine">
          <p className="mb-3 text-sm">
            <b>The law is the floor.</b> A company can be stricter than the law, never looser. Where the two disagree, the stricter one that still meets the law wins, and every check records which
            rule version it used.
          </p>
          {covered ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-faint">
                    <th className="py-1.5 pr-3 font-medium">Rule</th>
                    <th className="py-1.5 pr-3 font-medium text-rules">Law says</th>
                    <th className="py-1.5 pr-3 font-medium text-admin">Company says</th>
                    <th className="py-1.5 font-medium text-ai">Applied</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rule} className="border-t border-line-soft align-top">
                      <td className="py-2 pr-3 font-semibold">{r.rule}</td>
                      <td className="py-2 pr-3 text-muted">{r.law}</td>
                      <td className="py-2 pr-3 text-muted">{r.company}</td>
                      <td className="py-2">{r.applied}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-lg bg-surface px-3 py-2 text-sm">
              No verified {name} rules for {t.label.toLowerCase()} yet, so the engine can&apos;t combine the layers. Every request goes to a Pebl HR specialist, who checks the local rules by hand.
            </p>
          )}
        </Stage>

        <Arrow />

        {/* 4. Routing */}
        <Stage n={5} tone="hr" title="Route to the right person" badge="Risk router">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Route tone="admin" title="Auto-clear" text="Every check passes and the combination is unlocked. Straight to the client admin's card, or approved automatically." />
            <Route tone="admin" title="Manager decides" text="Legal, but a judgment call: leave timing, overtime, unapproved hours. The AI suggests; the manager decides." />
            <Route tone="hr" title="Pebl HR" text="A flag: over a limit, a duplicate, low AI confidence, or a combination still in shadow mode. Spending flags like the meal cap stay with the client admin as a disclaimer." />
            <Route tone="worker" title="Back to the employee" text="Something they can fix, like a missing tax number. It never reaches anyone else until it's fixed." />
          </div>
          {combos.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted">{name} {t.label.toLowerCase()} combinations:</span>
              {combos.map((c) => (
                <ComboChip key={c.key} c={c} />
              ))}
            </div>
          )}
        </Stage>

        <Arrow />

        {/* 5. Output */}
        <Stage n={6} tone="ai" title="Explain the outcome to each person" badge={demo.aiConnected ? "Written by PeblAi" : "Templates until PeblAi is connected"} className="mx-auto w-full max-w-3xl">
          <p className="text-sm">
            The decision is already made. PeblAi turns it into plain language for each reader: what to fix for the employee, a recommendation for the manager, and the flag reason with a suggested next
            step for Pebl HR. It can&apos;t change or soften the outcome, and it never denies anything; only people deny requests.
          </p>
        </Stage>
      </div>

      {task === "expense" && <ExpenseRouting country={country} policy={demo.policy} combinations={demo.combinations} />}
      {task === "leave" && <LeaveRouting country={country} policy={demo.policy} combinations={demo.combinations} />}
      {task === "time" && <TimeRouting country={country} policy={demo.policy} combinations={demo.combinations} />}

      <Card className="mt-8 grid gap-4 p-5 md:grid-cols-3">
        <Principle title="AI reads and explains">PeblAi transcribes receipts and writes the explanations. It never decides whether something is compliant.</Principle>
        <Principle title="Rules decide">Country law and company policy are versioned rules, so the same request always gets the same answer, with an audit trail.</Principle>
        <Principle title="Trust is earned">A country and task only routes automatically after hundreds of shadow-mode cases agree with Pebl HR. Until then, HR decides.</Principle>
      </Card>
        </>
      )}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Prevention: rules researched by Pebl AI, verified by Pebl compliance, enforced on every
// client policy before anyone works, travels or takes leave under it.
// ---------------------------------------------------------------------------

const RULE_STEPS: { tone: Tone; title: string; text: string }[] = [
  { tone: "rules", title: "Official sources", text: "Labour codes, tax authorities and statutory guidance for each country: GOV.UK, the German ArbZG and BUrlG, the US Department of Labor, Japan's Labor Standards Act." },
  { tone: "ai", title: "Pebl AI drafts the rule", text: "Reads the source and writes it as a rule the product can enforce: a value, a rule ID, a version, an effective date and the source it came from." },
  { tone: "hr", title: "Pebl compliance verifies", text: "A specialist approves the rule before it goes live. When the law changes, the new version sends that country back to shadow mode until it proves itself again." },
  { tone: "admin", title: "Locked into the product", text: "Every company policy, and every request, is checked against it. A company can be more generous than the law, never less." },
];

const AREA_LABEL: Record<Guardrail["area"], string> = { leave: "Leave", hours: "Working hours", overtime: "Overtime" };

function Prevention() {
  const demo = useDemo();
  const [country, setCountry] = useState<CountryCode>("UK");
  const all = guardrails(demo.policy);
  const rows = all.filter((g) => g.country === country);
  const checked = all.filter((g) => g.status === "ok" || g.status === "block");
  const passing = checked.filter((g) => g.status === "ok").length;

  return (
    <div className="grid gap-8">
      <section>
        <h2 className="font-display text-xl font-extrabold">A policy that breaks local law can&apos;t be saved</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          When a company joins Pebl, its admin sets its own rules for leave, working hours, overtime and expenses. Pebl AI checks every setting against the law of each country the company employs people in, as it&apos;s typed. Anything below a legal minimum, or above a legal maximum, is blocked with the legal value one click away. Problems are stopped at the policy, before an employee ever submits a request under it.
        </p>
      </section>

      <section>
        <Eyebrow className="mb-3">How the rules get into the product</Eyebrow>
        <ol className="grid gap-3 md:grid-cols-4">
          {RULE_STEPS.map((st, i) => (
            <li key={st.title} className={cx("rounded-2xl border-2 p-4", toneCls[st.tone].box)}>
              <div className="flex items-center gap-2">
                <span className={cx("grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white", toneCls[st.tone].dot)}>{i + 1}</span>
                <h3 className="font-display font-bold">{st.title}</h3>
              </div>
              <p className="mt-2 text-sm text-muted">{st.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Eyebrow>What it checks · live against {client.name}&apos;s current policy</Eyebrow>
            <p className="mt-1 text-sm">
              <span className="font-semibold text-admin">
                {passing} of {checked.length}
              </span>{" "}
              settings across five countries meet local law. Try breaking one under Client admin → Policy.
            </p>
          </div>
          <Picker<CountryCode> label="Country" value={country} onChange={setCountry} options={COUNTRIES.map((c) => ({ id: c, label: countryRules[c].name.replace("United Kingdom", "UK").replace("United States", "US") }))} />
        </div>
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-faint">
                <th className="px-4 py-2.5 font-medium">Setting</th>
                <th className="px-4 py-2.5 font-medium text-rules">The law</th>
                <th className="px-4 py-2.5 font-medium text-admin">{client.name}</th>
                <th className="px-4 py-2.5 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.setting} className="border-t border-line-soft align-top">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold">{g.setting}</div>
                    <div className="font-mono text-[11px] text-faint">
                      {AREA_LABEL[g.area]}
                      {g.rule ? ` · ${g.rule}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{g.law}</td>
                  <td className="px-4 py-2.5 text-muted">{g.company}</td>
                  <td className="px-4 py-2.5">
                    <GuardStatus g={g} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Principle title="Fewer HR touches">A request built on an illegal policy becomes an HR exception later. Blocking the policy removes the exception before it exists.</Principle>
        <Principle title="Faster approvals">When the policy is already legal, a request that follows it can clear on its own, with no one re-checking the law.</Principle>
        <Principle title="Zero breaches">The law is a hard floor in the product, not a guideline. No admin can configure their way below it.</Principle>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assistance: once the policy is legal, help each person act faster and get it right first time.
// ---------------------------------------------------------------------------

const ASSIST: { role: string; tone: Tone; goal: string; items: { title: string; text: string; tryIt: string }[] }[] = [
  {
    role: "Employee",
    tone: "worker",
    goal: "Gets it right first time, so nothing bounces to HR",
    items: [
      { title: "Alfie, the AI agent", text: "Submits overtime, leave and the weekly timesheet from a sentence, through the same checks as the forms, and answers questions about balances and rules.", tryIt: "Employee → right-hand panel → Request 2 hours of overtime" },
      { title: "Reminders before deadlines", text: "Vacation days about to expire, a timesheet that's due, overtime close to the monthly limit, each with a button to fix it.", tryIt: "Employee → Home" },
      { title: "Receipt reading", text: "Claude reads the merchant, amount, date and tax number, with a confidence score on each field.", tryIt: "Employee → New expense" },
      { title: "Checks as you type", text: "Balances, public holidays, team overlap and overtime limits are shown before submitting, not after.", tryIt: "Employee → Leave or Time" },
      { title: "Pre-filled timesheets", text: "Built from the company's working hours, approved overtime and leave, so most weeks are one click.", tryIt: "Employee → Time" },
      { title: "Plain-language next steps", text: "Every request says what happens next, and exactly what to fix if something's missing.", tryIt: "Any submitted request" },
    ],
  },
  {
    role: "Client admin",
    tone: "admin",
    goal: "Decides in one tap, with the reasoning done",
    items: [
      { title: "Alfie, the AI agent", text: "Looks up any employee, summarizes what's waiting, approves clean requests in one go, drafts declines to confirm, and asks Pebl HR.", tryIt: "Client admin → right-hand panel → Tell me about Priya Shah" },
      { title: "AI suggestion on every card", text: "A recommendation and the reason: balance, expiring days, team coverage, cost and the month-end forecast.", tryIt: "Client admin → Decisions" },
      { title: "Smarter alternatives", text: "Leave dates with no team overlap, or a partial overtime approval, instead of a flat no.", tryIt: "A vacation or overtime card" },
      { title: "Disclaimers", text: "Compliant but unusual requests (over the meal cap, late, short notice) arrive flagged so the decision is informed.", tryIt: "As Muhammad, submit Meals, £62, 1 person" },
      { title: "Pebl HR's note and Contact HR", text: "HR's resolution sits at the top of the request; a question for HR is one click away.", tryIt: "Any card → Details" },
    ],
  },
  {
    role: "Pebl HR",
    tone: "hr",
    goal: "Resolves each exception in minutes",
    items: [
      { title: "Similar past cases", text: "How many requests reached HR for the same reason, how they were resolved, and HR's usual note, applied in one click.", tryIt: "Pebl HR → any exception" },
      { title: "Alfie, the AI agent", text: "Always open beside HR's work. It does the task, not just answers: messages the employee, sends a request to the admin, drafts a denial for HR to confirm, and answers questions about the request, policy and law.", tryIt: "Pebl HR → right-hand panel, or any request" },
      { title: "AI analysis and next step", text: "Why it was flagged, what passes, and one concrete next step.", tryIt: "Pebl HR → Exception queue" },
      { title: "Official sources", text: "VAT checkers, labour codes and statutory leave pages for the worker's country and request type.", tryIt: "Request details → Need more info?" },
      { title: "Forecast alerts", text: "A warning before a worker crosses the monthly overtime limit, not after.", tryIt: "Pebl HR → Exception queue" },
    ],
  },
];

function Assistance() {
  return (
    <div className="grid gap-8">
      <section>
        <h2 className="font-display text-xl font-extrabold">Help for every person who touches a request</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Prevention keeps the policy legal. Assistance makes the work around it fast: employees submit requests that pass first time, admins decide with the reasoning done, and Pebl HR resolves exceptions with past cases and the law to hand. The AI suggests; people decide.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {ASSIST.map((r) => (
          <section key={r.role} className={cx("rounded-2xl border-2 p-4", toneCls[r.tone].box)}>
            <div className="flex items-center gap-2">
              <span className={cx("size-2.5 rounded-full", toneCls[r.tone].dot)} />
              <h3 className="font-display text-lg font-bold">{r.role}</h3>
            </div>
            <p className={cx("mt-0.5 text-sm font-semibold", toneCls[r.tone].text)}>{r.goal}</p>
            <ul className="mt-3 grid gap-2">
              {r.items.map((it) => (
                <li key={it.title} className="rounded-xl bg-surface px-3 py-2.5">
                  <div className="text-sm font-semibold">{it.title}</div>
                  <p className="mt-0.5 text-xs text-muted">{it.text}</p>
                  <p className="mt-1 font-mono text-[11px] text-faint">Try: {it.tryIt}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <Principle title="Fewer HR touches">Reminders and checks before submitting stop problems becoming exceptions. Past cases and the chat cut the time spent on the ones that remain.</Principle>
        <Principle title="Faster approvals">Admins approve from a card with the reasoning done; HR applies the usual resolution in one click.</Principle>
        <Principle title="Zero breaches">Expiring-leave reminders protect the statutory minimum, and HR checks against official sources, not memory.</Principle>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Training: shadow mode. The system earns autonomy one country and request type at a time,
// by agreeing with Pebl HR on real requests before it's allowed to decide any on its own.
// ---------------------------------------------------------------------------

const TRAINING_STEPS: { tone: Tone; title: string; text: string }[] = [
  {
    tone: "rules",
    title: "Shadow mode",
    text: "For a new country and request type, the system makes its call on every request, but each one still goes to Pebl HR to decide, as it would without AI. Nothing is automated yet.",
  },
  {
    tone: "ai",
    title: "Every HR decision is scored",
    text: "HR's decision is logged against what the system would have done. Matching calls build agreement. A request the system would have passed but HR denied is a miss.",
  },
  {
    tone: "admin",
    title: "Unlocked by evidence",
    text: `At ${unlockConfig.thresholdPct}% agreement over at least ${unlockConfig.minCases} cases, with zero misses, it's ready. Pebl compliance unlocks it; a person makes the call, not the system.`,
  },
  {
    tone: "hr",
    title: "Audited after unlock",
    text: `Requests now route on their own, and HR reviews a random ${unlockConfig.auditSamplePct}% of the ones it never saw. An issue sends it to compliance to review.`,
  },
  {
    tone: "worker",
    title: "Back to shadow when the law changes",
    text: "A new rule version resets that country and request type to shadow mode. The evidence starts again, because past agreement was earned under the old rule.",
  },
];

const ready = (c: Combination) => c.status === "shadow" && c.shadowCases >= unlockConfig.minCases && (c.agreements / Math.max(1, c.shadowCases)) * 100 >= unlockConfig.thresholdPct && c.misses === 0;

function Training() {
  const demo = useDemo();
  const [country, setCountry] = useState<CountryCode>("UK");
  const combos = demo.combinations.filter((c) => c.key.startsWith(`${country}:`));
  const unlocked = demo.combinations.filter((c) => c.status === "unlocked").length;
  const readyCount = demo.combinations.filter(ready).length;

  return (
    <div className="grid gap-8">
      <section>
        <h2 className="font-display text-xl font-extrabold">Pebl AI earns its autonomy, one country and request type at a time</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Laws differ by country and request type, so the system is trained on each one separately: UK meals, German travel, Japanese overtime. It learns from Pebl HR&apos;s real decisions in shadow mode and only decides on its own once the evidence says it agrees with HR, with no compliance misses.
        </p>
      </section>

      <section>
        <Eyebrow className="mb-3">The lifecycle</Eyebrow>
        <ol className="grid gap-3 md:grid-cols-5">
          {TRAINING_STEPS.map((st, i) => (
            <li key={st.title} className={cx("rounded-2xl border-2 p-4", toneCls[st.tone].box)}>
              <div className="flex items-center gap-2">
                <span className={cx("grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white", toneCls[st.tone].dot)}>{i + 1}</span>
                <h3 className="font-display text-sm font-bold">{st.title}</h3>
              </div>
              <p className="mt-2 text-xs text-muted">{st.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <Eyebrow className="mb-2">How a decision is scored</Eyebrow>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-faint">
                <th className="py-1.5 pr-3 font-medium">System would have</th>
                <th className="py-1.5 pr-3 font-medium">HR decided</th>
                <th className="py-1.5 font-medium">Scored as</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Cleared it or sent it on", "Cleared / sent on", "Agreement", "text-admin"],
                ["Cleared it or sent it on", "Asked for information", "Disagreement", "text-hr"],
                ["Cleared it or sent it on", "Denied", "Miss: blocks unlocking", "text-danger"],
                ["Flagged it for HR", "Anything", "Agreement", "text-admin"],
              ].map(([a, b, c, cls]) => (
                <tr key={a + b} className="border-t border-line-soft">
                  <td className="py-1.5 pr-3 text-muted">{a}</td>
                  <td className="py-1.5 pr-3 text-muted">{b}</td>
                  <td className={cx("py-1.5 font-semibold", cls)}>{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">A miss is the system being too lenient, so even one keeps it in shadow mode. Being too cautious only costs HR time.</p>
        </Card>
        <Card className="p-4">
          <Eyebrow className="mb-2">Where it stands today</Eyebrow>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat value={unlocked} label="Unlocked" cls="text-admin" />
            <Stat value={readyCount} label="Ready to unlock" cls="text-ai" />
            <Stat value={demo.combinations.length - unlocked - readyCount} label="Still training" cls="text-rules" />
          </div>
          <p className="mt-3 text-xs text-muted">
            Try it: decide a shadow-mode request as Pebl HR (e.g. as Lukas, submit a Travel expense of €79.90) and watch its case count rise, or unlock a ready one under Pebl HR → Trust dashboard.
          </p>
        </Card>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <Eyebrow>Training progress · live</Eyebrow>
          <Picker<CountryCode> label="Country" value={country} onChange={setCountry} options={COUNTRIES.map((c) => ({ id: c, label: countryRules[c].name.replace("United Kingdom", "UK").replace("United States", "US") }))} />
        </div>
        {combos.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">Nothing in training for {countryRules[country].name} yet. Its rules aren&apos;t verified, so Pebl HR handles every request by hand.</p>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[11px] uppercase tracking-wide text-faint">
                  <th className="px-4 py-2.5 font-medium">Country · type</th>
                  <th className="px-4 py-2.5 font-medium">Cases</th>
                  <th className="px-4 py-2.5 font-medium">Agreement</th>
                  <th className="px-4 py-2.5 font-medium">Misses</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {combos.map((c) => {
                  const rate = (c.agreements / Math.max(1, c.shadowCases)) * 100;
                  const isReady = ready(c);
                  return (
                    <tr key={c.key} className="border-t border-line-soft align-middle">
                      <td className="px-4 py-2.5 font-mono text-xs">{c.key}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-sunken">
                            <div className={cx("h-full", c.shadowCases >= unlockConfig.minCases ? "bg-admin" : "bg-rules")} style={{ width: `${Math.min(100, (c.shadowCases / unlockConfig.minCases) * 100)}%` }} />
                          </div>
                          <span className="font-mono text-xs tabular text-muted">
                            {c.shadowCases}/{unlockConfig.minCases}
                          </span>
                        </div>
                      </td>
                      <td className={cx("px-4 py-2.5 font-mono text-xs tabular", rate >= unlockConfig.thresholdPct ? "text-admin" : "text-muted")}>{c.shadowCases ? `${rate.toFixed(1)}%` : "–"}</td>
                      <td className={cx("px-4 py-2.5 font-mono text-xs tabular", c.misses ? "text-danger" : "text-muted")}>{c.misses}</td>
                      <td className="px-4 py-2.5">
                        <span className={cx("rounded-full px-2 py-0.5 text-xs font-semibold", c.status === "unlocked" ? "bg-admin-bg text-admin" : isReady ? "bg-ai-bg text-ai" : "bg-rules-bg text-rules")}>
                          {c.status === "unlocked" ? "Unlocked" : isReady ? "Ready to unlock" : "Shadow mode"}
                        </span>
                        {c.resetReason && <p className="mt-1 text-xs text-muted">Reset: {c.resetReason}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        <Principle title="Zero breaches">Nothing is automated until it has matched HR hundreds of times with no misses, and a law change puts it straight back in training.</Principle>
        <Principle title="Fewer HR touches over time">Each unlock removes a whole country and request type from HR&apos;s queue, apart from the 5% audit.</Principle>
        <Principle title="Faster approvals">Once unlocked, compliant requests clear in seconds instead of waiting for a specialist.</Principle>
      </section>
    </div>
  );
}

function Stat({ value, label, cls }: { value: number; label: string; cls: string }) {
  return (
    <div>
      <div className={cx("font-display text-2xl font-extrabold tabular", cls)}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function GuardStatus({ g }: { g: Guardrail }) {
  const m = {
    ok: { text: "Meets the law", cls: "bg-admin-bg text-admin" },
    block: { text: "Blocked", cls: "bg-danger-bg text-danger" },
    locked: { text: "Set by law", cls: "bg-rules-bg text-rules" },
    info: { text: "Note", cls: "bg-hr-bg text-hr" },
  }[g.status];
  return (
    <div>
      <span className={cx("rounded-full px-2 py-0.5 text-xs font-semibold", m.cls)}>{m.text}</span>
      {g.message && <p className="mt-1 text-xs text-muted">{g.message}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The two layers for each task, read from the same data the engine uses.
// ---------------------------------------------------------------------------

function layersFor(task: Task, c: CountryCode, policy: ClientPolicy): { covered: boolean; coverage?: string; lawSource: string; rows: Row[] } {
  const cur = countryRules[c].currency;

  if (task === "expense") {
    const law = countryRules[c].expenses;
    const p = policy.expenses;
    const tf = law.mealTaxFreePerPerson;
    const mile = law.mileage.at(-1);
    const floor = law.reimbursementFloor;
    return {
      covered: true,
      lawSource: "Tax and receipt rules, each with a rule ID, version and effective date.",
      rows: [
        {
          rule: "Tax number",
          law: law.taxId ? `${law.taxId.label} on ${law.taxId.requiredOver ? `receipts from ${money(law.taxId.requiredOver, cur)}` : "every receipt"}` : "No VAT-style number required",
          company: "–",
          applied: law.taxId ? "Missing → back to the employee to fix" : "Not checked",
        },
        {
          rule: "Receipt",
          law: law.receipt.requiredOver ? `Required from ${money(law.receipt.requiredOver, cur)}` : "Required for every expense",
          company: "Always attach one",
          applied: "Required for every expense (the stricter rule)",
        },
        {
          rule: "Meals",
          law: tf ? `Tax-free up to ${money(tf.amount, cur)} per person` : "No tax-free meal limit",
          company: `Cap of ${money(p.mealCapPerPerson[cur], cur)} per person`,
          applied: `Over ${money(p.mealCapPerPerson[cur], cur)} → client admin decides, with a disclaimer${tf ? `; above ${money(tf.amount, cur)} is paid but reported as taxable` : ""}`,
        },
        {
          rule: "Mileage",
          law: mile ? `${money(mile.ratePerUnit, cur)} per ${mile.unit}` : "No set rate",
          company: p.reimburseMileage ? "Reimbursed" : "Not reimbursed",
          applied: p.reimburseMileage ? (mile ? `Paid at ${money(mile.ratePerUnit, cur)} per ${mile.unit}` : "Reimbursed") : floor ? `Not reimbursed, except where the law requires it (${floor.regions.join(", ")})` : "Not reimbursed",
        },
        { rule: "Auto-clear limit", law: "–", company: `Up to ${money(p.autoClearThreshold[cur], cur)}`, applied: `Over ${money(p.autoClearThreshold[cur], cur)} → Pebl HR` },
        { rule: "Submission window", law: "–", company: `Within ${p.submitWithinDays} days`, applied: `Older than ${p.submitWithinDays} days → Pebl HR` },
        { rule: "Pre-approval", law: "–", company: `Over ${money(convert(p.preApprovalOverUSD, "USD", cur), cur)}`, applied: "Without one → Pebl HR" },
      ],
    };
  }

  if (task === "leave") {
    const law = leaveRules[c];
    const p = policy.leave;
    if (!law.covered) return { covered: false, coverage: law.coverageNote, lawSource: "Statutory leave rules.", rows: companyLeaveRows(p) };
    const expires = law.carryover ? monthDay(law.carryover.expiresOn) : null;
    return {
      covered: true,
      lawSource: "Statutory leave, carryover, sick pay and family leave, plus the public holiday calendar.",
      rows: [
        {
          rule: "Vacation",
          law: law.vacation?.minimumDays ? `At least ${law.vacation.minimumDays} days a year` : "No legal minimum",
          company: `${p.vacationDays[c]} days a year`,
          applied: law.vacation?.minimumDays ? "Company allowance; a decline that risks the legal minimum goes to Pebl HR" : "Company allowance",
        },
        {
          rule: "Carryover",
          law: expires ? `Unused leave lapses ${expires}` : "–",
          company: `Up to ${p.carryoverMaxDays} days`,
          applied: law.carryover?.expiresOn === "12-31" ? `Up to ${p.carryoverMaxDays} days carried into the new year` : `The law's later deadline (${expires}) applies, not the company cap`,
        },
        {
          rule: "Sick leave",
          law: law.sick ? `${law.sick.pay}. Note needed after ${law.sick.documentAfterDays} days` : "–",
          company: `${p.sickPaidDays[c]} paid days`,
          applied: "Protected: approved automatically once unlocked; the manager is told, not asked",
        },
        {
          rule: "Paternity",
          law: law.paternity ? `Up to ${law.paternity.maxDays} days, ${law.paternity.pay.toLowerCase()}` : "No statutory paternity leave",
          company: "–",
          applied: "Statutory leave → Pebl HR to confirm pay and dates",
        },
        ...companyLeaveRows(p),
      ],
    };
  }

  const law = timeRules[c];
  const p = policy.overtime[c];
  if (!law.covered) return { covered: false, coverage: law.coverageNote, lawSource: "Working-time law.", rows: [] };
  const cap = law.monthlyOvertimeCap;
  return {
    covered: true,
    lawSource: law.description,
    rows: [
      { rule: "Overtime allowed", law: law.prerequisite ? `Only with an ${law.prerequisite}` : "Yes", company: p.allowed ? "Yes" : "Switched off", applied: !p.allowed ? "No overtime" : law.prerequisite && !p.article36OnFile ? `Off until the ${law.prerequisite} is signed` : "Allowed" },
      {
        rule: "Monthly limit",
        law: cap === null ? "No legal cap" : `${cap} hours (${law.capNote})`,
        company: `${p.monthlyLimit} hours`,
        applied: `${cap === null ? p.monthlyLimit : Math.min(cap, p.monthlyLimit)} hours, the lower of the two`,
      },
      {
        rule: "Overtime premium",
        law: law.statutoryPremiumPct ? `At least ${law.statutoryPremiumPct}%` : "None set by law",
        company: `${p.premiumPct}%`,
        applied: `${Math.max(p.premiumPct, law.statutoryPremiumPct)}%, the higher of the two`,
      },
      {
        rule: "Hours and rest",
        law: [law.dailyMax && `${law.dailyMax} hrs a day`, law.weeklyMax && `${law.weeklyMax} hrs a week`, law.minRestHours && `${law.minRestHours} hrs rest between days`].filter(Boolean).join(", ") || "No federal limit",
        company: "–",
        applied: "A breach → Pebl HR incident",
      },
      {
        rule: "Breaks",
        law: law.breakRule
          ? `${law.breakRule.minutes} min after ${law.breakRule.afterHours} hrs${law.breakRule.longAfterHours ? `, ${law.breakRule.longMinutes} after ${law.breakRule.longAfterHours}` : ""}, unpaid`
          : law.paidBreakUnderMinutes
            ? `None required. Breaks under ${law.paidBreakUnderMinutes} min are paid`
            : "None required",
        company: "–",
        applied: law.breakRule ? "A short break → Pebl HR incident" : law.paidBreakUnderMinutes ? `Breaks under ${law.paidBreakUnderMinutes} min count as hours worked` : "Not checked",
      },
      {
        rule: "Approval",
        law: "–",
        company: p.mode === "pre_approval" ? "Overtime is approved in advance" : "Automatic within the limit",
        applied: "Unapproved hours → the manager confirms. Hours worked are always paid",
      },
      { rule: "Monthly budget", law: "–", company: money(p.monthlyBudget, countryRules[c].currency), applied: "Shown on the manager's card with the month-end forecast" },
    ],
  };
}

function companyLeaveRows(p: ClientPolicy["leave"]): Row[] {
  return [
    { rule: "Notice", law: "–", company: `${p.noticeDays} days ahead`, applied: "Short notice → Pebl HR" },
    { rule: "Blackouts", law: "–", company: p.blackouts.length ? p.blackouts.map((b) => b.label).join(", ") : "None", applied: "An overlap → Pebl HR" },
    { rule: "Long absences", law: "–", company: `Over ${p.hrReviewOverDays} working days`, applied: "→ Pebl HR" },
  ];
}

function monthDay(mmdd: string) {
  return new Date(`2000-${mmdd}T00:00:00Z`).toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// Where an expense goes: straight to the client admin, or to Pebl HR. Live thresholds.
// ---------------------------------------------------------------------------

/** One condition: what it is, the threshold, and a demo receipt that shows it. */
type Line = [label: string, detail: string, tryIt?: string];

function ExpenseRouting({ country, policy, combinations }: { country: CountryCode; policy: ClientPolicy; combinations: Combination[] }) {
  const p = policy.expenses;
  const cur = countryRules[country].currency;
  const cap = p.mealCapPerPerson[cur];
  const name = countryRules[country].name.replace("United Kingdom", "UK").replace("United States", "US");
  const taxId = countryRules[country].expenses.taxId;
  const people = workers.filter((w) => w.country === country);
  const usual = people.map((w) => `${w.name.split(" ")[0]} ${money(w.usualMealSpend * p.anomalyMultiplier, cur)}`).join(", ");
  const mine = combinations.filter((c) => c.key.startsWith(`${country}:expense:`));
  const unlocked = mine.filter((c) => c.status === "unlocked").map((c) => c.key.split(":")[2]);
  const shadow = mine.filter((c) => c.status !== "unlocked").map((c) => c.key.split(":")[2]);

  const toAdmin: Line[] = [
    ["Fixable checks pass", `Receipt attached${taxId ? `, ${taxId.label}${taxId.requiredOver ? ` from ${money(taxId.requiredOver, cur)}` : ""}` : ""}, a real category, a past date`],
    ["Within the auto-clear amount", `${money(p.autoClearThreshold[cur], cur)} or less`],
    ["Matches the receipt", "No edits to what the AI read, and every field 80%+ confidence"],
    ["No duplicate", "Not already claimed by any Lumen worker"],
    ["Category is unlocked", unlocked.length ? `${name}: ${unlocked.join(", ")}` : `None in ${name} yet`],
  ];

  const disclaimers: Line[] = [
    ["Over the meal cap", `Over ${money(cap, cur)} per person`, "Muhammad · Dinner over the meal cap"],
    ["Close to the meal cap", `${money((cap * p.borderlineBandPct) / 100, cur)} to ${money(cap, cur)} per person`, "Daniel · Dinner close to the cap"],
    ["Unusual amount", `${p.anomalyMultiplier}× the worker's usual meal spend${usual ? ` (${usual})` : ""}`, "Priya · Team lunch, unusual amount"],
    ["Submitted late", `More than ${p.submitWithinDays} days after the expense`, "Sophie · Taxi from six weeks ago"],
    [
      "No pre-approval",
      `Over ${money(convert(p.preApprovalOverUSD, "USD", cur), cur)} with none on file. That's also over the ${money(p.autoClearThreshold[cur], cur)} auto-clear amount, so HR sees it first and passes this note on`,
    ],
  ];

  const toHr: Line[] = [
    ["Over auto-clear", `Over ${money(p.autoClearThreshold[cur], cur)}`, "Muhammad · Team dinner"],
    ["Duplicate", "Same merchant, date and amount as another claim", "Daniel, then Muhammad · Shared dinner"],
    ["Edited or unsure", "Amount, date or currency changed from the receipt, or AI confidence under 80%", "Any receipt, edit the amount"],
    ["Shadow mode", shadow.length ? `${name}: ${shadow.join(", ")}` : `Nothing in ${name}`, "Daniel · Hotel, Lukas or Kenji"],
    ["Still failing after a fix", "Sent back once and resubmitted unfixed", "Muhammad · Lunch, no VAT, resubmit blank"],
  ];

  return (
    <section className="mt-8">
      <h2 className="font-display text-xl font-extrabold">Where an expense goes</h2>
      <p className="mt-1 text-sm text-muted">
        {name} amounts in {cur}, from Lumen&apos;s current policy. Fixable problems (a missing receipt or tax number) go back to the employee first.
      </p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <RouteList tone="admin" title="Straight to the client admin" rule="All of these are true" lines={toAdmin} tryIt="Muhammad · Client dinner, Daniel · Train, Priya · Lunch, Sophie · Coffee">
          <Disclaimers note="Spending flags against Lumen's own policy, not the law. The admin sees them on the decision card and decides; Pebl HR isn't involved." lines={disclaimers} />
        </RouteList>
        <RouteList tone="hr" title="To Pebl HR" rule="Any one of these" lines={toHr} />
      </div>
    </section>
  );
}

/** A heading, a one-line note and the outcome lists side by side. */
function RoutingSection({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-xl font-extrabold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{sub}</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function LeaveRouting({ country, policy, combinations }: { country: CountryCode; policy: ClientPolicy; combinations: Combination[] }) {
  const p = policy.leave;
  const law = leaveRules[country];
  const name = countryRules[country].name.replace("United Kingdom", "UK").replace("United States", "US");
  const shadow = combinations.filter((c) => c.key.startsWith(`${country}:leave:`) && c.status !== "unlocked").map((c) => c.key.split(":")[2]);
  const perks = (tier: "auto" | "manager") =>
    (Object.entries(p.perks) as [string, { tier: string }][])
      .filter(([, v]) => v.tier === tier)
      .map(([k]) => k)
      .join(", ");
  const sub = `${name} rules and Lumen's current policy. Fixable problems (bad dates, over the balance, a missing document) go back to the employee first.`;

  if (!law.covered) {
    return (
      <RoutingSection title="Where a leave request goes" sub={sub}>
        <RouteList tone="hr" title="To Pebl HR" rule="Every request" lines={[["No verified rules", law.coverageNote ?? `${name} leave rules aren't verified yet.`]]} />
      </RoutingSection>
    );
  }

  const auto: Line[] = [
    ["Short sick leave", `Up to ${law.sick?.shortMaxDays ?? 3} days`, "Muhammad · Leave · Sick today"],
    ["Bereavement", `Up to ${p.bereavementDays} days`],
    ...(perks("auto") ? ([["Perk days", perks("auto")]] as Line[]) : []),
    ...(p.autoApproveVacationUpToDays != null ? ([["Short vacation", `Up to ${p.autoApproveVacationUpToDays} days, under Lumen's opt-in`]] as Line[]) : []),
  ];
  const manager: Line[] = [
    ["Vacation", "Within balance, no blackout", "Muhammad · Leave · Vacation Dec 14–18"],
    ["Short unpaid leave", `Up to ${p.unpaidShortMaxDays} days`],
    ...(perks("manager") ? ([["Perk days", perks("manager")]] as Line[]) : []),
    ["The manager can", "Approve, suggest other dates, decline with a reason, or contact HR"],
  ];
  const hr: Line[] = [
    ["Statutory leave", `Paternity, parental, or sick over ${law.sick?.shortMaxDays ?? 3} days`, "Muhammad · Leave · Paternity leave"],
    ["Blackout", p.blackouts.length ? p.blackouts.map((b) => b.label).join(", ") : "None set"],
    ["Long absence", `Over ${Math.min(p.hrReviewOverDays, p.maxConsecutiveDays)} working days`],
    ["Risky decline", "The manager declines days the employee would otherwise lose by law"],
    ["Unsure document", "AI confidence under 80% on a doctor's note or certificate"],
    ["Shadow mode", shadow.length ? `${name}: ${shadow.join(", ")}` : `Nothing in ${name}`],
  ];

  return (
    <RoutingSection title="Where a leave request goes" sub={sub}>
      <RouteList tone="admin" title="Approved automatically" rule="Manager is told" lines={auto} />
      <RouteList tone="admin" title="Client admin decides" rule="All checks pass" lines={manager}>
        <Disclaimers note="Against Lumen's own policy, not the law. The manager sees it on the decision card; Pebl HR isn't involved." lines={[["Short notice", `Under ${p.noticeDays} days' notice`, "Muhammad · Leave · Next week"]]} />
      </RouteList>
      <RouteList tone="hr" title="To Pebl HR" rule="Any one of these" lines={hr} />
    </RoutingSection>
  );
}

function TimeRouting({ country, policy, combinations }: { country: CountryCode; policy: ClientPolicy; combinations: Combination[] }) {
  const p = policy.overtime[country];
  const law = timeRules[country];
  const name = countryRules[country].name.replace("United Kingdom", "UK").replace("United States", "US");
  const shadow = combinations.filter((c) => c.key.startsWith(`${country}:time:`) && c.status !== "unlocked").map((c) => (c.key.endsWith("overtime") ? "overtime requests" : "timesheets"));
  const sub = `${name} rules and Lumen's current policy. An overtime request that breaks a limit can't be submitted at all; hours already worked are always paid.`;

  if (!law.covered) {
    return (
      <RoutingSection title="Where overtime and timesheets go" sub={sub}>
        <RouteList tone="hr" title="To Pebl HR" rule="Every request" lines={[["No verified rules", law.coverageNote ?? `${name} working-time rules aren't verified yet.`]]} />
      </RoutingSection>
    );
  }

  const cap = law.monthlyOvertimeCap;
  const limit = cap === null ? p.monthlyLimit : Math.min(cap, p.monthlyLimit);
  const lawLimits = [law.dailyMax && `over ${law.dailyMax} hrs a day`, law.minRestHours && `under ${law.minRestHours} hrs rest`, law.breakRule && "a missed break"].filter(Boolean).join(", ");

  const auto: Line[] = [
    ["Timesheet as planned", "Matches the schedule and pre-approved overtime, within every limit", "Muhammad · Time · As pre-filled"],
    ...(p.mode === "auto_within_limit" ? ([["Overtime request", `Within ${limit} hrs this month`]] as Line[]) : []),
  ];
  const manager: Line[] = [
    ...(p.mode === "pre_approval" ? ([["Overtime request", `Within ${limit} hrs this month and the legal limits. Over budget is flagged, not blocked`]] as Line[]) : []),
    ["Unplanned overtime", "Timesheet hours that weren't pre-approved, within the limit. The manager confirms; they can't refuse to pay", "Muhammad · Time · +3 hrs Friday"],
  ];
  const hr: Line[] = [
    ["Over the monthly limit", `More than ${limit} hrs (company ${p.monthlyLimit}${cap === null ? "" : `, law ${cap}`})`, "Muhammad · Time · +4 hrs Mon–Wed"],
    ...(lawLimits ? ([["Breaks working-time law", lawLimits, "Muhammad · Time · 14-hour Wednesday"]] as Line[]) : []),
    ...(law.weeklyMax ? ([["Long week", `Over ${law.weeklyMax} hrs`]] as Line[]) : []),
    ["Unusual day", "13+ hours in a day, flagged by the AI"],
    ["Classification unclear", "Pebl HR hasn't confirmed whether overtime rules apply"],
    ["Shadow mode", shadow.length ? `${name}: ${shadow.join(", ")}` : `Nothing in ${name}`],
  ];

  return (
    <RoutingSection title="Where overtime and timesheets go" sub={sub}>
      <RouteList tone="admin" title="Approved automatically" rule="Manager is told" lines={auto} />
      <RouteList tone="admin" title="Client admin decides" rule="All checks pass" lines={manager} />
      <RouteList tone="hr" title="To Pebl HR" rule="Any one of these" lines={hr} />
    </RoutingSection>
  );
}

/** Flags that still go to the client admin, shown under their list as a disclaimer. */
function Disclaimers({ note, lines }: { note: string; lines: Line[] }) {
  return (
    <div className="mt-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-display text-sm font-bold text-hr">Disclaimer</h4>
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted">Still goes to the admin, flagged</span>
      </div>
      <p className="mb-2 text-xs text-muted">{note}</p>
      <ul className="grid gap-1">
        {lines.map(([label, detail, demo]) => (
          <li key={label} className="rounded-lg border border-hr/30 bg-hr-bg px-3 py-1.5 text-sm">
            <span className="font-semibold">{label}</span> <span className="text-muted">· {detail}</span>
            {demo && <span className="block font-mono text-[11px] text-faint">Try: {demo}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RouteList({ tone, title, rule, lines, tryIt, children }: { tone: Tone; title: string; rule: string; lines: Line[]; tryIt?: string; children?: ReactNode }) {
  const t = toneCls[tone];
  return (
    <div className={cx("rounded-2xl border-2 p-4", t.box)}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={cx("font-display font-bold", t.text)}>{title}</h3>
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted">{rule}</span>
      </div>
      <ul className="grid gap-1">
        {lines.map(([label, detail, demo]) => (
          <li key={label} className="rounded-lg bg-surface px-3 py-1.5 text-sm">
            <span className="font-semibold">{label}</span> <span className="text-muted">· {detail}</span>
            {demo && <span className="block font-mono text-[11px] text-faint">Try: {demo}</span>}
          </li>
        ))}
      </ul>
      {tryIt && <p className="mt-2 font-mono text-[11px] text-faint">Try: {tryIt}</p>}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diagram pieces
// ---------------------------------------------------------------------------

type Tone = "worker" | "rules" | "admin" | "ai" | "hr";

const toneCls: Record<Tone, { box: string; dot: string; text: string }> = {
  worker: { box: "border-worker/40 bg-worker-bg", dot: "bg-worker", text: "text-worker" },
  rules: { box: "border-rules/40 bg-rules-bg", dot: "bg-rules", text: "text-rules" },
  admin: { box: "border-admin/40 bg-admin-bg", dot: "bg-admin", text: "text-admin" },
  ai: { box: "border-ai/40 bg-ai-bg", dot: "bg-ai", text: "text-ai" },
  hr: { box: "border-hr/40 bg-hr-bg", dot: "bg-hr", text: "text-hr" },
};

function Stage({ n, tone, title, badge, className, children }: { n: number; tone: Tone; title: string; badge?: string; className?: string; children: ReactNode }) {
  const t = toneCls[tone];
  return (
    <section className={cx("rounded-2xl border-2 p-4 sm:p-5", t.box, className)}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={cx("grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white", t.dot)}>{n}</span>
        <h2 className="font-display text-base font-bold">{title}</h2>
        {badge && <span className={cx("ml-auto rounded-full bg-surface px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wide", t.text)}>{badge}</span>}
      </div>
      {children}
    </section>
  );
}

function Facts({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid gap-1.5">
      {items.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 rounded-lg bg-surface px-3 py-1.5 text-sm">
          <dt className="font-semibold">{k}</dt>
          <dd className="text-muted">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Route({ tone, title, text }: { tone: Tone; title: string; text: string }) {
  const t = toneCls[tone];
  return (
    <div className="rounded-xl bg-surface p-3">
      <div className={cx("flex items-center gap-1.5 text-sm font-bold", t.text)}>
        <span className={cx("size-2 rounded-full", t.dot)} />
        {title}
      </div>
      <p className="mt-1 text-xs text-muted">{text}</p>
    </div>
  );
}

function ComboChip({ c }: { c: Combination }) {
  const live = c.status === "unlocked";
  return (
    <span className={cx("rounded-full px-2 py-0.5 font-mono text-[11px]", live ? "bg-admin-bg text-admin" : "bg-rules-bg text-rules")}>
      {c.key.split(":")[2]} · {live ? "unlocked" : "shadow"}
    </span>
  );
}

function Principle({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 font-display font-bold">
        <SparkIcon className="text-ai" />
        {title}
      </div>
      <p className="mt-1 text-sm text-muted">{children}</p>
    </div>
  );
}

function Picker<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange(v: T): void; options: { id: T; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Eyebrow>{label}</Eyebrow>
      <div role="tablist" aria-label={label} className="flex flex-wrap rounded-xl bg-sunken p-1">
        {options.map((o) => (
          <button
            key={o.id}
            role="tab"
            aria-selected={value === o.id}
            onClick={() => onChange(o.id)}
            className={cx("rounded-lg px-3 py-1 text-sm font-semibold transition-colors", value === o.id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Connectors: one down arrow, a fork into the two layers, and the join back into one. */
function Arrow() {
  return (
    <div className="grid place-items-center py-1.5 text-faint" aria-hidden>
      <svg width="16" height="28" viewBox="0 0 16 28" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 0v24M2 18l6 7 6-7" />
      </svg>
    </div>
  );
}

function Split() {
  return (
    <>
      <div className="md:hidden">
        <Arrow />
      </div>
      <svg className="hidden h-10 w-full text-faint md:block" viewBox="0 0 100 40" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M50 0V14H25V40M50 14H75V40" vectorEffect="non-scaling-stroke" />
      </svg>
    </>
  );
}

function Merge() {
  return (
    <>
      <div className="md:hidden">
        <Arrow />
      </div>
      <svg className="hidden h-10 w-full text-faint md:block" viewBox="0 0 100 40" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M25 0V20H75V0M50 20V40" vectorEffect="non-scaling-stroke" />
      </svg>
    </>
  );
}
