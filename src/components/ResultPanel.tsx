"use client";

import { valueOf } from "@/lib/describe";
import { useDemo } from "@/lib/store";
import type { AnyRequest } from "@/lib/types";
import { ChecksList, ExplanationCard, PipelineTrace } from "./request-parts";
import { Button, Card, cx, Eyebrow } from "./ui";

/** What the worker sees right after submitting: where it went, why, and a shortcut to see it from the other side. */
export function ResultPanel({ req, onDone, onFix }: { req: AnyRequest; onDone(): void; onFix?(): void }) {
  const demo = useDemo();
  const o = req.routing.outcome;
  const shadow = req.routing.shadowWould;
  const m =
    o === "auto_clear"
      ? req.kind === "expense"
        ? { title: "Cleared every check", sub: "No Pebl HR touch needed.", cls: "border-admin bg-admin-bg" }
        : { title: "Approved automatically", sub: req.kind === "leave" ? "Protected leave the employer can't refuse. Your manager is notified to plan cover." : "Within every limit. Your manager is notified.", cls: "border-admin bg-admin-bg" }
      : o === "manager"
        ? { title: req.kind === "timesheet" ? "Sent to your manager to confirm" : "Sent to your manager", sub: req.kind === "timesheet" ? "Hours you've worked are paid either way." : "Compliance is already checked. They get a decision card with an AI suggestion.", cls: "border-admin bg-admin-bg" }
        : o === "back_to_worker"
          ? { title: "One thing to fix", sub: "Caught at submission, so it hasn't reached your manager or HR.", cls: "border-worker bg-worker-bg" }
          : { title: req.kind === "timesheet" && !shadow ? "Sent to Pebl HR as an incident" : "Sent to Pebl HR", sub: shadow ? `Shadow mode for ${req.routing.combination}: HR still decides while the system proves itself.` : "A specialist reviews it with the analysis already done. Nothing is denied automatically.", cls: "border-hr bg-hr-bg" };

  const next = o === "hr_exception" ? { role: "hr" as const, label: "See it as Pebl HR →", variant: "hr" as const } : o === "back_to_worker" ? null : { role: "admin" as const, label: o === "manager" ? (req.kind === "timesheet" ? "Confirm it as the manager →" : "Decide as the manager →") : "See the manager's notification →", variant: "primary" as const };

  return (
    <div className="grid gap-5">
      <div className={cx("rounded-xl border-l-4 px-5 py-4", m.cls)}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-extrabold">{m.title}</h2>
          <span className="font-mono text-sm text-muted">
            {req.id} · {valueOf(req)}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">{m.sub}</p>
      </div>
      <ExplanationCard explanation={req.explanations.worker} label="What happens next" tone={o === "back_to_worker" ? "worker" : "ai"} />
      <div className="flex flex-wrap gap-2">
        {o === "back_to_worker" && onFix && (
          <Button variant="worker" onClick={onFix}>
            Fix it
          </Button>
        )}
        {next && (
          <Button variant={next.variant} onClick={() => demo.go(next.role, next.role === "hr" ? "queue" : o === "manager" ? "decisions" : "updates")}>
            {next.label}
          </Button>
        )}
        <Button onClick={onDone}>Done</Button>
      </div>
      <Card className="grid gap-5 p-5">
        <div>
          <Eyebrow className="mb-2">How it was routed</Eyebrow>
          <PipelineTrace req={req} />
        </div>
        <ChecksList checks={req.evaluation.checks} />
      </Card>
    </div>
  );
}
