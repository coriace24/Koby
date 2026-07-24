# Koby — AI Multifamily Underwriting Assistant

Koby is an AI-powered underwriting platform for multifamily real estate. It helps brokers,
investors, and acquisition teams analyze a property in minutes instead of hours: upload the
rent roll and T-12, and Koby extracts the financials, runs the underwriting math, surfaces
value-add opportunities and risks, and produces an investor-ready PDF summary.

Koby assists real estate professionals — it does not replace professional judgment. All
AI-generated information must be reviewed and verified before being used for investment
decisions.

## Features

- **Accounts & dashboard** — email/password login; portfolio snapshot (deals, units,
  combined value, average cap rate and cash flow) plus analysis status tracking.
- **Deal calculator (no documents needed)** — modeled on a proven investor Excel
  calculator: unit-mix rent builder with NNN/utility fees, quick annual operating-cost
  estimator, total-cash-needed (down payment + closing + carrying + renovation),
  cap-rate valuation matrix ("what is it worth at 6/7/8%?") vs asking price, and a
  what-if rent sensitivity table. Instant results; AI-extracted figures take over once
  documents are analyzed.
- **Settings** — choose the Claude model (Opus/Sonnet/Haiku), set underwriting defaults
  (vacancy, closing-cost %, interest rate, loan term), configure cap-rate bands and the
  what-if step, set report branding, review AI usage, change your name/password.
- **Create property analysis** — address, purchase price, units, property type, year built,
  occupancy, and financing assumptions; optional renovation budget, target return, strategy,
  and free-form notes.
- **Document upload** — rent roll and T-12 (required), plus offering memos, tax records,
  insurance, utility statements, leases, and financials. PDF, Excel, and CSV supported.
- **AI document analysis** — Claude extracts income (GPR, collections, vacancy loss, other
  income) and expenses (taxes, insurance, utilities, R&M, management, payroll, landscaping,
  admin, other), cites the source of every figure, and flags incomplete or questionable data
  (e.g. "utility expenses only include four months of data").
- **Underwriting engine** (deterministic, not AI) — NOI, cap rate, amortized debt service,
  DSCR, cash flow after debt, equity requirement, cash-on-cash return, expense ratio, and
  break-even occupancy.
- **Value-add analysis** — rent-growth upside vs. assumed market rent, renovation ROI and
  value impact at an exit cap rate, and a stabilized projection with a vacancy haircut.
- **Editable assumptions & overrides** — change any assumption or extracted figure; the
  engine recalculates immediately. The AI never makes definitive investment
  recommendations — it presents figures, assumptions, opportunities, and risks.
- **Hold-period returns (IRR)** — set a hold period, exit cap rate, income/expense growth,
  and sale costs; get a year-by-year cash-flow projection, projected sale price, net
  proceeds after loan payoff, total profit, equity multiple, and IRR.
- **Branded PDF reports** — export a professional investment summary carrying your company
  name, contact line, and accent color (set once in Settings).
- **Share links** — generate a read-only public link per analysis (branded summary page +
  PDF download, no login needed); revoke any link at any time.
- **AI usage metering** — every AI run is recorded (model, tokens, estimated API cost) and
  shown in Settings; a credit ledger and the `BILLING_ENFORCED` switch are the scaffold for
  pay-per-use billing at hosting time.
- **Invite-only registration (optional)** — set `INVITE_CODE` to gate signups.

## Stack

Next.js (App Router, TypeScript) · Prisma + SQLite · Tailwind CSS ·
Anthropic Claude API (`@anthropic-ai/sdk`) · PDFKit · SheetJS

## Getting started

```bash
npm install
cp .env.example .env   # then edit .env
npx prisma@6.19.3 db push   # creates prisma/dev.db (always pin @6.19.3 — Prisma 7 breaks this schema)
npm run dev
```

Open http://localhost:3000, register an account, and create your first analysis.

### Environment variables (`.env`)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite location, default `file:./dev.db` |
| `SESSION_SECRET` | Secret used to sign session cookies — change it in production |
| `ANTHROPIC_API_KEY` | Anthropic API key. Without it, uploads and the underwriting math still work, but AI extraction/summaries return a configuration error |
| `ANTHROPIC_MODEL` | Optional model override (default `claude-opus-4-8`) |
| `BILLING_ENFORCED` | `"true"` makes each AI run consume 1 credit and blocks runs at 0 credits (default off — unlimited local use). Usage is metered either way |
| `INVITE_CODE` | If set, new registrations must supply this code; leave empty for open signup |

## Try it with sample data

The [`samples/`](samples/) folder contains a ready-made test kit: an example rent roll and
T-12 for a fictional 15-unit property, plus a step-by-step walkthrough with the exact
inputs to enter and the results to expect. Start there.

## How an analysis flows

1. **Create** the analysis with property + financing inputs.
2. **Upload** at least a Rent Roll and a T-12 Operating Statement.
3. **Run AI analysis** — Claude reads the documents, extracts annualized financials with
   per-figure sources, and flags data-quality issues; the underwriting engine computes all
   metrics; Claude then writes the overview, opportunities, risks, and assumption notes
   grounded in those computed figures.
4. **Review & adjust** — edit assumptions (market rent, renovation plan, vacancy, financing)
   or override extracted figures; metrics recalculate instantly. Re-run the AI analysis to
   refresh the written summary.
5. **Export** the branded PDF investment summary, or create a **share link** so investors
   can view a read-only summary page without an account.

Analyses with data-quality warnings are marked **"User verification required"**; clean runs
are marked **"Analysis completed"**.

## Notes

- Uploaded documents are stored under `./uploads/` and the SQLite database under `prisma/`
  — both are git-ignored.
- The database schema is in `prisma/schema.prisma`; the financial formulas are in
  `src/lib/underwriting.ts`; the AI prompts and schemas are in `src/lib/ai.ts`.
