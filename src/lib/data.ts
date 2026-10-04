import workersJson from "@data/workers.json";
import countryRulesJson from "@data/country-rules.json";
import clientPolicyJson from "@data/client-policy.json";
import unlockJson from "@data/unlock-status.json";
import receiptsJson from "@data/sample-receipts.json";
import seedJson from "@data/seed-requests.json";
import leaveRulesJson from "@data/country-rules-leave.json";
import timeRulesJson from "@data/country-rules-time.json";
import leaveSeedJson from "@data/leave-seed.json";
import timeSeedJson from "@data/time-seed.json";
import { addDays, weekStartOf } from "./calendar";
import type {
  AiRead,
  ClientPolicy,
  Combination,
  CountryCode,
  Currency,
  ExpenseCategory,
  LeaveData,
  OvertimeData,
  TimesheetDay,
  Worker,
} from "./types";

/** The demo's "today": the real local date, so date checks match the calendar. */
export const DEMO_TODAY = localToday();

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The timesheet that's due: Monday of the latest Mon–Fri week whose Friday has arrived. */
export const CURRENT_WEEK = (() => {
  const monday = weekStartOf(DEMO_TODAY);
  return DEMO_TODAY >= addDays(monday, 4) ? monday : addDays(monday, -7);
})();

/** Demo receipts were written as if today were this date; their dates move with the real today. */
const AUTHORED_TODAY = "2026-10-09";
const shiftDays = Math.round((Date.parse(`${DEMO_TODAY}T00:00:00Z`) - Date.parse(`${AUTHORED_TODAY}T00:00:00Z`)) / 86_400_000);

export const client = workersJson.client;
export const hrSpecialist = workersJson.hrSpecialist;
export const workers = workersJson.workers as Worker[];

const originalClassifications = Object.fromEntries(workers.map((w) => [w.id, w.classification]));

/**
 * Pebl HR sets each worker's classification (TM-3). The demo keeps HR's changes in its
 * store and applies them here so every engine reads the same value.
 */
export function applyClassifications(overrides: Record<string, Worker["classification"]>) {
  for (const w of workers) w.classification = overrides[w.id] ?? (originalClassifications[w.id] as Worker["classification"]);
}

export function getWorker(id: string): Worker {
  const w = workers.find((x) => x.id === id);
  if (!w) throw new Error(`Unknown worker ${id}`);
  return w;
}

export interface TaxIdRule {
  id: string;
  version: string;
  effectiveFrom: string;
  label: string;
  requiredOver: number;
  description: string;
  illustrative?: boolean;
}

export interface SimpleRule {
  id: string;
  version: string;
  effectiveFrom: string;
  description: string;
  illustrative?: boolean;
}

export interface MileageRule extends SimpleRule {
  effectiveTo?: string;
  ratePerUnit: number;
  unit: "mile" | "km";
}

export interface CountryExpenseRules {
  taxId: TaxIdRule | null;
  receipt: SimpleRule & { requiredOver: number };
  mealTaxFreePerPerson: (SimpleRule & { amount: number }) | null;
  reimbursementFloor?: SimpleRule & { regions: string[] };
  mileage: MileageRule[];
}

export interface CountryRules {
  name: string;
  currency: Currency;
  expenses: CountryExpenseRules;
}

export const countryRules = countryRulesJson.countries as unknown as Record<CountryCode, CountryRules>;
export const fxToUSD = countryRulesJson.fxToUSD as unknown as Record<Currency, number>;

export const seedPolicy = clientPolicyJson as unknown as ClientPolicy;

export const unlockConfig = {
  thresholdPct: unlockJson.unlockThresholdPct,
  minCases: unlockJson.minCases,
  auditSamplePct: unlockJson.auditSamplePct,
};
export const seedCombinations = unlockJson.combinations as Combination[];

export interface SampleReceipt {
  id: string;
  workerId: string;
  label: string;
  scenario: string;
  expectedOutcome: string;
  hidden?: boolean;
  retakeId?: string;
  note: string;
  receipt: {
    merchant: string;
    address: string;
    date: string;
    time: string;
    currency: Currency;
    lines: { desc: string; amount: number }[];
    total: number;
    taxId: string | null;
    covers: number;
    cropped?: boolean;
  };
  read: Omit<AiRead, "source">;
}

