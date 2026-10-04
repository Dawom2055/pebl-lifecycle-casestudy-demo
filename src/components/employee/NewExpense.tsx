"use client";

import { useState } from "react";
import { countryRules, DEMO_TODAY, getSampleReceipt, getWorker } from "@/lib/data";
import { categoryLabel, money } from "@/lib/format";
import { useDemo } from "@/lib/store";
import type { AiRead, Currency, ExpenseCategory, ExpenseData, ExpenseRequest, ReceiptRef } from "@/lib/types";
import { CONFIDENCE_FLOOR } from "@/lib/engine/expenses";
import { ChecksList, ExplanationCard, PipelineTrace, ReceiptView } from "../request-parts";
import { ActorChip, Button, Card, ConfidencePill, cx, Eyebrow, Required, SparkIcon } from "../ui";

type Step = "review" | "result";

interface Form {
  merchant: string;
  amount: string;
  currency: Currency;
  date: string;
  taxId: string;
  category: ExpenseCategory;
  attendees: string;
  note: string;
}

const emptyForm = (currency: Currency): Form => ({ merchant: "", amount: "", currency, date: "", taxId: "", category: "meals", attendees: "1", note: "" });

function formFromRead(read: Omit<AiRead, "source">, note = ""): Form {
  return {
    merchant: read.merchant.value,
    amount: String(read.amount.value),
    currency: read.currency.value,
    date: read.date.value,
    taxId: read.taxId.value ?? "",
    category: read.category.value,
    attendees: String(read.attendees.value),
    note,
  };
}

function formFromData(d: ExpenseData): Form {
  return { merchant: d.merchant, amount: String(d.amount), currency: d.currency, date: d.date, taxId: d.taxId ?? "", category: d.category, attendees: String(d.attendees), note: d.note };
}

