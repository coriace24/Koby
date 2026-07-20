# Koby — Test Kit

Everything you need to test the app end to end with realistic (but fictional) data for
**Maple Court Apartments**, a 15-unit property at 1428 Maple Court, Springfield, IL.

| File | Upload as | What's inside |
| --- | --- | --- |
| `sample-rent-roll.xlsx` | **Rent Roll** | 15 units (nine 1BR, six 2BR), one vacancy (unit 205), 93.3% occupied, in-place rents deliberately below market |
| `sample-t12.xlsx` | **T-12 Operating Statement** | Jul 2025 – Jun 2026 monthly income & expenses; reconciles with the rent roll; **payroll intentionally absent** so the AI raises a data-verification flag |
| `make_samples.py` | — | Python script that regenerates both files (`pip install openpyxl`, then `python make_samples.py`) |

## Prerequisites

- The app is running (see the main [README](../README.md) for setup), locally or in a
  GitHub Codespace.
- `ANTHROPIC_API_KEY` is set in `.env` **and the Anthropic account has API credits**
  (console.anthropic.com → Plans & Billing). Without credits the AI step fails with a
  "credit balance is too low" error.

## Test walkthrough

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

### 3. Upload the documents

- `sample-rent-roll.xlsx` with document type **Rent Roll (required)**
- `sample-t12.xlsx` with document type **T-12 Operating Statement (required)**

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

### 6. Override a figure

In **Extracted financials**, click any amount, type a new value, and watch the metrics
recalculate. Overridden values are marked "User override".

### 7. Export the report

Click **Export PDF report** (top right) — a professional investment summary including the
metrics, value-add analysis, AI narrative, data flags, and the verification disclaimer.

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
