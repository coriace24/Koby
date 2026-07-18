# Koby — AI Multifamily Underwriting Assistant

Koby is an AI-powered underwriting platform for multifamily real estate. It helps brokers,
investors, and acquisition teams analyze a property in minutes instead of hours: upload the
rent roll and T-12, and Koby extracts the financials, runs the underwriting math, surfaces
value-add opportunities and risks, and produces an investor-ready PDF summary.

Koby assists real estate professionals — it does not replace professional judgment. All
AI-generated information must be reviewed and verified before being used for investment
decisions.

## Features (MVP)

- **Accounts & dashboard** — email/password login; active and completed analyses at a glance.
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
- **PDF reports** — export a professional investment summary to share with investors.

## Stack

Next.js (App Router, TypeScript) · Prisma + SQLite · Tailwind CSS ·
Anthropic Claude API (`@anthropic-ai/sdk`) · PDFKit · SheetJS

## Getting started

```bash
npm install
cp .env.example .env   # then edit .env
npx prisma db push     # creates prisma/dev.db
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
5. **Export** the PDF investment summary.

Analyses with data-quality warnings are marked **"User verification required"**; clean runs
are marked **"Analysis completed"**.

## Notes

- Uploaded documents are stored under `./uploads/` and the SQLite database under `prisma/`
  — both are git-ignored.
- The database schema is in `prisma/schema.prisma`; the financial formulas are in
  `src/lib/underwriting.ts`; the AI prompts and schemas are in `src/lib/ai.ts`.
