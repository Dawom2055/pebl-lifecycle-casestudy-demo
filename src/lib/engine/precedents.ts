import precedentsJson from "@data/hr-precedents.json";
import type { AnyRequest, Combination, RoutingSignal } from "../types";

/**
 * Assistance for Pebl HR: how similar exceptions were resolved before. "Similar" means the same
 * request type sent to HR by the same flag. Past figures come from HR's decision history (the
 * last 90 days, illustrative in the demo), plus anything HR decided in this session. In shadow
 * mode the comparison is HR's agreement with the system for that country and request type.
 */
interface PastCases {
  cases: number;
  cleared: number;
  askedInfo: number;
  denied: number;
  medianMinutes: number;
  usualAction: "clear" | "request_info";
  usualNote: string;
}

const PAST = precedentsJson.cases as Record<string, PastCases>;
export const PRECEDENT_WINDOW_DAYS = precedentsJson.windowDays;

/** Which flag counts as "the reason it's here", most decisive first. */
const PRIORITY: RoutingSignal["id"][] = [
  "duplicate",
  "risky_decline",
  "admin_referral",
  "repeat_fix",
  "limit",
  "rest",
  "rules_fail",
  "tier",
  "no_rule",
  "duration",
  "cross_check",
  "low_confidence",
  "amount",
  "rules_borderline",
  "anomaly",
  "always_review",
];

export interface SessionCase {
  id: string;
  action: "clear" | "request_info" | "deny";
  note?: string;
}

export type Similar =
  | ({ type: "history"; reason: string; inSession: SessionCase[] } & PastCases)
  | { type: "shadow"; reason: string; combination: string; cases: number; agreements: number; would: string; inSession: SessionCase[] };

/** The flag that sent this request to HR, ignoring disclaimers for the client admin and shadow mode. */
export function primarySignal(req: AnyRequest): RoutingSignal | null {
  const advisory = new Set((req.routing.advisories ?? []).map((a) => a.label));
  const core = req.routing.signals.filter((s) => s.id !== "not_unlocked" && !advisory.has(s.label));
  for (const id of PRIORITY) {
    const hit = core.find((s) => s.id === id);
    if (hit) return hit;
  }
  return core[0] ?? null;
}

const keyOf = (req: AnyRequest) => {
  const s = primarySignal(req);
  return s ? `${req.kind}:${s.id}` : req.routing.shadowWould ? `shadow:${req.routing.combination}` : null;
};

export function similarCases(req: AnyRequest, requests: AnyRequest[], combinations: Combination[]): Similar | null {
  const key = keyOf(req);
  if (!key) return null;

  // Decisions HR made in this session on requests sent here for the same reason.
  const inSession: SessionCase[] = requests
    .filter((r) => r.id !== req.id && r.hrDecision && keyOf(r) === key)
    .map((r) => ({ id: r.id, action: r.hrDecision!.action, note: [...r.history].reverse().find((h) => h.role === "hr")?.note }));

  if (key.startsWith("shadow:")) {
    const combo = combinations.find((c) => c.key === req.routing.combination);
    if (!combo) return null;
    const would = req.routing.shadowWould === "auto_clear" ? "cleared it automatically" : req.routing.shadowWould === "manager" ? "sent it to the manager" : "flagged it";
    return { type: "shadow", reason: "Shadow mode", combination: combo.key, cases: combo.shadowCases, agreements: combo.agreements, would, inSession };
  }

  const past = PAST[key];
  if (!past) return inSession.length ? { type: "history", reason: primarySignal(req)!.label, inSession, cases: 0, cleared: 0, askedInfo: 0, denied: 0, medianMinutes: 0, usualAction: "clear", usualNote: "" } : null;
  return { type: "history", reason: primarySignal(req)!.label, inSession, ...past };
}

/** "94%" */
export const pct = (n: number, of: number) => `${of ? Math.round((n / of) * 100) : 0}%`;
