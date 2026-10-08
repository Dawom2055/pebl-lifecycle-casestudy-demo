// Runs the demo scenarios through the pipeline and checks each outcome against the PRD.
// Usage: npm run check
import { buildSeedRequests, runExpensePipeline, runLeavePipeline, runOvertimePipeline, runTimesheetPipeline } from "../src/lib/engine/pipeline";
import { prefillWeek, overtimeStatus } from "../src/lib/engine/time";
import { leaveBalances } from "../src/lib/engine/leave";
import { sampleReceipts, seedPolicy, seedCombinations, getWorker } from "../src/lib/data";
import type { AnyRequest, ExpenseData, TimesheetDay } from "../src/lib/types";

let failures = 0;
const expect = (label: string, got: unknown, want: unknown) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${String(got)}${ok ? "" : ` (expected ${String(want)})`}`);
};
const say = (r: AnyRequest) => {
  for (const [aud, e] of Object.entries(r.explanations)) {
    console.log(`        [${aud}] ${e!.headline ? `${e!.headline}: ` : ""}${e!.text}${e!.suggestedAction ? ` | Suggested action: ${e!.suggestedAction}` : ""}`);
  }
};
const ctx = (existing: AnyRequest[]) => ({ submittedAt: "2026-10-09T10:00:00Z", policy: seedPolicy, combinations: seedCombinations, existing });

const seeds = buildSeedRequests(seedPolicy, seedCombinations);
console.log("--- Seeds");
const want: Record<string, string> = {
  "EXP-1001": "awaiting_admin",
  "EXP-1002": "awaiting_admin",
  "EXP-1003": "hr_review",
  "EXP-1004": "hr_review",
  "EXP-1005": "approved",
  "EXP-1006": "approved",
  "EXP-1007": "hr_review",
  "LV-4001": "approved", // UK short sick leave: protected, auto-approved
  "LV-4002": "approved",
  "LV-4003": "awaiting_admin", // US vacation: manager card
  "LV-4004": "awaiting_admin", // DE vacation: manager card
  "LV-4005": "hr_review", // Canada: no verified leave rules
  "OT-2990": "approved",
  "OT-2991": "approved",
  "OT-2992": "approved",
  "OT-3001": "awaiting_admin", // the PRD's Japan overtime card
  "TS-3101": "approved", // standard week, auto-approved
  "TS-3102": "hr_review", // 10.5h day over Germany's daily max
};
for (const s of seeds) expect(`seed ${s.id}`, s.status, want[s.id]);
const kenji = seeds.find((s) => s.id === "OT-3001")!;
if (kenji.kind === "overtime") {
  expect("Kenji brings overtime to", kenji.insight.after, 18);
  expect("Kenji month-end forecast", kenji.insight.forecast, 22);
  expect("Kenji partial suggestion", kenji.insight.partialHours, 2);
  say(kenji);
}
say(seeds.find((s) => s.id === "TS-3102")!);
say(seeds.find((s) => s.id === "LV-4005")!);

console.log("--- Expenses");
for (const r of sampleReceipts) {
  const data: ExpenseData = {
    merchant: r.read.merchant.value,
    amount: r.read.amount.value,
    currency: r.read.currency.value,
    date: r.read.date.value,
    taxId: r.read.taxId.value,
    category: r.read.category.value,
    attendees: r.read.attendees.value,
    note: r.note,
    receipt: { kind: "sample", sampleId: r.id },
    aiRead: { ...r.read, source: "sample" },
  };
  const req = runExpensePipeline({ id: "TEST", workerId: r.workerId, data, ...ctx(seeds) });
  expect(`receipt ${r.id}`, req.routing.outcome, r.expectedOutcome);
}

console.log("--- Leave (Muhammad, UK)");
const m = getWorker("w-muhammad");
const vac = leaveBalances(m, seeds, seedPolicy).find((b) => b.type === "vacation")!;
expect("vacation balance", vac.available, 8);
const leave = (id: string, data: Parameters<typeof runLeavePipeline>[0]["data"]) => runLeavePipeline({ id, workerId: m.id, data, ...ctx(seeds) });
const dec = leave("LV-T1", { type: "vacation", start: "2026-12-14", end: "2026-12-18", halfDay: false, note: "" });
expect("Dec 14-18 vacation -> manager card", dec.routing.outcome, "manager");
expect("  working days", dec.insight.workingDays, 5);
expect("  expiring days", dec.insight.expiring?.days, 5);
expect("  team overlap", dec.insight.teamAway.map((a) => `${a.name} ${a.start}..${a.end}`).join(), "Daniel Okafor 2026-12-16..2026-12-18");
expect("  clear range", dec.insight.clearRange && `${dec.insight.clearRange.start}..${dec.insight.clearRange.end}`, "2026-12-14..2026-12-15");
say(dec);
const xmas = leave("LV-T2", { type: "vacation", start: "2026-12-21", end: "2027-01-01", halfDay: false, note: "" });
expect("Christmas break: public holidays not deducted", xmas.insight.workingDays, 7);
const pat = leave("LV-T3", { type: "paternity", start: "2026-11-16", end: "2026-11-27", halfDay: false, note: "" });
expect("paternity -> HR", pat.routing.outcome, "hr_exception");
say(pat);
const sick = leave("LV-T4", { type: "sick", start: "2026-10-09", end: "2026-10-09", halfDay: false, note: "" });
expect("1 day sick -> approved automatically", sick.status, "approved");
say(sick);
const late = leave("LV-T5", { type: "vacation", start: "2026-10-15", end: "2026-10-16", halfDay: false, note: "" });
expect("short-notice vacation -> HR", late.routing.outcome, "hr_exception");
const long = leave("LV-T6", { type: "vacation", start: "2026-11-16", end: "2026-11-27", halfDay: false, note: "" });
expect("10 days with 8 left -> back to worker", long.routing.outcome, "back_to_worker");
const split = leave("LV-T7", { type: "vacation", start: "2026-11-16", end: "2026-11-27", halfDay: false, note: "", unpaidSplit: 2 });
expect("same, 2 days unpaid -> manager", split.routing.outcome, "manager");

console.log("--- Time (Muhammad, UK)");
expect("overtime hours left this month", overtimeStatus(m, seeds, seedPolicy).remaining, 6);
const pre = prefillWeek(m, seeds, seedPolicy);
const sheet = (id: string, edits: Record<string, Partial<TimesheetDay>>) =>
  runTimesheetPipeline({ id, workerId: m.id, data: { weekStart: "2026-10-05", note: "", days: pre.map((d) => ({ ...d, ...(edits[d.date] ?? {}) })) }, ...ctx(seeds) });
const a = sheet("TS-A", {});
expect("as pre-filled -> approved automatically", a.routing.outcome, "auto_clear");
expect("  total hours", a.insight.totalHours, 44);
say(a);
const b = sheet("TS-B", { "2026-10-09": { end: "20:30" } });
expect("+3h Fri without pre-approval -> manager confirms", b.routing.outcome, "manager");
expect("  month total", b.insight.monthAfter, 17);
say(b);
const c = sheet("TS-C", { "2026-10-05": { end: "20:30" }, "2026-10-06": { end: "20:30" }, "2026-10-07": { end: "20:30" } });
expect("+9h -> HR incident", c.routing.outcome, "hr_exception");
expect("  month total", c.insight.monthAfter, 23);
say(c);
const d = sheet("TS-D", { "2026-10-07": { start: "08:00", end: "22:30" }, "2026-10-08": { start: "07:00", end: "19:30" } });
expect("14h day + short rest -> HR incident", d.routing.outcome, "hr_exception");
say(d);
const ot = runOvertimePipeline({ id: "OT-T1", workerId: m.id, data: { date: "2026-10-14", hours: 4, reason: "Release" }, ...ctx(seeds) });
expect("UK overtime request 4h -> manager", ot.routing.outcome, "manager");
say(ot);
const tooMuch = runOvertimePipeline({ id: "OT-T2", workerId: m.id, data: { date: "2026-10-14", hours: 8, reason: "" }, ...ctx(seeds) });
expect("8h with 6 left is blocked before submit", tooMuch.evaluation.checks.find((x) => x.id === "limit")?.status, "fail");
const priya = runOvertimePipeline({ id: "OT-T3", workerId: "w-priya", data: { date: "2026-10-14", hours: 2, reason: "" }, ...ctx(seeds) });
expect("exempt worker can't request overtime", priya.evaluation.checks.find((x) => x.id === "eligible")?.status, "fail");

console.log(failures ? `\n${failures} failing` : "\nAll engine checks pass");
process.exit(failures ? 1 : 0);