export const sampleReceipts = (receiptsJson.receipts as unknown as SampleReceipt[]).map((r) => ({
  ...r,
  receipt: { ...r.receipt, date: addDays(r.receipt.date, shiftDays) },
  read: { ...r.read, date: { ...r.read.date, value: addDays(r.read.date.value, shiftDays) } },
}));

export function getSampleReceipt(id: string) {
  return sampleReceipts.find((r) => r.id === id);
}

export interface SeedExpense {
  id: string;
  workerId: string;
  submittedAt: string;
  data: {
    merchant: string;
    amount: number;
    currency: Currency;
    date: string;
    taxId: string | null;
    category: ExpenseCategory;
    attendees: number;
    note: string;
  };
  decisions: { role: "hr" | "admin"; action: string; at: string; note?: string }[];
}

export const seedExpenses = seedJson.expenses as unknown as SeedExpense[];

// ---- Leave ------------------------------------------------------------------

export interface LeaveRule {
  id: string;
  version: string;
  effectiveFrom: string;
  description?: string;
  source?: string;
  illustrative?: boolean;
}

export interface CountryLeaveRules {
  covered: boolean;
  coverageNote?: string;
  leaveYearStart?: string;
  vacation?: LeaveRule & { minimumDays: number };
  carryover?: LeaveRule & { expiresOn: string; employerMustWarn: boolean };
  sick?: LeaveRule & { shortMaxDays: number; documentAfterDays: number; pay: string };
  paternity?: (LeaveRule & { maxDays: number; pay: string }) | null;
  parental?: (LeaveRule & { pay: string }) | null;
  publicHolidays: { date: string; name: string }[];
}

export const leaveRules = leaveRulesJson.countries as unknown as Record<CountryCode, CountryLeaveRules>;

export const leaveTaken = leaveSeedJson.takenBeforeDemo as Record<string, Record<string, number>>;

export interface SeedLeave {
  id: string;
  workerId: string;
  submittedAt: string;
  data: LeaveData;
  decisions: { role: "hr" | "admin"; action: string; at: string; note?: string }[];
}
export const seedLeave = leaveSeedJson.requests as unknown as SeedLeave[];

// ---- Time -------------------------------------------------------------------

export interface CountryTimeRules {
  covered: boolean;
  coverageNote?: string;
  id: string;
  version: string;
  effectiveFrom: string;
  standardDailyHours: number;
  dailyMax: number | null;
  weeklyMax: number | null;
  monthlyOvertimeCap: number | null;
  minRestHours: number | null;
  breakRule: { afterHours: number; minutes: number; longAfterHours?: number; longMinutes?: number } | null;
  /** Breaks shorter than this are paid working time, so they aren't deducted from hours worked. */
  paidBreakUnderMinutes?: number;
  paidBreakNote?: string;
  statutoryPremiumPct: number;
  prerequisite: string | null;
  dailyLogging: boolean;
  description: string;
  capNote: string;
  illustrative?: boolean;
  source?: string;
}

export const timeRules = timeRulesJson.countries as unknown as Record<CountryCode, CountryTimeRules>;

export interface WorkerTime {
  hourlyRate: number;
  schedule: { start: string; end: string; breakMin: number };
  overtimeEarlierThisMonth: number;
  unplannedPerWeek: number;
}
export const workerTime = timeSeedJson.workers as Record<string, WorkerTime>;

export interface SeedOvertime {
  id: string;
  workerId: string;
  submittedAt: string;
  data: OvertimeData;
  decisions: { role: "hr" | "admin"; action: string; at: string; note?: string }[];
}
export const seedOvertime = timeSeedJson.overtimeRequests as unknown as SeedOvertime[];

export interface SeedTimesheet {
  id: string;
  workerId: string;
  submittedAt: string;
  weekStart: string;
  edits: Record<string, Partial<TimesheetDay>>;
  decisions: { role: "hr" | "admin"; action: string; at: string; note?: string }[];
}
export const seedTimesheets = timeSeedJson.timesheets as unknown as SeedTimesheet[];
