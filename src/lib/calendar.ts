/** Date helpers on ISO "YYYY-MM-DD" strings, in UTC so results never shift with the viewer's timezone. */

function toUTC(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number) {
  return fromUTC(toUTC(iso) + n * 86_400_000);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(iso: string) {
  return new Date(toUTC(iso)).getUTCDay();
}

export function isWeekend(iso: string) {
  const d = weekday(iso);
  return d === 0 || d === 6;
}

export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function workingDaysBetween(start: string, end: string, holidays: Set<string> = new Set()) {
  return eachDay(start, end).filter((d) => !isWeekend(d) && !holidays.has(d));
}

export function monthOf(iso: string) {
  return iso.slice(0, 7);
}

export function endOfMonth(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  return fromUTC(Date.UTC(y, m, 0));
}

/** Working days left in the month after `asOf` (exclusive). */
export function workingDaysLeftInMonth(asOf: string) {
  return workingDaysBetween(addDays(asOf, 1), endOfMonth(asOf)).length;
}

/** Monday of the week containing `iso`. */
export function weekStartOf(iso: string) {
  const d = weekday(iso);
  return addDays(iso, d === 0 ? -6 : 1 - d);
}

export function weekDays(weekStart: string) {
  return [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i));
}

export function minutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function hhmm(totalMinutes: number) {
  const m = ((totalMinutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Hours worked in a day from start, end and unpaid break. Ends past midnight roll over. */
export function workedHours(start: string, end: string, breakMin: number) {
  let span = minutes(end) - minutes(start);
  if (span <= 0) span += 1440;
  return Math.max(0, (span - breakMin) / 60);
}

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function dayName(iso: string) {
  return dayNames[weekday(iso)];
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Dec 14–18", "Dec 21 – Jan 1", or "Oct 6" for a single day. */
export function rangeLabel(start: string, end: string) {
  const [, sm, sd] = start.split("-").map(Number);
  const [, em, ed] = end.split("-").map(Number);
  if (start === end) return `${months[sm - 1]} ${sd}`;
  if (sm === em) return `${months[sm - 1]} ${sd}–${ed}`;
  return `${months[sm - 1]} ${sd} – ${months[em - 1]} ${ed}`;
}
