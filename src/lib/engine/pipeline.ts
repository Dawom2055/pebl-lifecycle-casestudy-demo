import { client, getWorker, hrSpecialist, seedExpenses, seedLeave, seedOvertime, seedTimesheets, DEMO_TODAY } from "../data";
import type {
  AnyRequest,
  Audience,
  ClientPolicy,
  Combination,
  ExpenseData,
  ExpenseRequest,
  HistoryEntry,
  LeaveData,
  LeaveRequest,
  OvertimeData,
  OvertimeRequest,
  RequestKind,
  RequestStatus,
  Routing,
  TimesheetData,
  TimesheetRequest,
} from "../types";
import { evaluateExpense, routeExpense } from "./expenses";
import { templateExplanation } from "./explain";
import { evaluateLeave, routeLeave } from "./leave";
import { evaluateOvertime, evaluateTimesheet, prefillWeek, routeOvertime, routeTimesheet } from "./time";

export function statusFor(kind: RequestKind, routing: Routing): RequestStatus {
  if (routing.outcome === "back_to_worker") return "needs_fix";
  if (routing.outcome === "hr_exception") return "hr_review";
  if (routing.outcome === "manager") return "awaiting_admin";
  // Auto-clear: an expense still lands on the admin's one-tap card; leave and time are approved outright.
  if (kind === "expense") return routing.clientAutoApproved ? "approved" : "awaiting_admin";
  return "approved";
}

/** Who needs an explanation for each outcome. */
export function audiencesFor(kind: RequestKind, routing: Routing): Audience[] {
  if (routing.outcome === "back_to_worker") return ["worker"];
  if (routing.outcome === "hr_exception") return kind === "leave" ? ["worker", "hr", "admin"] : ["worker", "hr"];
  return ["worker", "admin"];
}

interface Common {
  id: string;
  workerId: string;
  submittedAt: string;
  policy: ClientPolicy;
  combinations: Combination[];
  existing: AnyRequest[];
  fixCount?: number;
  history?: HistoryEntry[];
}

/** Stamps status, the audit trail and template explanations onto a freshly routed request. */
function finish<R extends AnyRequest>(req: R, checked: number): R {
  const worker = getWorker(req.workerId);
  req.status = statusFor(req.kind, req.routing);
  if (req.kind !== "expense" && req.routing.outcome === "auto_clear") req.managerNotice = { acknowledged: false };
  req.history = [
    ...req.history,
    { at: req.submittedAt, actor: worker.name, role: "employee", action: req.fixCount ? "Resubmitted" : "Submitted" },
    { at: req.submittedAt, actor: "Rules engine", role: "system", action: `Checked ${checked} rules: ${req.evaluation.result}` },
    { at: req.submittedAt, actor: "Risk router", role: "system", action: routeLabel(req) },
  ];
  for (const a of audiencesFor(req.kind, req.routing)) req.explanations[a] = templateExplanation(req, worker, a);
  return req;
}

const base = (a: Common) => ({
  id: a.id,
  workerId: a.workerId,
  submittedAt: a.submittedAt,
  status: "hr_review" as RequestStatus,
  explanations: {},
  history: a.history ?? [],
  fixCount: a.fixCount ?? 0,
});

export function runExpensePipeline(a: Common & { data: ExpenseData }): ExpenseRequest {
  const worker = getWorker(a.workerId);
  const expenses = a.existing.filter((r): r is ExpenseRequest => r.kind === "expense");
  const evaluation = evaluateExpense(a.data, worker, a.policy, expenses, a.id);
  const routing = routeExpense(a.data, worker, evaluation, a.policy, a.combinations, a.fixCount ?? 0);
  return finish({ ...base(a), kind: "expense", data: a.data, evaluation, routing }, evaluation.checks.length);
}

export function runLeavePipeline(a: Common & { data: LeaveData; asOf?: string }): LeaveRequest {
  const worker = getWorker(a.workerId);
  const { evaluation, insight } = evaluateLeave(a.data, worker, a.policy, a.existing, a.id, a.asOf ?? DEMO_TODAY);
  const routing = routeLeave(a.data, worker, evaluation, insight, a.policy, a.combinations, a.fixCount ?? 0);
  return finish({ ...base(a), kind: "leave", data: a.data, evaluation, routing, insight }, evaluation.checks.length);
}

