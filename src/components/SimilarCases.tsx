"use client";

import { pct, PRECEDENT_WINDOW_DAYS, similarCases, type Similar } from "@/lib/engine/precedents";
import { useDemo } from "@/lib/store";
import type { AnyRequest } from "@/lib/types";
import { Button, cx, Eyebrow } from "./ui";

/** What "cleared" means for this request type. */
const clearedWord = (req: AnyRequest) => (req.kind === "leave" && !req.routing.signals.some((s) => s.id === "admin_referral") ? "approved" : "sent to the admin");
const sendLabel = (req: AnyRequest) => (clearedWord(req) === "approved" ? "Clear" : "Send to Admin");

/** One-line summary for the HR queue card. */
export function similarSummary(req: AnyRequest, s: Similar | null) {
  if (!s) return null;
  if (s.type === "shadow") return `Shadow mode: HR agreed with the system in ${s.agreements} of ${s.cases} past cases`;
  if (!s.cases) return `${s.inSession.length} similar case${s.inSession.length === 1 ? "" : "s"} decided this session`;
  return `${s.cases} similar cases · ${pct(s.cleared, s.cases)} ${clearedWord(req)}`;
}

/**
 * Assistance for Pebl HR: how exceptions like this one were resolved before, and the note HR
 * usually writes, so a routine case takes one click.
 */
export function SimilarCases({ req, onDone }: { req: AnyRequest; onDone?(): void }) {
  const demo = useDemo();
  const s = similarCases(req, demo.requests, demo.combinations);
  if (!s) return null;
  const canAct = req.status === "hr_review";
  const word = clearedWord(req);

  const apply = (action: "clear" | "request_info", note: string) => {
    if (action === "clear") demo.hrClear(req.id, note);
    else demo.hrRequestInfo(req.id, note);
    onDone?.();
  };

  return (
    <section className="rounded-xl border border-rules/40 bg-rules-bg p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow className="text-rules">Similar cases · {s.reason}</Eyebrow>
        {s.type === "history" && s.cases > 0 && <span className="font-mono text-[11px] text-muted">Last {PRECEDENT_WINDOW_DAYS} days · usually resolved in {s.medianMinutes} min</span>}
      </div>

      {s.type === "shadow" ? (
        <>
          <p className="mt-1.5 text-sm">
            {s.combination} is in shadow mode. In <b>{s.agreements} of {s.cases}</b> past cases ({pct(s.agreements, s.cases)}), HR agreed with the system&apos;s call. Here, the system would have <b>{s.would}</b>.
          </p>
          {canAct && s.would !== "flagged it" && (
            <Button variant="primary" size="sm" className="mt-3" onClick={() => apply("clear", "")}>
              Agree with the system: {sendLabel(req)}
            </Button>
          )}
        </>
      ) : (
        s.cases > 0 && (
          <>
            <p className="mt-1.5 text-sm">
              <b>{s.cases}</b> requests reached HR for the same reason. <b>{pct(s.cleared, s.cases)}</b> were {word}, {pct(s.askedInfo, s.cases)} needed more information, and {pct(s.denied, s.cases)} were denied.
            </p>
            <Outcomes cleared={s.cleared} asked={s.askedInfo} denied={s.denied} />
            <div className="mt-3 rounded-lg bg-surface px-3 py-2 text-sm">
              <span className="font-mono text-[11px] uppercase tracking-wide text-faint">HR&apos;s usual note</span>
              <p className="mt-0.5">“{s.usualNote}”</p>
            </div>
            {canAct && (
              <Button variant={s.usualAction === "clear" ? "primary" : "worker"} size="sm" className="mt-3" onClick={() => apply(s.usualAction, s.usualNote)}>
                {s.usualAction === "clear" ? `${sendLabel(req)} with this note` : "Ask the worker with this note"}
              </Button>
            )}
          </>
        )
      )}

      {s.inSession.length > 0 && (
        <ul className="mt-3 grid gap-1 text-xs text-muted">
          {s.inSession.map((c) => (
            <li key={c.id}>
              <b className="text-ink">{c.id}</b> in this session: {c.action === "clear" ? word : c.action === "request_info" ? "asked for information" : "denied"}
              {c.note ? ` · “${c.note}”` : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Outcomes({ cleared, asked, denied }: { cleared: number; asked: number; denied: number }) {
  const total = cleared + asked + denied || 1;
  const seg = (n: number, cls: string) => (n ? <span className={cx("h-full", cls)} style={{ width: `${(n / total) * 100}%` }} /> : null);
  return (
    <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface" aria-hidden>
      {seg(cleared, "bg-admin")}
      {seg(asked, "bg-worker")}
      {seg(denied, "bg-danger")}
    </div>
  );
}
