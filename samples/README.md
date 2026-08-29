# Koby — Test Kit

Everything you need to test the app end to end with realistic (but fictional) data for
**Maple Court Apartments**, a 15-unit property at 1428 Maple Court, Springfield, IL —
plus a documents-free test of the built-in **deal calculator** (Test B below).

| File | Upload as | What's inside |
| --- | --- | --- |
| `sample-rent-roll.xlsx` | **Rent Roll** | 15 units (nine 1BR, six 2BR), one vacancy (unit 205), 93.3% occupied, in-place rents deliberately below market |
| `sample-t12.xlsx` | **T-12 Operating Statement** | Jul 2025 – Jun 2026 monthly income & expenses; reconciles with the rent roll; **payroll intentionally absent** so the AI raises a data-verification flag |
| `make_samples.py` | — | Python script that regenerates both files (`pip install openpyxl`, then `python make_samples.py`) |

## Prerequisites

- The app is running (see the main [README](../README.md) for setup), locally, in a
  GitHub Codespace, **or via the Windows desktop package** (`Koby.exe` from the
  companion *Application* repo — it installs into `Documents\Koby` and opens the
  browser for you; all tests below work identically there).
- `ANTHROPIC_API_KEY` is set in `.env` **and the Anthropic account has API credits**
  (console.anthropic.com → Plans & Billing). Without credits the AI step fails with a
  "credit balance is too low" error.

## Test A — full AI document workflow

### 1. Register / sign in

Any email works — accounts are stored only in the local database.

### 2. Create the property analysis

Click **+ New property analysis** and enter:

| Field | Value |
| --- | --- |
| Property address | 1428 Maple Court, Springfield, IL |
| Purchase price | 1000000 |
| Number of units | 15 |
| Property type | Multifamily |
| Year built | 1985 |
| Current occupancy (%) | 93.3 |
| Loan amount | 750000 |
| Interest rate (%) | 6.5 |
| Loan term (years) | 30 |
| Down payment | 250000 |
| Renovation budget (optional) | 50000 |
| Target cash-on-cash (optional) | 8 |
| Strategy (optional) | Value-add |

Leave *Asking price* and *Est. closing costs* blank the first time — closing costs
auto-fill from your Settings default (1% of price unless you changed it). Note that
cash-on-cash uses **total cash needed** (down payment + closing + carrying + renovation),
so figures are slightly more conservative than a down-payment-only calculation.

### 3. Upload the documents

The analysis page has two tabs: **Manual entry** (deal calculator, no documents needed) and
**Uploaded documents**. Switch to the **Uploaded documents** tab and upload:

- `sample-rent-roll.xlsx` with document type **Rent Roll (required)**
- `sample-t12.xlsx` with document type **T-12 Operating Statement (required)**

### 3b. Upload sanity check (new)

Each upload gets a cheap AI content check: if a file's content doesn't match its label
(e.g. you upload a calculator worksheet as a T-12), an amber warning appears under the
document list before you spend a full analysis run. The sample files are proper
documents, so no warning should appear here.

### 4. Run the AI analysis

Click **Run AI analysis** and wait 1–3 minutes. Expected results:

- **Underwriting results:** NOI ≈ $88–90K · cap rate ≈ 8.9% · DSCR ≈ 1.55 ·
  cash-on-cash ≈ 9–10% · break-even occupancy ≈ 75–80%
- **Extracted financials:** every figure shows its source document (hover over a value);
  click any value to override it manually
- **Data verification flags:** at minimum, a flag that **payroll was not found** —
  this gap is planted in the sample T-12 on purpose. The analysis status becomes
  *"User verification required"* because of it.
- **AI summary:** overview, opportunities (it should spot the below-market rents and the
  vacant unit), risks to investigate, and key assumptions. Per design, it never says
  "this is a good investment" — it reports what the numbers show.

### 4b. Coverage, classification, and reconciliation

The app classifies every document line using the Multifamily Financial Classification
Dictionary (36 categories). After the AI run:

