import { fxToUSD } from "./data";
import type { Currency } from "./types";

const symbols: Record<Currency, string> = { GBP: "£", USD: "$", CAD: "C$", EUR: "€", JPY: "¥" };

export function money(amount: number, currency: Currency): string {
  const digits = currency === "JPY" ? 0 : 2;
  const n = amount.toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${symbols[currency]}${n}`;
}

/** Whole amounts drop the decimals ("£45" not "£45.00") for prose. */
export function moneyShort(amount: number, currency: Currency): string {
  if (Number.isInteger(amount)) return `${symbols[currency]}${amount.toLocaleString("en-GB")}`;
  return money(amount, currency);
}

export function convert(amount: number, from: Currency, to: Currency): number {
  if (from === to) return amount;
  const usd = amount * fxToUSD[from];
  const out = usd / fxToUSD[to];
  return to === "JPY" ? Math.round(out) : Math.round(out * 100) / 100;
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-02" -> "Oct 2" */
export function shortDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${months[m - 1]} ${d}`;
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${shortDate(iso)}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(...ymd(fromIso));
  const b = Date.UTC(...ymd(toIso));
  return Math.round((b - a) / 86_400_000);
}

function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [y, m - 1, d];
}

export const categoryLabel: Record<string, string> = {
  meals: "Meals",
  travel: "Travel",
  lodging: "Lodging",
  office: "Office supplies",
  other: "Other",
};
