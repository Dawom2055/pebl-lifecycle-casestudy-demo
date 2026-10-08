export type Role = "employee" | "admin" | "hr";
export type CountryCode = "UK" | "US" | "CA" | "DE" | "JP";
export type Currency = "GBP" | "USD" | "CAD" | "EUR" | "JPY";
export type Audience = "worker" | "admin" | "hr";

export type Classification = "salaried_overtime_eligible" | "salaried_exempt" | "hourly" | "unclear";

export interface Worker {
  id: string;
  name: string;
  title: string;
  country: CountryCode;
  region?: string;
  currency: Currency;
  team: string;
  classification: Classification;
  usualMealSpend: number;
  startDate: string;
}

// ---- Rules engine output -------------------------------------------------

export type CheckStatus = "pass" | "borderline" | "fail" | "info";
export type RulesResult = "pass" | "borderline" | "fail";
export type RuleLayer = "country" | "client" | "system";

export interface RuleCheck {
  id: string;
  label: string;
  layer: RuleLayer;
  status: CheckStatus;
  detail: string;
  ruleId?: string;
  ruleVersion?: string;
  /** A problem the worker can fix themselves (goes back to the worker, not HR). */
  fixable?: boolean;
}

/** What the decision means for payroll: every module ends there. */
export interface PayrollImpact {
  currency: Currency;
  /** Money moving through payroll: reimbursement, or overtime pay. 0 for leave. */
  amount: number;
  /** Portion reported to payroll as taxable rather than rejected (EXP-13). */
  taxableAmount: number;
  lines: string[];
}

export interface Evaluation {
  result: RulesResult;
  checks: RuleCheck[];
  payroll: PayrollImpact;
}

// ---- Risk router output --------------------------------------------------

/**
 * auto_clear: no HR touch. For expenses it lands on the admin's one-tap card; for leave and
 * timesheets it's approved and the manager is notified.
 * manager: the client manager decides, with an AI suggestion.
 */
export type Outcome = "auto_clear" | "manager" | "back_to_worker" | "hr_exception";

export interface RoutingSignal {
  id:
    | "rules_fail"
    | "rules_borderline"
    | "low_confidence"
    | "cross_check"
    | "anomaly"
    | "duplicate"
    | "amount"
    | "always_review"
    | "not_unlocked"
    | "repeat_fix"
    | "tier"
    | "no_rule"
    | "duration"
    | "negative_balance"
    | "risky_decline"
    | "admin_referral"
    | "unapproved_hours"
    | "rest"
    | "limit";
  label: string;
  detail: string;
}

export interface Routing {
  outcome: Outcome;
  signals: RoutingSignal[];
  combination: string;
  unlocked: boolean;
  /** In shadow mode: what the system would have decided if this combination were unlocked. */
  shadowWould?: Outcome;
  /** Client opted in to auto-approve under its own limit (EXP-15, LV-16, overtime auto mode). */
  clientAutoApproved?: boolean;
  /** Spending flags that don't need Pebl HR: shown to the client admin as a disclaimer for their decision. */
  advisories?: RoutingSignal[];
}

// ---- Request payloads ------------------------------------------------------

export type ExpenseCategory = "meals" | "travel" | "lodging" | "office" | "other";

export interface AiField<T> {
  value: T;
  confidence: number;
}

export interface AiRead {
  merchant: AiField<string>;
  amount: AiField<number>;
  currency: AiField<Currency>;
  date: AiField<string>;
  taxId: AiField<string | null>;
  category: AiField<ExpenseCategory>;
  attendees: AiField<number>;
  source: "sample" | "claude";
}

export interface ReceiptRef {
  kind: "sample" | "upload" | "attached" | "none";
  sampleId?: string;
  name?: string;
  /** Data URL for an uploaded photo (kept small; only for the current session). */
  imageUrl?: string;
}

export interface ExpenseData {
  merchant: string;
  amount: number;
  currency: Currency;
  date: string;
  taxId: string | null;
  category: ExpenseCategory;
  attendees: number;
  note: string;
  receipt: ReceiptRef;
  aiRead?: AiRead;
}

export type LeaveType =
  | "vacation"
  | "sick"
  | "bereavement"
  | "floating"
  | "birthday"
  | "volunteer"
  | "unpaid"
  | "paternity"
  | "parental";

export type LeaveTier = "auto" | "manager" | "hr";

export interface LeaveDocument {
  name: string;
  /** AI read of the document: the name and dates must match the request (LV-4). */
  read: { name: AiField<string>; start: AiField<string>; end: AiField<string> };
}

export interface LeaveData {
  type: LeaveType;
  start: string;
  end: string;
  halfDay: boolean;
  note: string;
  document?: LeaveDocument;
  /** Days beyond the balance taken as unpaid, when the worker accepts the split. */
  unpaidSplit?: number;
}

export interface LeaveInsight {
  tier: LeaveTier;
  workingDays: number;
  holidaysInRange: { date: string; name: string }[];
  balanceBefore: number | null;
  balanceAfter: number | null;
  expiring: { days: number; date: string } | null;
  noticeDays: number;
  teamAway: { name: string; start: string; end: string }[];
  clearRange: { start: string; end: string } | null;
  legalRisk: boolean;
  payTreatment: string;
}

