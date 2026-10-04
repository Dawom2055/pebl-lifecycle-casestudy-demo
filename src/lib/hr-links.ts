import { getWorker } from "./data";
import type { AnyRequest, CountryCode, LeaveType } from "./types";

export interface HrLink {
  label: string;
  href: string;
  /** What the link helps HR check. */
  hint: string;
}

type Module = "expense" | "leave" | "time";

/** Official sources Pebl HR checks a flagged request against, per country and module. */
const SOURCES: Record<CountryCode, Record<Module, HrLink[]>> = {
  UK: {
    expense: [
      { label: "Check a UK VAT number", href: "https://www.gov.uk/check-uk-vat-number", hint: "Confirm the supplier's VAT number is real" },
      { label: "Expenses and benefits A to Z", href: "https://www.gov.uk/expenses-and-benefits-a-to-z", hint: "What's taxable and what payroll reports" },
      { label: "Mileage and travel rates", href: "https://www.gov.uk/government/publications/rates-and-allowances-travel-mileage-and-fuel-allowances", hint: "HMRC approved rates" },
    ],
    leave: [
      { label: "Holiday entitlement", href: "https://www.gov.uk/holiday-entitlement-rights", hint: "Statutory minimum and carryover" },
      { label: "Statutory Sick Pay", href: "https://www.gov.uk/statutory-sick-pay", hint: "Eligibility, fit notes and pay" },
      { label: "Paternity pay and leave", href: "https://www.gov.uk/paternity-pay-leave", hint: "Length, notice and statutory pay" },
    ],
    time: [
      { label: "Maximum weekly working hours", href: "https://www.gov.uk/maximum-weekly-working-hours", hint: "The 48-hour average and opt-outs" },
      { label: "Rest breaks at work", href: "https://www.gov.uk/rest-breaks-work", hint: "Daily rest and break rules" },
      { label: "Overtime: your rights", href: "https://www.gov.uk/overtime-your-rights", hint: "Pay and compulsory overtime" },
    ],
  },
  US: {
    expense: [
      { label: "IRS Publication 463", href: "https://www.irs.gov/publications/p463", hint: "Travel, gift and car expense rules" },
      { label: "Standard mileage rates", href: "https://www.irs.gov/tax-professionals/standard-mileage-rates", hint: "Current IRS rate" },
    ],
    leave: [
      { label: "DOL: Vacation leave", href: "https://www.dol.gov/general/topic/workhours/vacation_leave", hint: "No federal minimum; state law applies" },
      { label: "DOL: Family and Medical Leave Act", href: "https://www.dol.gov/agencies/whd/fmla", hint: "Job-protected medical and family leave" },
    ],
    time: [{ label: "DOL: Overtime pay", href: "https://www.dol.gov/agencies/whd/overtime", hint: "FLSA overtime and exemptions" }],
  },
  CA: {
    expense: [
      { label: "Confirm a GST/HST number", href: "https://www.canada.ca/en/revenue-agency/services/e-services/digital-services-businesses/confirming-a-gst-hst-account-number.html", hint: "Check the supplier is registered" },
      { label: "GST/HST for businesses", href: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses.html", hint: "CRA guidance" },
    ],
    leave: [
      { label: "CNESST: Annual vacation", href: "https://www.cnesst.gouv.qc.ca/en/working-conditions/leave/annual-vacation", hint: "Québec vacation entitlement" },
      { label: "CNESST: Illness leave", href: "https://www.cnesst.gouv.qc.ca/en/working-conditions/leave/accidents-and-illnesses", hint: "Sick days and absences" },
      { label: "CNESST: Family leave", href: "https://www.cnesst.gouv.qc.ca/en/working-conditions/leave/family-related-leave", hint: "Parental and family events" },
    ],
    time: [{ label: "CNESST: Work schedule", href: "https://www.cnesst.gouv.qc.ca/en/working-conditions/work-schedule-and-termination-employment/work-schedule", hint: "Standard week, overtime and rest" }],
  },
  DE: {
    expense: [
      { label: "Check an EU VAT number (VIES)", href: "https://ec.europa.eu/taxation_customs/vies/", hint: "Confirm the supplier's USt-IdNr." },
      { label: "UStDV §33: small invoices", href: "https://www.gesetze-im-internet.de/ustdv_1980/__33.html", hint: "What an invoice up to €250 must show" },
    ],
    leave: [
      { label: "Federal Leave Act (BUrlG)", href: "https://www.gesetze-im-internet.de/burlg/", hint: "Minimum vacation and carryover" },
      { label: "Continued Pay Act (EntgFG)", href: "https://www.gesetze-im-internet.de/entgfg/", hint: "Sick pay and medical certificates" },
    ],
    time: [{ label: "Working Hours Act (ArbZG)", href: "https://www.gesetze-im-internet.de/arbzg/", hint: "Daily maximum, breaks and rest" }],
  },
  JP: {
    expense: [
      { label: "Qualified invoice registry", href: "https://www.invoice-kohyo.nta.go.jp/", hint: "Look up the supplier's T-number" },
      { label: "NTA: Qualified invoice system", href: "https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice.htm", hint: "What a qualified invoice must show" },
    ],
    leave: [{ label: "Labor Standards Act", href: "https://www.japaneselawtranslation.go.jp/en/laws/view/3567", hint: "Article 39: annual paid leave" }],
    time: [{ label: "Labor Standards Act", href: "https://www.japaneselawtranslation.go.jp/en/laws/view/3567", hint: "Articles 32–37: hours, Article 36 overtime, premiums" }],
  },
};

/** Leave types whose official source is most relevant, listed first. */
const LEAVE_FOCUS: Partial<Record<LeaveType, string[]>> = {
  sick: ["Sick", "Illness", "EntgFG", "Medical"],
  paternity: ["Paternity", "Family"],
  parental: ["Paternity", "Family"],
};

/** Official sources for this request, most relevant first. */
export function hrLinksFor(req: AnyRequest): HrLink[] {
  const worker = getWorker(req.workerId);
  const topic: Module = req.kind === "expense" ? "expense" : req.kind === "leave" ? "leave" : "time";
  const links = SOURCES[worker.country][topic];
  if (req.kind !== "leave") return links;
  const focus = LEAVE_FOCUS[req.data.type];
  if (!focus) return links;
  const hit = (l: HrLink) => focus.some((f) => l.label.includes(f));
  return [...links.filter(hit), ...links.filter((l) => !hit(l))];
}