- **Extraction coverage** (top of results): "N document lines classified · 7 of 8 core
  categories found · defaulted to $0: Payroll" — instantly explains any gap between the
  app's numbers and your own calculations.
- **Income convention** (fixed, no toggle): effective income = base rent − vacancy −
  bad debt − concessions + other income (late fees, parking, laundry, RUBS, … each its
  own category). Utility reimbursements are never netted against utility expense.
- **Below NOI**: capex, tenant improvements, leasing commissions, debt service, and
  D&A found in documents are reported separately and *never* included in NOI — they
  appear in Extracted financials and on the PDF as deliberate exclusions.
- **Manual vs documents reconciliation**: once you've saved deal-calculator inputs AND
  run a document analysis, a side-by-side table shows both sets of numbers with
  differences — assumptions vs actuals on one screen.
- Hover any metric's **ⓘ** to see its formula with the live numbers plugged in
  (cash-on-cash also shows the down-payment-only variant the Excel uses).

### 5. Test the value-add engine

In **Assumptions**, enter and **Save**:

| Field | Value |
| --- | --- |
| Market rent ($/unit/mo) | 1050 |
| Reno cost per unit ($) | 5000 |
| # Units to renovate | 10 |
| Reno rent increase ($/unit/mo) | 150 |
| Exit cap rate (%) | 6.5 |
| Vacancy assumption (%) | 5 |

The **Value-add analysis** section appears instantly (no AI call): rent-growth upside,
renovation ROI (~36%), value impact at the exit cap, and a stabilized projection with
higher NOI/cap rate/cash-on-cash. Click **Re-run AI analysis** afterwards if you want the
written summary to reflect the new assumptions.

### 6. Override a figure — and inspect/fix the mapping (new)

In **Extracted financials**, click any amount, type a new value, and watch the metrics
recalculate. Overridden values are marked "User override".

Categories with a **▸** arrow expand to show the document's original line items,
labeled exactly as the owner wrote them ("Turns & Make-Ready", "PM Fee", …). Because
every owner labels finances differently, the AI marks judgment-call mappings amber
("N to confirm"):

- Click **confirm** to accept a mapping, or use **Move to…** to send a line to the
  right category (e.g. a "Property Mgmt Fee" the AI filed under Administrative moves
  to Management fees) — both category totals and all metrics update instantly.
- **Exclude from analysis** removes a line entirely (e.g. capital reserves you don't
  count as opex); excluded lines are listed below the tables with a *restore* link.

### 7. Check the valuation & sensitivity cards

On the same page:

- **Valuation at cap rates** — what the property is worth at each cap-rate band
  (default 6/7/8%, configurable in Settings), compared against asking/offer.
- **What if? — rent sensitivity** — cash-on-cash if effective monthly income moves
  by ± the step from Settings (default $500/month).

### 8. Export the report

Click **Export PDF report** (top right) — a professional investment summary including
cash needed, the metrics, valuation matrix, rent sensitivity, value-add analysis,
hold-period returns (if set), AI narrative, data flags, and the verification disclaimer.
If you filled in **Settings → Report branding**, your company name, contact line, and
accent color appear on the report.

### 9. Share it with an "investor"

Click **Share** (top right, next to Export) → **Create share link** → **Copy link**.
Open the copied link in a private/incognito window: you get a read-only branded summary
page with a PDF download — no login required. Back in the app, click **Revoke** and
reload the incognito tab: it now says the link is not available.

## Test B — deal calculator (no documents, no AI, instant)

This reproduces the reference Excel deal calculator exactly. Create a new analysis:

| Field | Value |
| --- | --- |
| Property address | 18th and Wayne (calculator example) |
| Asking price | 1300000 |
| Offer / purchase price | 1000000 |
| Number of units | 8 |
| Property type | Multifamily |
| Year built | 1950 |
| Current occupancy (%) | 100 |
| Loan amount | 800000 |
| Interest rate (%) | 6.5 |
| Loan term (years) | 25 |
| Down payment | 200000 |
| Est. closing costs | 10000 |
| Vacancy assumption (%) | 5 |