export interface OvertimeData {
  date: string;
  hours: number;
  reason: string;
}

export interface OvertimeInsight {
  limit: number;
  clientLimit: number;
  legalCap: number | null;
  usedBefore: number;
  after: number;
  forecast: number;
  cost: number;
  premiumPct: number;
  remainingAfter: number;
  partialHours: number | null;
  overBudget: boolean;
  prerequisite: string | null;
}

export interface TimesheetDay {
  date: string;
  start: string;
  end: string;
  breakMin: number;
  /** Leave or public holiday: no hours expected. */
  off?: string;
}

export interface TimesheetData {
  weekStart: string;
  days: TimesheetDay[];
  note: string;
}

export interface TimesheetInsight {
  totalHours: number;
  overtimeHours: number;
  preApproved: number;
  unapproved: number;
  monthBefore: number;
  monthAfter: number;
  limit: number;
  legalCap: number | null;
  cost: number;
  premiumPct: number;
  longDays: string[];
  restBreaches: string[];
  breakIssues: string[];
}

// ---- Requests --------------------------------------------------------------

export type RequestStatus =
  | "needs_fix"
  | "awaiting_admin"
  | "hr_review"
  | "info_requested"
  | "changes_suggested"
  | "approved"
  | "denied"
  | "withdrawn";

export interface Explanation {
  text: string;
  /** A short recommendation heading, e.g. "Approve, and plan no more overtime this month". */
  headline?: string;
  suggestedAction?: string;
  source: "ai" | "template";
  pending?: boolean;
}

export interface HistoryEntry {
  at: string;
  actor: string;
  role: Role | "system";
  action: string;
  note?: string;
}

interface BaseRequest {
  id: string;
  workerId: string;
  submittedAt: string;
  status: RequestStatus;
  evaluation: Evaluation;
  routing: Routing;
  explanations: Partial<Record<Audience, Explanation>>;
  history: HistoryEntry[];
  /** How many times this request has been sent back to the worker to fix. */
  fixCount: number;
  /** Logged for shadow mode agreement and threshold tuning. */
  hrDecision?: { action: "clear" | "request_info" | "deny"; agreedWithSystem?: boolean };
  /** Picked for the random 5% audit of requests that skipped HR. */
  auditSampled?: boolean;
  auditResult?: "no_issue" | "issue";
  /** Auto-approved items the manager is told about ("Got it"). */
  managerNotice?: { acknowledged: boolean };
  /** Manager's suggested dates when they ask for a change (leave). */
  suggestion?: { start: string; end: string; note: string };
}

export interface ExpenseRequest extends BaseRequest {
  kind: "expense";
  data: ExpenseData;
}

export interface LeaveRequest extends BaseRequest {
  kind: "leave";
  data: LeaveData;
  insight: LeaveInsight;
}

export interface OvertimeRequest extends BaseRequest {
  kind: "overtime";
  data: OvertimeData;
  insight: OvertimeInsight;
}

export interface TimesheetRequest extends BaseRequest {
  kind: "timesheet";
  data: TimesheetData;
  insight: TimesheetInsight;
}

export type AnyRequest = ExpenseRequest | LeaveRequest | OvertimeRequest | TimesheetRequest;
export type RequestKind = AnyRequest["kind"];

// ---- Policy and trust -----------------------------------------------------

export interface ExpensePolicy {
  mealCapPerPerson: Record<Currency, number>;
  borderlineBandPct: number;
  submitWithinDays: number;
  preApprovalOverUSD: number;
  noAlcohol: boolean;
  flightClass: string;
  autoClearThreshold: Record<Currency, number>;
  optInAutoApproveUnder: Record<Currency, number> | null;
  alwaysReviewCategories: ExpenseCategory[];
  reimburseMileage: boolean;
  anomalyMultiplier: number;
}

export interface LeavePolicy {
  vacationDays: Record<CountryCode, number>;
  carryoverMaxDays: number;
  sickPaidDays: Record<CountryCode, number>;
  noticeDays: number;
  blackouts: { start: string; end: string; label: string }[];
  maxConsecutiveDays: number;
  hrReviewOverDays: number;
  autoApproveVacationUpToDays: number | null;
  bereavementDays: number;
  unpaidShortMaxDays: number;
  perks: Record<"floating" | "birthday" | "volunteer", { days: number; tier: "auto" | "manager" }>;
}

export interface OvertimeCountryPolicy {
  allowed: boolean;
  monthlyLimit: number;
  annualLimit: number;
  mode: "pre_approval" | "auto_within_limit";
  monthlyBudget: number;
  premiumPct: number;
  article36OnFile?: boolean;
}

/** The company's standard working day in one country. Timesheets are pre-filled from it. */
export interface WorkingHoursPolicy {
  start: string;
  end: string;
  breakMin: number;
  daysPerWeek: number;
}

export interface ClientPolicy {
  version: string;
  effectiveFrom: string;
  expenses: ExpensePolicy;
  leave: LeavePolicy;
  workingHours: Record<CountryCode, WorkingHoursPolicy>;
  overtime: Record<CountryCode, OvertimeCountryPolicy>;
}

export interface Combination {
  key: string;
  status: "unlocked" | "shadow";
  shadowCases: number;
  agreements: number;
  misses: number;
  unlockedOn?: string;
  resetReason?: string;
}
