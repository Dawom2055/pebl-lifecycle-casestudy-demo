"use client";

import { getWorker } from "@/lib/data";
import { kindLabel, subtitleOf, titleOf, valueOf } from "@/lib/describe";
import type { AnyRequest } from "@/lib/types";
import { Card, cx, Empty, StatusBadge } from "./ui";

const kindDot = { expense: "bg-rules", leave: "bg-worker", overtime: "bg-hr", timesheet: "bg-hr" } as const;

export function RequestTable({ rows, onOpen, showWorker, empty }: { rows: AnyRequest[]; onOpen(id: string): void; showWorker?: boolean; empty?: string }) {
  if (!rows.length) return <Empty title="Nothing here yet">{empty ?? "Submit a request to see it move through the pipeline."}</Empty>;
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line-soft">
        {rows.map((r) => {
          const w = getWorker(r.workerId);
          return (
            <li key={r.id}>
              <button onClick={() => onOpen(r.id)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-sunken/60 sm:grid-cols-[96px_1fr_auto_auto]">
                <span className="hidden items-center gap-1.5 font-mono text-xs text-faint sm:flex" title={kindLabel[r.kind]}>
                  <span className={cx("size-1.5 rounded-full", kindDot[r.kind])} />
                  {r.id}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{titleOf(r)}</span>
                  <span className="block truncate text-xs text-muted">
                    {showWorker ? `${w.name} · ${w.country} · ` : ""}
                    {subtitleOf(r)}
                    {r.routing.shadowWould ? " · shadow mode" : ""}
                    {r.auditSampled ? " · audit sample" : ""}
                  </span>
                </span>
                <span className="text-right font-mono text-sm tabular">{valueOf(r)}</span>
                <span className="col-span-2 sm:col-span-1 sm:justify-self-end">
                  <StatusBadge status={r.status} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