Then on the **Manual entry** tab, in the **Deal calculator** section (no documents needed):

1. Under **Income**, add a unit-mix row: label `All units`, count `8`, rent `1350`
   (other income: none — but note you can now itemize other income with
   **+ Add other income type**, e.g. laundry and parking as separate lines)
2. Under **Expenses**, enter annual operating costs: property taxes `24000`,
   insurance `7000`, repairs `8000`, landscaping `4800`, misc `1000`
   (leave the rest 0 — total $44,800)
3. Click **Save & calculate**

Optionally click **Run AI analysis on manual inputs** — the AI writes its
overview/opportunities/risks from your calculator inputs alone (uses API credits;
its summary notes the figures are user-entered and unverified by documents).

Expected results (identical to the Excel template):

| Metric | Value |
| --- | --- |
| Monthly debt service | $5,401.66 |
| NOI | $78,320 |
| Cap rate (on offer) | 7.83% |
| DSCR | 1.21 |
| Total cash needed | $210,000 |
| Cash-on-cash | 6.43% |
| What-if −$500 / base / +$500 | 3.57% / 6.43% / 9.29% |
| Value at 6% / 7% / 8% cap | $1,305,333 / $1,118,857 / $979,000 |

The valuation table shows the property is only worth its $1.3M asking at a 6% cap —
at 8% it's worth ~$979K, which is why the calculator's example offer was $1M.

### Test B extension — hold-period returns (IRR)

Still on the same analysis, scroll to **Assumptions**, enter and save:

| Field | Value |
| --- | --- |
| Hold period (years) | 5 |
| Exit cap rate (%) | 7 |
| Income growth (%/yr) | 2 |
| Expense growth (%/yr) | 2 |
| Sale costs (% of sale price) | 5 |

The **Hold-period returns (IRR)** section appears instantly with a year-by-year table
and these exact figures:

| Metric | Value |
| --- | --- |
| Year 1 cash flow | $13,500 |
| Projected sale price (year-6 NOI ÷ 7%) | $1,235,309 |
| Loan balance at exit | $724,497 |
| Net sale proceeds | $449,046 |
| Total profit | $322,527 |
| Equity multiple | 2.54x |
| IRR | 22.3% |

(Leave the growth/sale-cost fields blank and the engine uses 2% / 2% / 5% defaults —
same result.)

## Settings to try

Open **Settings** in the top navigation:

- **Claude model** — switch between Opus (most capable), Sonnet (cheaper), Haiku (cheapest)
- **AI usage** — after a few AI runs, see the run count, tokens, and estimated API cost
  (this ledger is what pay-per-use billing will draw on at hosting time)
- **Report branding** — set a company name, contact line, and accent color, then re-export
  a PDF or open a share link: your branding is on both
- **Underwriting defaults** — vacancy %, closing-cost %, interest rate, loan term
  (pre-fill new analyses)
- **Cap-rate bands** — e.g. `5.5,6.5,7.5` changes the valuation table everywhere
- **What-if rent step** — e.g. `250` tightens the sensitivity scenarios
- **Profile** — change your name or password

**Optional — invite-only signup:** add `INVITE_CODE="something"` to `.env` and restart.
The register page now demands the code; wrong or missing code → registration refused.
Remove the line (or leave it empty) to reopen signup.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "credit balance is too low" | Add API credits at console.anthropic.com → Plans & Billing, then re-run (no restart needed) |
| "ANTHROPIC_API_KEY is not configured" | Put the key in `.env`, restart `npm run dev` |
| "Cannot find module @prisma/client…" | Run `npx prisma@6.19.3 generate`, then restart |
| Prisma error P1012 mentioning `url` | Wrong Prisma major version — always use `npx prisma@6.19.3 …`, never plain `npx prisma …` |
| Analysis stuck on "AI reviewing…" | Check the terminal running `npm run dev` for the real error |

---
*All names, figures, and the property itself are fictional, generated for demonstration.*
*This kit is updated alongside the app — if a release changes the flow, this file changes with it.*