export function NewExpense({ fixing, onDone }: { fixing?: ExpenseRequest | null; onDone(): void }) {
  const demo = useDemo();
  const worker = getWorker(fixing?.workerId ?? demo.actingWorkerId);
  const [step, setStep] = useState<Step>("review");
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptRef>(fixing?.data.receipt ?? { kind: "none" });
  const [aiRead, setAiRead] = useState<AiRead | undefined>(fixing?.data.aiRead);
  const [form, setForm] = useState<Form>(fixing ? formFromData(fixing.data) : emptyForm(worker.currency));
  const [replaceId, setReplaceId] = useState<string | undefined>(fixing?.id);
  const [resultId, setResultId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const result = resultId ? demo.requests.find((r): r is ExpenseRequest => r.id === resultId && r.kind === "expense") : undefined;

  function pickSample(id: string) {
    const s = getSampleReceipt(id)!;
    setReceipt({ kind: "sample", sampleId: id, name: `${s.receipt.merchant}.jpg` });
    setError(null);
    setStep("review");
    setReading(true);
    setTimeout(() => {
      setAiRead({ ...s.read, source: "sample" });
      setForm(formFromRead(s.read, s.note));
      setReading(false);
    }, 1300);
  }

  async function upload(file: File) {
    setError(null);
    const imageUrl = await downscale(file);
    setReceipt({ kind: "upload", name: file.name, imageUrl });
    setReading(true);
    try {
      const res = await fetch("/api/ai/receipt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageDataUrl: imageUrl }) });
      const body = await res.json();
      if (res.status === 503) {
        // Claude isn't connected: the worker fills in the fields from the receipt.
        setAiRead(undefined);
        setForm(emptyForm(worker.currency));
      } else if (!res.ok) {
        setError(body.error ?? "Couldn't read that receipt. Fill in the fields yourself.");
        setAiRead(undefined);
        setForm(emptyForm(worker.currency));
      } else {
        const read = body as AiRead;
        setAiRead(read);
        setForm(formFromRead(read));
      }
    } catch {
      setError("Couldn't reach the server. Fill in the fields yourself.");
      setAiRead(undefined);
    }
    setReading(false);
  }

  function submit() {
    const data: ExpenseData = {
      merchant: form.merchant.trim(),
      amount: Number(form.amount),
      currency: form.currency,
      date: form.date,
      taxId: form.taxId.trim() || null,
      category: form.category,
      attendees: Math.max(1, Number(form.attendees) || 1),
      note: form.note.trim(),
      receipt,
      aiRead,
    };
    const req = demo.submitExpense(worker.id, data, replaceId);
    setResultId(req.id);
    setStep("result");
  }

  function retake() {
    if (!result) return;
    const sample = result.data.receipt.sampleId ? getSampleReceipt(result.data.receipt.sampleId) : undefined;
    setReplaceId(result.id);
    if (sample?.retakeId) {
      pickSample(sample.retakeId);
    } else {
      setForm(formFromData(result.data));
      setStep("review");
    }
  }

  const hasReceipt = receipt.kind !== "none";
  // An expense can't be dated after today.
  const futureDate = form.date > DEMO_TODAY;
  const valid = hasReceipt && !reading && form.merchant.trim() && Number(form.amount) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(form.date) && !futureDate;
  const stage = step === "result" ? 3 : reading ? 1 : hasReceipt ? 2 : 0;

  function onFile(file: File | undefined) {
    if (file && file.type.startsWith("image/")) upload(file);
  }

  return (
    <div className="grid gap-5">
      <Stepper at={stage} />

      {step === "review" && (
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="grid content-start gap-3">
            <Eyebrow>
              Receipt <Required />
            </Eyebrow>
            <label
              onDragOver={(e) => (e.preventDefault(), setDragging(true))}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => (e.preventDefault(), setDragging(false), onFile(e.dataTransfer.files[0]))}
              className={cx(
                "relative block cursor-pointer overflow-hidden rounded-xl transition",
                !hasReceipt && "border-2 border-dashed border-line bg-surface hover:border-worker",
                dragging && "border-worker bg-worker-bg",
              )}
            >
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ""))} />
              {hasReceipt ? (
                <>
                  <ReceiptView sampleId={receipt.sampleId} imageUrl={receipt.imageUrl} className={cx(reading && "opacity-70")} />
                  {reading && <div className="scan-line" />}
                </>
              ) : (
                <div className="grid place-items-center gap-1 px-4 py-10 text-center">
                  <span className="text-sm font-semibold text-worker">Select a receipt to upload</span>
                  <span className="text-xs text-muted">Click to browse, or drop a JPEG, PNG, WebP or GIF here</span>
                </div>
              )}
            </label>
            {reading ? (
              <div className="flex items-center gap-2 text-sm font-semibold text-ai">
                <SparkIcon /> {receipt.kind === "upload" ? "Claude is reading your receipt…" : "AI is reading the receipt…"}
              </div>
            ) : (
              hasReceipt && <p className="text-xs text-muted">Click the receipt to choose a different one.</p>
            )}
            {replaceId && <p className="rounded-lg bg-worker-bg px-3 py-2 text-sm text-worker">Resubmitting {replaceId}. A second failed attempt goes to Pebl HR instead of looping back.</p>}
          </div>
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold">Fill in required expense fields</h2>
              {aiRead && <ActorChip actor="ai">{aiRead.source === "claude" ? "Read by Claude" : "Read by AI"}</ActorChip>}
              <ActorChip actor="worker">You confirm</ActorChip>
            </div>
            {error && <p className="mb-4 rounded-lg bg-hr-bg px-3 py-2 text-sm text-hr">{error}</p>}
            {aiRead && <p className="mb-4 text-sm text-muted">Fields under {Math.round(CONFIDENCE_FLOOR * 100)}% confidence are worth a second look. Anything you change is cross-checked against the receipt.</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field required label="Merchant" conf={aiRead?.merchant} edited={!!aiRead && form.merchant !== aiRead.merchant.value}>
                <input value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} className={inputCls} />
              </Field>
              <div className="grid grid-cols-[1fr_100px] gap-2">
                <Field required label="Amount" conf={aiRead?.amount} edited={!!aiRead && Number(form.amount) !== aiRead.amount.value}>
                  <input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={cx(inputCls, "tabular")} />
                </Field>
                <Field required label="Currency" conf={aiRead?.currency} edited={!!aiRead && form.currency !== aiRead.currency.value}>
                  <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as Currency })} className={inputCls}>
                    {(["GBP", "USD", "CAD", "EUR", "JPY"] as const).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field required label="Date" conf={aiRead?.date} edited={!!aiRead && form.date !== aiRead.date.value}>
                <input type="date" max={DEMO_TODAY} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={cx(inputCls, futureDate && "border-danger")} />
                {futureDate && <span className="text-xs text-danger">The date can&apos;t be in the future.</span>}
              </Field>
              <Field label={countryRules[worker.country].expenses.taxId?.label ?? "Tax number"} conf={aiRead?.taxId} edited={!!aiRead && (form.taxId || null) !== aiRead.taxId.value}>
                <input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} placeholder="Not on receipt" className={inputCls} />
              </Field>
              <Field required label="Category" conf={aiRead?.category} edited={!!aiRead && form.category !== aiRead.category.value}>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })} className={inputCls}>
                  {Object.entries(categoryLabel).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field required label="People covered" conf={aiRead?.attendees} edited={!!aiRead && Number(form.attendees) !== aiRead.attendees.value}>
                <input inputMode="numeric" value={form.attendees} onChange={(e) => setForm({ ...form, attendees: e.target.value })} className={cx(inputCls, "tabular")} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Business purpose">
                  <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Client dinner to scope the Q4 pilot" className={inputCls} />
                </Field>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button variant="worker" disabled={!valid} onClick={submit}>
                {replaceId ? "Resubmit" : "Submit expense"}
              </Button>
              <Button variant="ghost" onClick={onDone}>
                Cancel
              </Button>
              {!hasReceipt && <span className="text-xs text-muted">Select a receipt to submit.</span>}
            </div>
          </Card>
        </div>
      )}

      {step === "result" && result && (
        <div className="grid gap-5">
          <ResultBanner req={result} />
          <ExplanationCard explanation={result.explanations.worker} label="What happens next" tone={result.routing.outcome === "back_to_worker" ? "worker" : "ai"} />
          <div className="flex flex-wrap gap-2">
            {result.routing.outcome === "back_to_worker" ? (
              <>
                <Button variant="worker" onClick={retake}>
                  {result.data.receipt.sampleId && getSampleReceipt(result.data.receipt.sampleId)?.retakeId ? "Retake photo" : "Fix and resubmit"}
                </Button>
                <Button variant="ghost" onClick={onDone}>
                  Later
                </Button>
              </>
            ) : (
              <>
                <Button variant={result.routing.outcome === "hr_exception" ? "hr" : "primary"} onClick={() => demo.setRole(result.routing.outcome === "hr_exception" ? "hr" : "admin")}>
                  {result.routing.outcome === "hr_exception" ? "See it as Pebl HR →" : result.routing.clientAutoApproved ? "See it as the client admin →" : "Approve it as the client admin →"}
                </Button>
                <Button onClick={onDone}>Back to my expenses</Button>
              </>
            )}
          </div>
          <Card className="grid gap-5 p-5">
            <div>
              <Eyebrow className="mb-2">How it was routed</Eyebrow>
              <PipelineTrace req={result} />
            </div>
            <ChecksList checks={result.evaluation.checks} />
          </Card>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-worker";

function Field({ label, conf, edited, required, children }: { label: string; conf?: { confidence: number }; edited?: boolean; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="flex items-center gap-2 text-xs font-semibold text-muted">
        <span>
          {label}
          {required && <Required />}
        </span>
        {edited ? <span className="rounded bg-worker-bg px-1.5 py-px text-[11px] text-worker">Edited by you</span> : conf ? <ConfidencePill value={conf.confidence} /> : null}
      </span>
      {children}
    </label>
  );
}

function Stepper({ at }: { at: number }) {
  const steps = [
    { id: "receipt", label: "Receipt" },
    { id: "reading", label: "AI reads" },
    { id: "review", label: "You confirm" },
    { id: "result", label: "Checked & routed" },
  ];
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {steps.map((s, i) => (
        <li key={s.id} className={cx("flex items-center gap-2", i <= at ? "text-ink" : "text-faint")}>
          <span className={cx("grid size-5 place-items-center rounded-full text-[11px] font-bold", i < at ? "bg-worker text-white" : i === at ? "border-2 border-worker text-worker" : "border border-line")}>
            {i < at ? "✓" : i + 1}
          </span>
          <span className={cx(i === at && "font-semibold")}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function ResultBanner({ req }: { req: ExpenseRequest }) {
  const o = req.routing.outcome;
  const m =
    o === "auto_clear" && req.routing.advisories?.length
      ? { title: "Sent to the client admin", sub: `Passed every compliance check. ${req.routing.advisories.map((a) => a.label).join(" and ")}, so Lumen Robotics decides.`, cls: "border-admin bg-admin-bg" }
      : o === "auto_clear"
      ? { title: req.routing.clientAutoApproved ? "Approved automatically" : "Cleared every check", sub: req.routing.clientAutoApproved ? "Under Lumen Robotics' auto-approve limit. Straight to payroll." : "No Pebl HR touch needed. It's on the client admin's card for a one-tap approval.", cls: "border-admin bg-admin-bg" }
      : o === "back_to_worker"
        ? { title: "One thing to fix", sub: "Caught at submission, so it hasn't reached your manager or HR.", cls: "border-worker bg-worker-bg" }
        : { title: "Sent to Pebl HR", sub: req.routing.shadowWould ? `Shadow mode for ${req.routing.combination}: HR still decides while the system proves itself.` : "A specialist reviews it with the analysis already done. Nothing is denied automatically.", cls: "border-hr bg-hr-bg" };
  return (
    <div className={cx("rounded-xl border-l-4 px-5 py-4", m.cls)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-extrabold">{m.title}</h2>
        <span className="font-mono text-sm text-muted">
          {req.id} · {money(req.evaluation.payroll.amount, req.evaluation.payroll.currency)}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{m.sub}</p>
    </div>
  );
}

/** Shrinks a photo to at most 1600px on the long edge, as JPEG, before sending it to Claude. */
async function downscale(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
