// Clicks through the demo in headless Edge and saves screenshots.
// Usage: start the app on port 3100 (npx next start -p 3100), then: node scripts/walkthrough.mjs <screenshot-dir>
import { chromium } from "playwright";

const SHOTS = process.argv[2] ?? "walkthrough-shots";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const step = (s) => console.log("STEP", s);
const role = (name) => page.getByRole("tab", { name }).click();
const nav = (name) => page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: false }).first().click();
const btn = (name, exact = true) => page.getByRole("button", { name, exact }).first();
const confirm = () => page.getByRole("button", { name: "Confirm", exact: true }).click();

await page.goto("http://localhost:3100/");
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector("text=Hi Muhammad");
await shot("01-employee-home");

// ---------------- Expenses
step("expense: client dinner -> one-tap approve");
await nav("New expense");
await btn(/Client dinner/, false).click();
await page.waitForSelector("text=Check what was read");
await btn("Submit expense").click();
await page.waitForSelector("text=Cleared every check");
await btn(/Approve it as the client admin/, false).click();
await page.waitForSelector("text=Compliance is already checked");
await page.locator("div.rounded-xl", { hasText: "Muhammad Dawood · Meals" }).first().getByRole("button", { name: "Approve", exact: true }).click();
await page.waitForSelector("text=next payroll run");

step("expense: team dinner -> HR clears");
await role(/Employee/);
await nav("New expense");
await btn(/Team dinner/, false).click();
await page.waitForSelector("text=Check what was read");
await btn("Submit expense").click();
await page.waitForSelector("text=Sent to Pebl HR");
await btn(/See it as Pebl HR/, false).click();
await page.getByRole("button", { name: /Ember & Oak/ }).click();
await btn("Clear to client admin").click();
await confirm();
await page.waitForSelector("text=client admin's decision card");

// ---------------- Leave
step("leave: christmas decline -> guardrail sends to HR");
await role(/Employee/);
await nav("Leave");
await btn("Christmas break").click();
await page.waitForSelector("text=Who decides");
await btn("Submit request").click();
await page.waitForSelector("text=Sent to your manager");
await role(/Client admin/);
await nav("Decisions");
const xmasCard = page.locator("div.rounded-xl", { hasText: "Dec 21 – Jan 1" }).first();
await xmasCard.getByRole("button", { name: "Decline" }).click();
await page.waitForSelector("text=A decline goes to Pebl HR");
await shot("05-decline-guardrail");
await page.getByPlaceholder(/Managers set the timing/).fill("Team is short over Christmas.");
await confirm();
await page.waitForSelector("text=risks the legal minimum");

step("leave: vacation Dec 14-18 -> manager card");
await role(/Employee/);
await nav("Leave");
await page.waitForSelector("text=Your balances");
await btn("Vacation Dec 14–18").click();
await page.waitForSelector("text=Who decides");
await shot("02-leave-form");
await btn("Submit request").click();
await page.waitForSelector("text=Sent to your manager");
await shot("03-leave-result");
await btn(/Decide as the manager/, false).click();
await page.waitForSelector("text=Muhammad Dawood · Vacation");
await shot("04-admin-decisions");

step("leave: suggest other dates -> worker accepts");
const vacCard = page.locator("div.rounded-xl", { hasText: "Muhammad Dawood · Vacation" }).first();
await vacCard.getByRole("button", { name: "Suggest other dates" }).click();
await confirm();
await page.waitForSelector("text=suggested dates");
await role(/Employee/);
await nav("Home");
await page.getByRole("button", { name: /Your manager suggested other dates/ }).click();
await btn("Use these dates").click();
await page.waitForSelector("text=New dates sent to your manager");

step("leave: approve the new dates");
await role(/Client admin/);
await nav("Decisions");
await page.locator("div.rounded-xl", { hasText: "Muhammad Dawood · Vacation" }).first().getByRole("button", { name: "Approve", exact: true }).click();
await page.waitForSelector("text=Balance and payroll updated");

// ---------------- Time
step("time: overtime status + request");
await role(/Employee/);
await nav("Time");
await page.waitForSelector("text=more overtime hours this month");
await shot("07-time-page");
await page.getByRole("button", { name: /^Request 2 hours$/ }).click();
await page.waitForSelector("text=Sent to your manager");

step("time: timesheet +3h Friday -> manager confirms");
await btn("Done").click();
await btn("+3 hrs Friday").click();
await shot("08-timesheet-flags");
await btn(/Confirm 47 hours/, false).click();
await page.waitForSelector("text=Sent to your manager to confirm");
await btn(/Confirm it as the manager/, false).click();
await page.waitForSelector("text=Kenji Sato · Overtime request");
await shot("09-admin-time-cards");
await page.locator("div.rounded-xl", { hasText: "Muhammad Dawood · Timesheet" }).first().getByRole("button", { name: "Confirm", exact: true }).click();

step("time: Kenji partial approval");
await page.locator("div.rounded-xl", { hasText: "Kenji Sato · Overtime request" }).first().getByRole("button", { name: "Approve 2 hours" }).click();
await page.waitForSelector("text=The worker can go ahead");

step("leave: sick today -> approved automatically -> manager Got it");
await role(/Employee/);
await nav("Leave");
await btn("Sick today").click();
await page.waitForSelector("text=Who decides");
await btn("Submit request").click();
await page.waitForSelector("text=Approved automatically");
await btn(/See the manager's notification/, false).click();
await page.waitForSelector("text=No decision needed");
await shot("06-admin-updates");
await btn("Got it").click();

step("leave: paternity -> HR");
await role(/Employee/);
await nav("Leave");
await btn("Paternity leave").click();
await page.waitForSelector("text=Who decides");
await btn("Attach demo document").click();
await btn("Submit request").click();
await page.waitForSelector("text=Sent to Pebl HR");

step("admin: team + policy tabs");
await role(/Client admin/);
await nav("Team");
await page.waitForSelector("text=Overtime against each person");
await shot("10-admin-team");
await nav("Policy");
await page.getByRole("tab", { name: "Overtime" }).click();
await page.getByLabel("Monthly limit JP").fill("50");
await page.waitForSelector("text=above the legal cap");
await shot("11-policy-overtime");
await page.getByRole("tab", { name: "Leave" }).click();
await shot("12-policy-leave");

// ---------------- HR
step("hr: queue, trust, workers, audit");
await role(/Pebl HR/);
await nav("Exception queue");
await page.waitForSelector("text=Only what needs a person");
await shot("13-hr-queue");
await page.getByRole("button", { name: /Paternity leave/ }).first().click();
await page.waitForSelector("text=AI analysis for HR");
await shot("14-hr-paternity");
await page.getByRole("button", { name: "Close" }).click();
await nav("Trust dashboard");
await page.waitForSelector("text=Auto-approval is earned");
await page.locator("tr", { hasText: "DE:leave:sick" }).getByRole("button", { name: "Unlock" }).click();
await page.waitForSelector("text=DE:leave:sick unlocked");
await shot("15-hr-trust");
await nav("Workers");
await page.waitForSelector("text=set by a person, not AI");
await nav("5% audit");
await page.waitForSelector("text=Sampled");

step("mobile");
await page.setViewportSize({ width: 390, height: 844 });
await role(/Employee|^Employee$/);
await nav("Leave");
await page.screenshot({ path: `${SHOTS}/16-mobile-leave.png`, fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log("horizontal overflow on mobile:", overflow);

console.log("console errors:", errors.length ? errors : "none");
await browser.close();
