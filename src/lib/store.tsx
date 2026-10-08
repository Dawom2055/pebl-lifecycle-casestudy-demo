"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { applyClassifications, client, DEMO_TODAY, getWorker, hrSpecialist, seedCombinations, seedPolicy, unlockConfig } from "./data";
import { rangeLabel } from "./calendar";
import { templateExplanation } from "./engine/explain";
import { audiencesFor, buildSeedRequests, runExpensePipeline, runLeavePipeline, runOvertimePipeline, runTimesheetPipeline } from "./engine/pipeline";
import { evaluateOvertime } from "./engine/time";
import type {
  AnyRequest,
  Audience,
  ClientPolicy,
  Combination,
  CountryCode,
  ExpenseData,
  ExpensePolicy,
  Explanation,
  LeaveData,
  LeavePolicy,
  OvertimeCountryPolicy,
  OvertimeData,
  Role,
  TimesheetData,
  Worker,
  WorkingHoursPolicy,
} from "./types";

const STORAGE_KEY = "pebl-demo-v4";

export type Section = string;

interface DemoState {
  requests: AnyRequest[];
  policy: ClientPolicy;
  combinations: Combination[];
  nextId: Record<"EXP" | "LV" | "OT" | "TS", number>;
  classifications: Record<string, Worker["classification"]>;
  role: Role;
  actingWorkerId: string;
  section: Record<Role, Section>;
  /** The "Pebl AI" explainer page, outside the three roles. */
  aiPage?: boolean;
}

function initialState(): DemoState {
  applyClassifications({});
  const policy = structuredClone(seedPolicy);
  const combinations = structuredClone(seedCombinations);
  const requests = buildSeedRequests(policy, combinations);
  // The random 5% audit sample of requests that skipped HR (EXP-12, LV-14, TM-16).
  for (const r of requests) if (skippedHr(r) && sampledForAudit(r.id)) r.auditSampled = true;
  if (!requests.some((r) => r.auditSampled)) {
    const first = requests.find(skippedHr);
    if (first) first.auditSampled = true;
  }
  return {
    requests,
    policy,
    combinations,
    nextId: { EXP: 2001, LV: 4101, OT: 3101, TS: 3201 },
    classifications: {},
    role: "employee",
    actingWorkerId: "w-muhammad",
    section: { employee: "home", admin: "decisions", hr: "queue" },
  };
}

function skippedHr(r: AnyRequest) {
  return r.status === "approved" && !r.hrDecision && r.routing.outcome !== "hr_exception";
}

function load(): DemoState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DemoState) : null;
  } catch {
    return null;
  }
}

