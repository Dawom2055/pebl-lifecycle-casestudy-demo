"use client";

import { useState, type ReactNode } from "react";
import { client, countryRules, hrSpecialist, workers } from "@/lib/data";
import type { CountryCode } from "@/lib/types";
import { useDemo } from "@/lib/store";
import type { Role } from "@/lib/types";
import { Button, cx, Modal, SparkIcon } from "./ui";

const roles: { id: Role; label: string; short: string; dot: string }[] = [
  { id: "employee", label: "Employee", short: "Employee", dot: "bg-worker" },
  { id: "admin", label: "Client admin", short: "Admin", dot: "bg-admin" },
  { id: "hr", label: "Pebl HR", short: "HR", dot: "bg-hr" },
];

export interface NavItem {
  id: string;
  label: string;
  count?: number;
  soon?: boolean;
}

/** The page frame. Without `nav`, the page has no sidebar (the Pebl AI page). */
export function AppShell({ nav, children, aside }: { nav?: NavItem[]; children: ReactNode; aside?: ReactNode }) {
  const demo = useDemo();
  const [confirmReset, setConfirmReset] = useState(false);
  const section = demo.section[demo.role];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="font-display text-xl font-extrabold tracking-tight">pebl</span>
            <span className="hidden text-sm text-muted sm:inline">Lifecycle Automation</span>
            <span className="rounded-full border border-line px-2 py-px font-mono text-[10.5px] uppercase tracking-wider text-muted">Demo</span>
          </div>

          <div role="tablist" aria-label="View as" className="order-3 flex w-full rounded-xl bg-sunken p-1 sm:order-none sm:mx-auto sm:w-auto">
            {roles.map((r) => (
              <button
                key={r.id}
                role="tab"
                aria-selected={!demo.aiPage && demo.role === r.id}
                onClick={() => demo.setRole(r.id)}
                className={cx(
                  "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors sm:flex-none sm:px-4",
                  !demo.aiPage && demo.role === r.id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                <span className={cx("size-2 rounded-full", r.dot)} />
                <span className="sm:hidden">{r.short}</span>
                <span className="hidden sm:inline">{r.label}</span>
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2 sm:ml-0">
            <AiStatus />
            <button
              onClick={demo.openAiPage}
              aria-pressed={!!demo.aiPage}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors",
                demo.aiPage ? "border-ai bg-ai text-white" : "border-ai/40 bg-ai-bg text-ai hover:border-ai",
              )}
            >
              <SparkIcon className={demo.aiPage ? "text-white" : "text-ai"} />
              Pebl AI Explained
            </button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>
              Reset demo
            </Button>
          </div>
        </div>
      </header>

      {!nav ? (
        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-6">{children}</main>
      ) : (
        <div className={cx("mx-auto grid w-full flex-1 gap-6 px-4 py-6 sm:px-6 md:grid-cols-[220px_minmax(0,1fr)]", aside ? "max-w-[1640px] xl:grid-cols-[210px_minmax(0,1fr)_380px]" : "max-w-[1240px]")}>
          <aside className="grid content-start gap-4">
            <Persona />
            <nav aria-label="Sections" className="flex gap-1 overflow-x-auto md:grid md:overflow-visible">
              {nav.map((n) => (
                <button
                  key={n.id}
                  disabled={n.soon}
                  onClick={() => demo.setSection(demo.role, n.id)}
                  className={cx(
                    "flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors",
                    section === n.id ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:bg-surface/70 hover:text-ink",
                    n.soon && "cursor-not-allowed opacity-60 hover:bg-transparent",
                  )}
                >
                  {n.label}
                  {n.soon ? (
                    <span className="font-mono text-[10px] uppercase tracking-wide text-faint">next</span>
                  ) : n.count ? (
                    <span className="rounded-full bg-ink px-1.5 text-[11px] text-white tabular">{n.count}</span>
                  ) : null}
                </button>
              ))}
            </nav>
          </aside>
          <main className="min-w-0">{children}</main>
          {aside && <div className="h-[560px] md:col-span-2 xl:sticky xl:top-[76px] xl:col-span-1 xl:h-[calc(100vh-100px)] xl:self-start">{aside}</div>}
        </div>
      )}

      <footer className="border-t border-line px-4 py-4 text-center text-xs text-muted">
        Case study concept by Muhammad Dawood
      </footer>

      <Toasts />

      <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset the demo?">
        <p className="text-sm text-muted">This clears everything submitted or decided in this browser and reloads the starting data.</p>
        <div className="mt-4 flex gap-2">
          <Button
            variant="danger"
            onClick={() => {
              demo.reset();
              setConfirmReset(false);
            }}
          >
            Reset
          </Button>
          <Button variant="ghost" onClick={() => setConfirmReset(false)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </div>
  );
}

const countryName = (code: CountryCode) => countryRules[code].name.replace("United Kingdom", "UK").replace("United States", "US");

function Persona() {
  const demo = useDemo();
  if (demo.role === "employee") {
    const w = workers.find((x) => x.id === demo.actingWorkerId)!;
    return (
      <div className="rounded-xl border border-line bg-surface p-3">
        <label htmlFor="acting" className="font-mono text-[10.5px] uppercase tracking-wider text-faint">
          Signed in as
        </label>
        <select
          id="acting"
          value={demo.actingWorkerId}
          onChange={(e) => demo.setActingWorker(e.target.value)}
          className="mt-0.5 w-full rounded-md bg-transparent py-0.5 font-display text-[15px] font-bold outline-none"
        >
          {workers.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} ({countryName(x.country)})
            </option>
          ))}
        </select>
        <div className="text-xs text-muted">
          {w.title} · {client.name}
        </div>
        <div className="mt-1 text-xs text-muted">Employed through Pebl in {countryName(w.country)}</div>
      </div>
    );
  }
  const p = demo.role === "admin" ? { name: client.admin.name, title: client.admin.title, tag: "Hiring company" } : { name: hrSpecialist.name, title: hrSpecialist.title, tag: "Pebl" };
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="font-mono text-[10.5px] uppercase tracking-wider text-faint">{p.tag}</div>
      <div className="font-display text-[15px] font-bold">{p.name}</div>
      <div className="text-xs text-muted">{p.title}</div>
    </div>
  );
}

function AiStatus() {
  const { aiConnected } = useDemo();
  if (aiConnected === null) return null;
  return (
    <span
      title={aiConnected ? "Explanations and receipt reading use the Claude API" : "Add ANTHROPIC_API_KEY to .env.local to turn on live AI. Until then, explanations use templates."}
      className={cx("hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold sm:inline-flex", aiConnected ? "bg-ai-bg text-ai" : "bg-sunken text-muted")}
    >
    </span>
  );
}

function Toasts() {
  const { toasts } = useDemo();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-[60] grid w-[min(92vw,420px)] -translate-x-1/2 gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "toast-in rounded-xl px-4 py-2.5 text-sm font-semibold shadow-lg",
            t.tone === "ok" ? "bg-ink text-white" : t.tone === "warn" ? "bg-danger text-white" : "bg-surface text-ink ring-1 ring-line",
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
