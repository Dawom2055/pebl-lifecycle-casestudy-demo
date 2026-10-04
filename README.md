# Lifecycle Automation: interactive concept demo

An interactive demo of the AI-assisted compliance layer from the Pebl Lifecycle Automation case study. Switch between three views, **Employee**, **Client admin** and **Pebl HR**, and follow expense, leave and time requests through one shared pipeline: intake, the two-layer rules engine, the risk router, and the AI explanation.

Case study concept by Muhammad Dawood. It is not affiliated with or endorsed by Pebl. People, companies and rule values are illustrative.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

### Turn on live AI (optional)

1. Copy `env.example` to `.env.local`.
2. Add your Anthropic API key: `ANTHROPIC_API_KEY=sk-ant-...`
3. Restart `npm run dev`. The top bar changes from **AI: templates** to **Claude connected**.

With a key, Claude reads uploaded receipt photos and writes every explanation and manager suggestion. Without one, the demo still works: the explanations come from templates that match the PRD examples.

## Demo script (about 6 minutes)

The demo's "today" is **Friday, Oct 9, 2026**, so the week-of-Oct-5 timesheet is due.

**Expenses**
1. Employee → New expense → **Client dinner**. It clears every check. Click **Approve it as the client admin →** and approve it in one tap.
2. **Lunch, no VAT number** goes back to the worker; click **Retake photo**. **Team dinner** (4x usual spend) goes to Pebl HR.

**Leave**
3. Employee → Leave → **Vacation Dec 14–18**. The AI pre-check runs as you pick dates. Submit, then **Decide as the manager →**. The card shows that 5 days expire Dec 31 and that Daniel is away Dec 16–18, and suggests Approve. Try **Suggest other dates**: the worker accepts them from Home.
4. **Christmas break**: the public holidays aren't deducted. As the manager, click **Decline**: the card warns that this risks the legal minimum, and the decline goes to Pebl HR.
5. **Sick today** is approved automatically, and the manager gets a "Got it" update. **Paternity leave** goes to Pebl HR with the entitlement and pay treatment worked out.

**Time**
6. Employee → Time: "You can work up to 6 more overtime hours this month." Request 2 hours: the checks run before you can send it.
7. Timesheet: try **+3 hrs Friday**. The 3 hours weren't pre-approved but are within the limit, so the manager confirms them and can't refuse pay. Also try **+3 hrs Mon–Wed** (23 of 20: HR incident) or **14-hour Wednesday** (missed rest: HR incident).
8. Client admin → Decisions → **Kenji Sato's overtime card** (Japan: 18 of 20, legal cap 45, forecast 22). Click **Approve 2 hours**.
9. Client admin → Policy → Overtime: set Japan's limit to 50 to see it blocked above the legal cap.

**Trust model**
10. Pebl HR → Trust dashboard: **Unlock** `DE:leave:sick` (it has the evidence), or **Simulate rule change** on any live combination. Workers: change a classification. 5% audit: review the random sample.

Use **Reset demo** in the top bar to start again.

## Where things live

| Path | What it is |
|---|---|
| `data/country-rules.json` | Layer 1, expenses: VAT/GST, receipts, tax-free limits, mileage rates with effective dates |
| `data/country-rules-leave.json` | Layer 1, leave: statutory minimums, carryover and expiry, sick and parental rules, public holidays |
| `data/country-rules-time.json` | Layer 1, time: daily and weekly limits, monthly overtime caps, rest periods, breaks, premiums, Article 36 |
| `data/client-policy.json` | Layer 2, Lumen Robotics' own policy for expenses, leave and overtime |
| `data/unlock-status.json` | Which country + request type combinations are unlocked or in shadow mode, with agreement counts |
| `data/workers.json` | The client, the HR specialist and six workers across the UK, US, Canada, Germany and Japan |
| `data/leave-seed.json`, `data/time-seed.json` | Balances already used, schedules, overtime so far this month, and requests already in the system |
| `data/sample-receipts.json`, `data/seed-requests.json` | Demo receipts and starting expenses |
| `src/lib/engine/` | The rules engines and routers for each module (plain code, no AI), the shared pipeline, and template explanations |
| `src/app/api/ai/*` | Claude API routes: receipt reading, explanations, connection status |
| `src/lib/store.tsx` | Demo state shared by the three views, saved in the browser |

Edit any JSON file and reload to change the rules. For example, set `UK:leave:vacation` to `"shadow"` in `unlock-status.json` and vacation requests go to HR instead of the manager.

## Checks

```bash
npm run check                     # runs every scenario through the engines and checks each outcome against the PRD
node scripts/walkthrough.mjs out  # clicks through all three modules in headless Edge (needs the app running on port 3100)
```

## What's built

- **Expenses:** EXP-1 to EXP-15, plus the PRD edge cases for foreign currency, duplicates across workers, and a receipt still unreadable after a retake.
- **Leave:** LV-1 to LV-14 and LV-16, plus the edge cases for public holidays in the range and a request longer than the balance (paid/unpaid split).
- **Time:** TM-1 to TM-14 and TM-16. Daily logging in strict-cap countries (TM-10) shows as a country rule rather than a separate daily entry screen.
- **Shared:** shadow mode, unlock by evidence, reset on rule change, the 5% audit, decision logging and HR-set classification.

**Not built:** EXP-16 and LV-15 (reminders and escalation), EXP-17 (mileage claims), TM-15 (days-based contracts), uploading a real leave document to Claude (the demo attaches a pre-read one), and the "Ask the data" panel.