export function runOvertimePipeline(a: Common & { data: OvertimeData; asOf?: string }): OvertimeRequest {
  const worker = getWorker(a.workerId);
  const { evaluation, insight } = evaluateOvertime(a.data, worker, a.policy, a.existing, a.id, a.asOf ?? DEMO_TODAY);
  const routing = routeOvertime(worker, evaluation, a.policy, a.combinations);
  return finish({ ...base(a), kind: "overtime", data: a.data, evaluation, routing, insight }, evaluation.checks.length);
}

export function runTimesheetPipeline(a: Common & { data: TimesheetData }): TimesheetRequest {
  const worker = getWorker(a.workerId);
  const { evaluation, insight } = evaluateTimesheet(a.data, worker, a.policy, a.existing, a.id);
  const routing = routeTimesheet(worker, evaluation, insight, a.combinations);
  return finish({ ...base(a), kind: "timesheet", data: a.data, evaluation, routing, insight }, evaluation.checks.length);
}

export function routeLabel(req: AnyRequest) {
  const r = req.routing;
  if (r.outcome === "back_to_worker") return "Sent back to the worker to fix";
  if (r.outcome === "auto_clear") {
    if (req.kind === "expense" && r.advisories?.length) return `Sent to the client admin's card with a disclaimer: ${r.advisories.map((x) => x.label.toLowerCase()).join(", ")}`;
    if (req.kind === "expense") return r.clientAutoApproved ? "Auto-cleared and auto-approved under the client's limit" : "Auto-cleared to the client admin's card";
    return r.clientAutoApproved ? "Approved automatically under the client's policy; manager notified" : "Approved automatically; manager notified";
  }
  if (r.outcome === "manager") return req.kind === "timesheet" ? "Sent to the manager to confirm" : "Sent to the manager's decision card";
  if (r.shadowWould) return `Shadow mode: sent to HR (system would have ${r.shadowWould === "auto_clear" ? "approved it automatically" : r.shadowWould === "manager" ? "sent it to the manager" : "flagged it"})`;
  return `Sent to Pebl HR (${r.signals.length} signal${r.signals.length === 1 ? "" : "s"})`;
}

// ---------------------------------------------------------------------------
// Seed data: run through the same pipeline, then replay what people did.
// ---------------------------------------------------------------------------

export function buildSeedRequests(policy: ClientPolicy, combinations: Combination[]): AnyRequest[] {
  const out: AnyRequest[] = [];
  const ctx = (s: { id: string; workerId: string; submittedAt: string }) => ({ ...s, policy, combinations, existing: out });

  for (const s of seedExpenses) {
    const req = runExpensePipeline({ ...ctx(s), data: { ...s.data, receipt: { kind: "attached", name: "receipt.jpg" } } });
    for (const d of s.decisions) applySeedDecision(req, d);
    out.push(req);
  }
  for (const s of seedLeave) {
    const req = runLeavePipeline({ ...ctx(s), data: s.data, asOf: s.submittedAt.slice(0, 10) });
    for (const d of s.decisions) applySeedDecision(req, d);
    out.push(req);
  }
  for (const s of seedOvertime) {
    const req = runOvertimePipeline({ ...ctx(s), data: s.data, asOf: s.submittedAt.slice(0, 10) });
    for (const d of s.decisions) applySeedDecision(req, d);
    out.push(req);
  }
  for (const s of seedTimesheets) {
    const worker = getWorker(s.workerId);
    const days = prefillWeek(worker, out, s.weekStart).map((d) => ({ ...d, ...(s.edits[d.date] ?? {}) }));
    const req = runTimesheetPipeline({ ...ctx(s), data: { weekStart: s.weekStart, days, note: "" } });
    for (const d of s.decisions) applySeedDecision(req, d);
    out.push(req);
  }
  return out;
}

function applySeedDecision(req: AnyRequest, d: { role: "hr" | "admin"; action: string; at: string; note?: string }) {
  if (d.role === "hr" && d.action === "clear") {
    req.status = req.kind === "expense" ? "awaiting_admin" : "approved";
    req.hrDecision = { action: "clear" };
    req.history.push({ at: d.at, actor: hrSpecialist.name, role: "hr", action: "Cleared", note: d.note });
  } else if (d.role === "admin" && d.action === "approve") {
    req.status = "approved";
    req.history.push({ at: d.at, actor: client.admin.name, role: "admin", action: req.kind === "expense" ? "Approved; sent to payroll" : "Approved" });
  }
}