function save(state: DemoState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota or private mode: drop uploaded images and retry once.
    try {
      const slim = {
        ...state,
        requests: state.requests.map((r) => (r.kind === "expense" ? { ...r, data: { ...r.data, receipt: { ...r.data.receipt, imageUrl: undefined } } } : r)),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch {
      /* ignore */
    }
  }
}

function demoNow() {
  return `${DEMO_TODAY}T${new Date().toISOString().slice(11, 19)}Z`;
}

/** Deterministic 5% sample so the audit queue is stable across reloads. */
function sampledForAudit(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % Math.round(100 / unlockConfig.auditSamplePct) === 0;
}

export interface Toast {
  id: number;
  text: string;
  tone: "ok" | "info" | "warn";
}

interface Store extends DemoState {
  ready: boolean;
  aiConnected: boolean | null;
  toasts: Toast[];
  setRole(role: Role): void;
  openAiPage(): void;
  setSection(role: Role, section: Section): void;
  go(role: Role, section: Section): void;
  setActingWorker(id: string): void;
  submitExpense(workerId: string, data: ExpenseData, replaceId?: string): AnyRequest;
  submitLeave(workerId: string, data: LeaveData, replaceId?: string): AnyRequest;
  submitOvertime(workerId: string, data: OvertimeData): AnyRequest;
  submitTimesheet(workerId: string, data: TimesheetData, replaceId?: string): AnyRequest;
  adminApprove(id: string, opts?: { hours?: number; note?: string }): void;
  adminDecline(id: string, reason: string, alt?: { start: string; end: string }): void;
  adminSuggestDates(id: string, start: string, end: string, note: string): void;
  adminContactHr(id: string, note: string): void;
  acknowledge(id: string): void;
  hrClear(id: string, note: string): void;
  hrRequestInfo(id: string, note: string): void;
  hrDeny(id: string, reason: string): void;
  workerRespond(id: string, note: string): void;
  acceptSuggestion(id: string): void;
  withdraw(id: string): void;
  resolveAudit(id: string, result: "no_issue" | "issue"): void;
  updateExpensePolicy(patch: Partial<ExpensePolicy>): void;
  updateLeavePolicy(patch: Partial<LeavePolicy>): void;
  updateOvertimePolicy(country: CountryCode, patch: Partial<OvertimeCountryPolicy>): void;
  updateWorkingHours(country: CountryCode, patch: Partial<WorkingHoursPolicy>): void;
  setClassification(workerId: string, c: Worker["classification"]): void;
  unlockCombination(key: string): void;
  resetCombination(key: string, reason: string): void;
  reset(): void;
  toast(text: string, tone?: Toast["tone"]): void;
}

const Ctx = createContext<Store | null>(null);

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DemoState>(() => initialState());
  const [ready, setReady] = useState(false);
  const [aiConnected, setAiConnected] = useState<boolean | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Load saved demo state after mount (localStorage isn't available during SSR).
  useEffect(() => {
    const saved = load();
    if (saved) {
      applyClassifications(saved.classifications ?? {});
      stateRef.current = saved;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from browser storage
      setState(saved);
    }
    setReady(true);
    fetch("/api/ai/status")
      .then((r) => r.json())
      .then((s: { connected: boolean }) => setAiConnected(s.connected))
      .catch(() => setAiConnected(false));
  }, []);

  useEffect(() => {
    if (ready) save(state);
  }, [state, ready]);

  const toast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  /** Applies a change to state and the ref together, so later actions in the same tick see it. */
  const commit = useCallback((fn: (s: DemoState) => DemoState) => {
    const next = fn(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);

  const patchRequest = useCallback(
    (id: string, fn: (r: AnyRequest) => AnyRequest) => commit((s) => ({ ...s, requests: s.requests.map((r) => (r.id === id ? fn(r) : r)) })),
    [commit],
  );

  /** Ask Claude to rewrite the template explanations. Templates stay if Claude isn't available. */
  const enrich = useCallback(
    (req: AnyRequest, audiences: Audience[]) => {
      if (!aiConnected) return;
      for (const audience of audiences) {
        patchRequest(req.id, (r) => withExplanation(r, audience, { ...r.explanations[audience]!, pending: true }));
        const slim = req.kind === "expense" ? { ...req, data: { ...req.data, receipt: { kind: req.data.receipt.kind } } } : req;
        fetch("/api/ai/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ req: slim, audience }) })
          .then(async (res) => {
            if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
            return (await res.json()) as Explanation;
          })
          .then((e) => patchRequest(req.id, (r) => withExplanation(r, audience, e)))
          .catch((err) => {
            console.warn("AI explanation failed; keeping template", err);
            patchRequest(req.id, (r) => withExplanation(r, audience, { ...r.explanations[audience]!, pending: false }));
          });
      }
    },
    [aiConnected, patchRequest],
  );

  /** Adds a newly routed request (or replaces a resubmitted one), then asks Claude for explanations. */
  const place = useCallback(
    (req: AnyRequest, prefix: keyof DemoState["nextId"], replacing: boolean) => {
      if (skippedHr(req) && sampledForAudit(req.id)) req.auditSampled = true;
      commit((s) => ({
        ...s,
        nextId: replacing ? s.nextId : { ...s.nextId, [prefix]: s.nextId[prefix] + 1 },
        requests: replacing ? s.requests.map((r) => (r.id === req.id ? req : r)) : [req, ...s.requests],
      }));
      enrich(req, audiencesFor(req.kind, req.routing));
      return req;
    },
    [commit, enrich],
  );

  const common = useCallback((workerId: string, prefix: keyof DemoState["nextId"], replaceId?: string) => {
    const s = stateRef.current;
    const previous = replaceId ? s.requests.find((r) => r.id === replaceId) : undefined;
    return {
      id: previous?.id ?? `${prefix}-${s.nextId[prefix]}`,
      workerId,
      submittedAt: demoNow(),
      policy: s.policy,
      combinations: s.combinations,
      existing: s.requests,
      fixCount: previous ? previous.fixCount + 1 : 0,
      history: previous?.history,
      replacing: !!previous,
    };
  }, []);

  /** Logs HR's decision against the system's recommendation for shadow mode and threshold tuning. */
  const recordHrDecision = useCallback(
    (r: AnyRequest, action: "clear" | "request_info" | "deny") => {
      const would = r.routing.shadowWould;
      const agreed = would === undefined ? undefined : would !== "hr_exception" ? action === "clear" : true;
      if (would !== undefined) {
        commit((s) => ({
          ...s,
          combinations: s.combinations.map((c) =>
            c.key === r.routing.combination
              ? { ...c, shadowCases: c.shadowCases + 1, agreements: c.agreements + (agreed ? 1 : 0), misses: c.misses + (would !== "hr_exception" && action === "deny" ? 1 : 0) }
              : c,
          ),
        }));
      }
      return { action, agreedWithSystem: agreed };
    },
    [commit],
  );

  const find = (id: string) => stateRef.current.requests.find((x) => x.id === id);

  const store: Store = useMemo(
    () => ({
      ...state,
      ready,
      aiConnected,
      toasts,
      toast,
      setRole: (role) => commit((s) => ({ ...s, role, aiPage: false })),
      openAiPage: () => commit((s) => ({ ...s, aiPage: true })),
      setSection: (role, section) => commit((s) => ({ ...s, section: { ...s.section, [role]: section } })),
      go: (role, section) => commit((s) => ({ ...s, role, aiPage: false, section: { ...s.section, [role]: section } })),
      setActingWorker: (id) => commit((s) => ({ ...s, actingWorkerId: id })),

      submitExpense: (workerId, data, replaceId) => {
        const c = common(workerId, "EXP", replaceId);
        return place(runExpensePipeline({ ...c, data }), "EXP", c.replacing);
      },
      submitLeave: (workerId, data, replaceId) => {
        const c = common(workerId, "LV", replaceId);
        return place(runLeavePipeline({ ...c, data }), "LV", c.replacing);
      },
      submitOvertime: (workerId, data) => {
        const c = common(workerId, "OT");
        return place(runOvertimePipeline({ ...c, data }), "OT", false);
      },
      submitTimesheet: (workerId, data, replaceId) => {
        const c = common(workerId, "TS", replaceId);
        return place(runTimesheetPipeline({ ...c, data }), "TS", c.replacing);
      },

      adminApprove: (id, opts) => {
        const r = find(id);
        if (!r) return;
        let next: AnyRequest = { ...r, status: "approved" };
        if (r.kind === "overtime" && opts?.hours && opts.hours < r.data.hours) {
          const data = { ...r.data, hours: opts.hours };
          const { evaluation, insight } = evaluateOvertime(data, getWorker(r.workerId), stateRef.current.policy, stateRef.current.requests, r.id, r.submittedAt.slice(0, 10));
          next = { ...r, status: "approved", data, evaluation, insight };
        }
        const action =
          r.kind === "expense" ? "Approved; sent to payroll" : r.kind === "timesheet" ? "Confirmed; sent to payroll" : opts?.hours ? `Approved ${opts.hours} of ${r.kind === "overtime" ? r.data.hours : ""} hours` : "Approved";
        next = log(next, "admin", action, opts?.note);
        if (!r.hrDecision && sampledForAudit(r.id)) next.auditSampled = true;
        patchRequest(id, () => next);
        toast(r.kind === "leave" ? "Approved. Balance and payroll updated." : r.kind === "overtime" ? "Approved. The worker can go ahead." : "Approved. It goes out in the next payroll run.");
      },
      adminDecline: (id, reason, alt) => {
        const r = find(id);
        if (!r) return;
        const note = alt ? `${reason} Suggested instead: ${rangeLabel(alt.start, alt.end)}.` : reason;
        // LV-9: a decline that would stop the worker using their legal minimum goes to HR, not straight through.
        if (r.kind === "leave" && r.insight.legalRisk) {
          const routing = {
            ...r.routing,
            outcome: "hr_exception" as const,
            signals: [
              ...r.routing.signals,
              { id: "risky_decline" as const, label: "Decline risks the legal minimum", detail: `The manager declined ${rangeLabel(r.data.start, r.data.end)}, which uses days that expire ${r.insight.expiring ? rangeLabel(r.insight.expiring.date, r.insight.expiring.date) : "at year end"}. Declining could leave the worker below the legal minimum.` },
            ],
          };
          const moved: AnyRequest = { ...log(r, "admin", "Declined; moved to Pebl HR (risks the legal minimum)", note), status: "hr_review", routing };
          moved.explanations = { ...moved.explanations, hr: templateExplanation(moved, getWorker(r.workerId), "hr") };
          patchRequest(id, () => moved);
          enrich(moved, ["hr"]);
          toast("This decline risks the legal minimum, so it went to Pebl HR.", "warn");
          return;
        }
        patchRequest(id, (x) => ({ ...log(x, "admin", "Declined", note), status: "denied" }));
        toast("Declined. The worker sees your reason.", "info");
      },
      adminSuggestDates: (id, start, end, note) => {
        patchRequest(id, (r) => ({ ...log(r, "admin", `Suggested other dates: ${rangeLabel(start, end)}`, note || undefined), status: "changes_suggested", suggestion: { start, end, note } }));
        toast("Sent to the worker with your suggested dates.", "info");
      },
      adminContactHr: (id, note) => {
        const r = find(id);
        if (!r) return;
        const first = getWorker(r.workerId).name.split(" ")[0];
        const routing = {
          ...r.routing,
          outcome: "hr_exception" as const,
          signals: [...r.routing.signals, { id: "admin_referral" as const, label: "Client admin asked HR", detail: `${client.admin.name} asked Pebl HR to review this before deciding: “${note}”` }],
        };
        const explanations = {
          ...r.explanations,
          worker: { text: `${client.name} asked Pebl's local HR team to take a look before deciding. Nothing for you to do yet; we'll let you know if anything is needed.`, source: "template" as const },
          hr: {
            text: `Flagged: ${client.admin.name} wants Pebl HR's view on ${first}'s request before deciding. Their question: “${note}”`,
            source: "template" as const,
            suggestedAction: "Answer the question, then clear it back to the client admin or deny with a reason.",
          },
        };
        const moved: AnyRequest = { ...log(r, "admin", "Contacted Pebl HR", note), status: "hr_review", routing, explanations };
        patchRequest(id, () => moved);
        enrich(moved, ["hr"]);
        toast("Sent to Pebl HR with your question.", "info");
      },
      acknowledge: (id) => patchRequest(id, (r) => ({ ...r, managerNotice: { acknowledged: true } })),

      hrClear: (id, note) => {
        const r = find(id);
        if (!r) return;
        const hrDecision = recordHrDecision(r, "clear");
        const worker = getWorker(r.workerId);
        // Expenses and time: Pebl HR is never the final approver. Its review and notes go to the client admin, who decides.
        // The same goes for anything the client admin sent to HR themselves.
        const referred = r.routing.signals.some((s) => s.id === "admin_referral");
        if (r.kind !== "leave" || referred) {
          const asAdmin: AnyRequest = { ...r, hrDecision, routing: { ...r.routing, outcome: r.kind === "expense" ? "auto_clear" : "manager" } };
          const admin = templateExplanation(asAdmin, worker, "admin");
          const next: AnyRequest = {
            ...log(r, "hr", referred ? "Answered the client admin; sent back to them" : "Cleared; sent to the client admin", note || undefined),
            status: "awaiting_admin",
            hrDecision,
            explanations: { ...r.explanations, admin, ...(referred ? { worker: templateExplanation(asAdmin, worker, "worker") } : {}) },
          };
          patchRequest(id, () => next);
          enrich({ ...next, routing: asAdmin.routing }, ["admin"]);
          toast("Cleared. Your review and notes are on the client admin's decision card.");
        } else {
          patchRequest(id, (x) => ({ ...log(x, "hr", "Cleared; manager notified", note || undefined), status: "approved", hrDecision, managerNotice: { acknowledged: false } }));
          toast("Cleared. The manager is notified and payroll updated.");
        }
      },
      hrRequestInfo: (id, note) => {
        const r = find(id);
        if (!r) return;
        const hrDecision = recordHrDecision(r, "request_info");
        patchRequest(id, (x) => ({ ...log(x, "hr", "Asked the worker for more information", note), status: "info_requested", hrDecision }));
        toast("Sent to the worker with your question.", "info");
      },
      hrDeny: (id, reason) => {
        const r = find(id);
        if (!r) return;
        const hrDecision = recordHrDecision(r, "deny");
        patchRequest(id, (x) => ({ ...log(x, "hr", r.kind === "leave" ? "Not eligible" : "Denied", reason), status: "denied", hrDecision }));
        toast("Done. The worker sees your reason.", "warn");
      },
      workerRespond: (id, note) => {
        patchRequest(id, (r) => ({ ...log(r, "employee", "Replied to HR", note), status: "hr_review" }));
        toast("Sent back to Pebl HR.");
      },
      acceptSuggestion: (id) => {
        const r = find(id);
        if (!r || r.kind !== "leave" || !r.suggestion) return;
        const c = common(r.workerId, "LV", id);
        const req = place(runLeavePipeline({ ...c, data: { ...r.data, start: r.suggestion.start, end: r.suggestion.end }, fixCount: 0 }), "LV", true);
        toast(req.status === "awaiting_admin" ? "New dates sent to your manager." : "New dates submitted.");
      },
      withdraw: (id) => {
        patchRequest(id, (r) => ({ ...log(r, "employee", "Withdrew the request"), status: "withdrawn" }));
        toast("Withdrawn.", "info");
      },
      resolveAudit: (id, result) => {
        patchRequest(id, (r) => ({ ...log(r, "hr", result === "no_issue" ? "Audit: no issue found" : "Audit: issue found"), auditResult: result }));
        toast(result === "no_issue" ? "Audit logged: no issue." : "Audit issue logged. Compliance reviews the combination.", result === "no_issue" ? "ok" : "warn");
      },

      updateExpensePolicy: (patch) => {
        commit((s) => ({ ...s, policy: bump({ ...s.policy, expenses: { ...s.policy.expenses, ...patch } }) }));
        toast("Policy saved. New requests use the new version; past decisions keep theirs.");
      },
      updateLeavePolicy: (patch) => {
        commit((s) => ({ ...s, policy: bump({ ...s.policy, leave: { ...s.policy.leave, ...patch } }) }));
        toast("Leave policy saved as a new version.");
      },
      updateWorkingHours: (country, patch) => {
        commit((s) => ({ ...s, policy: bump({ ...s.policy, workingHours: { ...s.policy.workingHours, [country]: { ...s.policy.workingHours[country], ...patch } } }) }));
        toast("Working hours saved as a new version. New timesheets are pre-filled from them.");
      },
      updateOvertimePolicy: (country, patch) => {
        commit((s) => ({ ...s, policy: bump({ ...s.policy, overtime: { ...s.policy.overtime, [country]: { ...s.policy.overtime[country], ...patch } } }) }));
        toast("Overtime policy saved as a new version.");
      },
      setClassification: (workerId, c) => {
        commit((s) => {
          const classifications = { ...s.classifications, [workerId]: c };
          applyClassifications(classifications);
          return { ...s, classifications };
        });
        toast("Classification saved. It decides which time checks run from now on.");
      },
      unlockCombination: (key) => {
        commit((s) => ({ ...s, combinations: s.combinations.map((c) => (c.key === key ? { ...c, status: "unlocked", unlockedOn: DEMO_TODAY, resetReason: undefined } : c)) }));
        toast(`${key} unlocked. New requests route automatically; HR audits 5%.`);
      },
      resetCombination: (key, reason) => {
        commit((s) => ({ ...s, combinations: s.combinations.map((c) => (c.key === key ? { ...c, status: "shadow", shadowCases: 0, agreements: 0, misses: 0, unlockedOn: undefined, resetReason: reason } : c)) }));
        toast(`${key} is back in shadow mode until it proves itself again.`, "info");
      },
      reset: () => {
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
        const fresh = initialState();
        stateRef.current = fresh;
        setState(fresh);
        toast("Demo reset to the starting data.", "info");
      },
    }),
    [state, ready, aiConnected, toasts, toast, commit, common, place, patchRequest, recordHrDecision, enrich],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

function bump(policy: ClientPolicy): ClientPolicy {
  const [major, minor] = policy.version.split(".").map(Number);
  return { ...policy, version: `${major}.${minor + 1}`, effectiveFrom: DEMO_TODAY };
}

function log<R extends AnyRequest>(r: R, role: Role, action: string, note?: string): R {
  const actor = role === "admin" ? client.admin.name : role === "hr" ? hrSpecialist.name : getWorker(r.workerId).name;
  return { ...r, history: [...r.history, { at: demoNow(), actor, role, action, note }] };
}

function withExplanation(r: AnyRequest, audience: Audience, e: Explanation): AnyRequest {
  return { ...r, explanations: { ...r.explanations, [audience]: e } };
}

export function useDemo() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useDemo must be used inside DemoProvider");
  return s;
}
