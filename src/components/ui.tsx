"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { RequestStatus } from "@/lib/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export type Actor = "worker" | "ai" | "rules" | "admin" | "hr";

const actorStyles: Record<Actor, string> = {
  worker: "bg-worker-bg text-worker",
  ai: "bg-ai-bg text-ai",
  rules: "bg-rules-bg text-rules",
  admin: "bg-admin-bg text-admin",
  hr: "bg-hr-bg text-hr",
};

export const actorLabel: Record<Actor, string> = {
  worker: "Worker",
  ai: "AI",
  rules: "Rules engine",
  admin: "Client admin",
  hr: "Pebl HR",
};

/** Small pill with a colored dot: who acts at this step. */
export function ActorChip({ actor, children }: { actor: Actor; children?: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", actorStyles[actor])}>
      <span className="size-1.5 rounded-full bg-current" />
      {children ?? actorLabel[actor]}
    </span>
  );
}

const statusMeta: Record<RequestStatus, { label: string; cls: string }> = {
  needs_fix: { label: "Needs a fix", cls: "bg-worker-bg text-worker" },
  awaiting_admin: { label: "Awaiting approval", cls: "bg-admin-bg text-admin" },
  hr_review: { label: "With Pebl HR", cls: "bg-hr-bg text-hr" },
  info_requested: { label: "Info requested", cls: "bg-worker-bg text-worker" },
  changes_suggested: { label: "New dates suggested", cls: "bg-worker-bg text-worker" },
  approved: { label: "Approved", cls: "bg-rules-bg text-rules" },
  denied: { label: "Denied", cls: "bg-danger-bg text-danger" },
  withdrawn: { label: "Withdrawn", cls: "bg-sunken text-muted" },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const m = statusMeta[status];
  return <span className={cx("inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold", m.cls)}>{m.label}</span>;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-xl border border-line bg-surface", className)}>{children}</div>;
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "worker" | "hr";

const variantStyles: Record<Variant, string> = {
  primary: "bg-admin text-white hover:bg-[#17642f] border-admin",
  worker: "bg-worker text-white hover:bg-[#0c5f59] border-worker",
  hr: "bg-hr text-white hover:bg-[#804600] border-hr",
  secondary: "bg-surface text-ink border-line hover:bg-sunken",
  ghost: "bg-transparent text-muted border-transparent hover:bg-sunken hover:text-ink",
  danger: "bg-surface text-danger border-line hover:bg-danger-bg",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variantStyles[variant],
        className,
      )}
    />
  );
}

/** Marks a form field the form can't be submitted without. */
export function Required() {
  return (
    <span className="text-danger" title="Required">
      *
    </span>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("font-mono text-[11.5px] uppercase tracking-[0.06em] text-muted", className)}>{children}</div>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-[15px] text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <div className="font-display text-base font-bold">{title}</div>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function SparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={cx("size-3.5", className)}>
      <path d="M8 0.5l1.6 4.4 4.4 1.6-4.4 1.6L8 12.5 6.4 8.1 2 6.5l4.4-1.6L8 .5zm5 9l.8 2.2 2.2.8-2.2.8L13 15.5l-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
    </svg>
  );
}

/** Confidence for one AI-read field. Below 0.8 means a person should look. */
export function ConfidencePill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const cls = value >= 0.9 ? "text-admin bg-admin-bg" : value >= 0.8 ? "text-hr bg-hr-bg" : "text-danger bg-danger-bg";
  return <span className={cx("rounded px-1.5 py-px font-mono text-[11px] tabular", cls)}>{pct}%</span>;
}

export function Modal({ open, onClose, title, children, wide, xwide }: { open: boolean; onClose(): void; title: string; children: ReactNode; wide?: boolean; xwide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cx("max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-bg shadow-2xl sm:rounded-2xl", xwide ? "sm:max-w-[1240px]" : wide ? "sm:max-w-4xl" : "sm:max-w-lg")}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-bg/95 px-5 py-3 backdrop-blur">
          <h2 className="truncate text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Close">
            <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
