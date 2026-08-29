import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import { readUpload } from "./storage";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

function resolveModel(override?: string | null): string {
  return override && override.trim() ? override : DEFAULT_MODEL;
}

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  if (!aiConfigured()) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Add it to .env to enable AI document analysis."
    );
  }
  return new Anthropic();
}

// ---------- Types shared with the UI ----------

export interface RawLine {
  label: string; // the document's original wording, verbatim
  annualAmount: number;
  source: string;
  confidence: "high" | "low"; // low = the mapping was a judgment call
  confirmed?: boolean; // set by the user in the mapping UI
}

export interface ExtractedLineItem {
  annualAmount: number;
  source: string; // where the number came from, e.g. "T-12 statement, 'Insurance' row"
  lines?: RawLine[]; // Layer 1: original document lines summed into this category
}

export interface ExcludedLine extends RawLine {
  fromSection: "income" | "expenses" | "belowNoi";
  fromKey: string; // category it was extracted into before the user excluded it
}

// Category ids follow the Multifamily AI Financial Classification Dictionary V1.
// Storage keys are stable: the pre-dictionary keys (grossPotentialRent = base
// rent, the first nine expense keys) are kept so older analyses stay readable.
export const INCOME_KEYS = [
  "grossPotentialRent", // #1 Base rent (storage key kept for compatibility)
  "vacancyLoss", // #2
  "badDebt", // #3
  "concessions", // #4
  "lateFees", // #5
  "applicationFees", // #6
  "petIncome", // #7
  "parkingIncome", // #8
  "laundryIncome", // #9
  "storageIncome", // #10
  "utilityReimbursement", // #11 — never netted against utility expense
  "miscIncome", // #12 — flag for review when the description is unclear
] as const;
export type IncomeKey = (typeof INCOME_KEYS)[number];

export { EXPENSE_KEYS, BELOW_NOI_KEYS } from "./underwriting";
import { EXPENSE_KEYS as EXPENSE_KEYS_, BELOW_NOI_KEYS as BELOW_NOI_KEYS_, type ExpenseKey, type BelowNoiKey } from "./underwriting";

export interface Extraction {
  income: Record<IncomeKey, ExtractedLineItem> & {
    // Present only in pre-dictionary extractions; when > 0 the engine uses it
    // instead of base rent − reductions, so old analyses keep their numbers.
    actualCollectedRent?: ExtractedLineItem;
  };
  expenses: Record<ExpenseKey, ExtractedLineItem>;
  belowNoi: Record<BelowNoiKey, ExtractedLineItem>; // #32–#36 — NEVER in NOI
  rentRoll: {
    unitCount: number;
    averageRentPerUnit: number; // $/unit/month
    occupancyPct: number;
  };
  dataFlags: { severity: "info" | "warning" | "critical"; message: string }[];
  excluded?: ExcludedLine[]; // lines the user removed from the analysis entirely
}

const emptyItem = (): ExtractedLineItem => ({ annualAmount: 0, source: "NOT FOUND", lines: [] });

// Normalize any stored extraction (old or new shape) to the full dictionary
// shape: every category present, legacy otherIncome mapped to miscIncome.
export function normalizeExtraction(raw: unknown): Extraction | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const income = {} as Extraction["income"];
  for (const k of INCOME_KEYS) income[k] = r.income?.[k] ?? emptyItem();
  // Keep the legacy category whenever it still carries data — a user edit can
  // zero its total while lines remain, and dropping it would lose them.
  const legacyCollected = r.income?.actualCollectedRent;
  if (legacyCollected && (legacyCollected.annualAmount > 0 || legacyCollected.lines?.length)) {
    income.actualCollectedRent = legacyCollected;
  }
  // Pre-dictionary extractions had a single lumped otherIncome line.
  if (r.income?.otherIncome?.annualAmount && income.miscIncome.annualAmount === 0) {
    income.miscIncome = r.income.otherIncome;
  }
  const expenses = {} as Extraction["expenses"];
  for (const k of EXPENSE_KEYS_) expenses[k] = r.expenses?.[k] ?? emptyItem();
  const belowNoi = {} as Extraction["belowNoi"];
  for (const k of BELOW_NOI_KEYS_) belowNoi[k] = r.belowNoi?.[k] ?? emptyItem();
  return {
    income,
    expenses,
    belowNoi,
    rentRoll: r.rentRoll ?? { unitCount: 0, averageRentPerUnit: 0, occupancyPct: 0 },
    dataFlags: Array.isArray(r.dataFlags) ? r.dataFlags : [],
    excluded: Array.isArray(r.excluded)
      ? // The lumped otherIncome bucket became miscIncome; remap old excluded
        // entries so their "restore" target still exists.
        r.excluded.map((e: ExcludedLine) =>
          e.fromSection === "income" && e.fromKey === "otherIncome"
            ? { ...e, fromKey: "miscIncome" }
            : e
        )
      : undefined,
  };
}

export interface AiSummary {
  overview: string;
  opportunities: string[];
  risks: string[];
  assumptionNotes: string[];
  summary: string;
}

// ---------- Document preparation ----------

interface DocInput {
  filename: string;
  mimeType: string;
  docType: string;
  path: string;
}

const MAX_SHEET_CHARS = 60_000;

function spreadsheetToText(data: Buffer): string {
  const wb = XLSX.read(data, { type: "buffer" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
    parts.push(`--- Sheet: ${name} ---\n${csv}`);
  }
  let text = parts.join("\n\n");
  if (text.length > MAX_SHEET_CHARS) {
    text = text.slice(0, MAX_SHEET_CHARS) + "\n[TRUNCATED — file continues]";
  }
  return text;
}

function isPdfDoc(doc: DocInput): boolean {
  return doc.mimeType === "application/pdf" || doc.filename.toLowerCase().endsWith(".pdf");
}

async function docContentBlocks(
  doc: DocInput,
  preloaded?: Buffer
): Promise<Anthropic.ContentBlockParam[]> {
  const header: Anthropic.ContentBlockParam = {
    type: "text",
    text: `Document: "${doc.filename}" (declared type: ${doc.docType})`,
  };
  const data = preloaded ?? (await readUpload(doc.path));
  if (isPdfDoc(doc)) {
    return [
      header,
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: data.toString("base64") },
      },
    ];
  }
  // Excel / CSV — convert to CSV text
  return [header, { type: "text", text: spreadsheetToText(data) }];
}

// ---------- Extraction ----------

// All assignable category ids (37): built from the same key arrays the engine
// and UI use, so the enum can never drift from the storage shape.
const CATEGORY_IDS = [
  ...INCOME_KEYS.map((k) => `income.${k}`),
  ...EXPENSE_KEYS_.map((k) => `expenses.${k}`),
  ...BELOW_NOI_KEYS_.map((k) => `belowNoi.${k}`),
];

// Layer 1: the original document lines, labels preserved verbatim. A single flat
// array keeps the compiled structured-output grammar small (nesting subschemas
// into every category blew the API's grammar-size limit); category totals are
// computed in code as the sum of their lines, so total-equals-sum holds by
// construction.
const rawLinesSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      category: { type: "string", enum: [...CATEGORY_IDS] },
      label: { type: "string" },
      annualAmount: { type: "number" },
      source: { type: "string" },
      confidence: { type: "string", enum: ["high", "low"] },
    },
    required: ["category", "label", "annualAmount", "source", "confidence"],
    additionalProperties: false,
  },
} as const;

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    rawLines: rawLinesSchema,
    rentRoll: {
      type: "object",
      properties: {
        unitCount: { type: "number" },
        averageRentPerUnit: { type: "number" },
        occupancyPct: { type: "number" },
      },
      required: ["unitCount", "averageRentPerUnit", "occupancyPct"],
      additionalProperties: false,
    },
    dataFlags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          message: { type: "string" },
        },
        required: ["severity", "message"],
        additionalProperties: false,
      },
    },
  },
  required: ["rawLines", "rentRoll", "dataFlags"],
  additionalProperties: false,
};

const EXTRACTION_SYSTEM = `You are a commercial real estate underwriting analyst assistant. You extract financial data from multifamily property documents (rent rolls, T-12 operating statements, offering memorandums, tax records, utility statements) and classify every line item using the Multifamily Financial Classification Dictionary below.

Core rules:
- Extract ANNUAL dollar amounts. If a document covers fewer than 12 months, annualize and flag it in dataFlags.
- "rawLines" lists EVERY original document line item you used: label EXACTLY as written in the document (never re-word it), the category you assigned, that line's annual amount, its source (document name + row/section), and a confidence. Never merge two document rows into one entry.
- confidence "low" whenever the mapping is a judgment call (ambiguous label, could belong to another category, unusual grouping). "high" only for unmistakable mappings.
- Do not invent numbers. Prefer the most recent trailing-12 data when multiple periods exist.
- Add a dataFlag for every important category with no document line (e.g. "Property taxes were not found in the provided documents"), for questionable values (insurance far below market, rent roll vs T-12 inconsistencies, totals that don't reconcile), and wherever a rule below says to flag.
- rentRoll.averageRentPerUnit is the average in-place monthly rent per occupied unit from the rent roll.

INCOME categories:
- income.grossPotentialRent — BASE RENT: rent for occupying units (a.k.a. rental income, rent, apartment/scheduled/contract/gross/market/potential rent). Includes contractual rent increases. Does NOT include late fees, parking, laundry, pet fees, or utility reimbursements. If the documents only report COLLECTED rent (no scheduled figure), put collections here and add a dataFlag saying the figure is collections-based.
- income.vacancyLoss — reduction: vacancy, physical/economic vacancy, loss to vacancy.
- income.badDebt — reduction: bad debt, collection/credit loss, uncollectible rent, delinquency loss.
- income.concessions — reduction: concessions, free rent, rent/move-in specials, discounts.
- income.lateFees — late fees/charges, delinquency fees.
- income.applicationFees — application/admin/administrative fees charged to tenants, move-in fees.
- income.petIncome — pet rent/fees, animal fees.
- income.parkingIncome — parking, garage income/rent.
- income.laundryIncome — laundry, washer/dryer income.
- income.storageIncome — storage rent/fees, lockers.
- income.utilityReimbursement — RUBS, utility recovery/reimbursement (water, sewer, utility income). NEVER net this against utility expense — record both sides separately.
- income.miscIncome — miscellaneous/other income. Flag for review when the underlying description is unclear.

OPERATING EXPENSE categories:
- expenses.managementFees — PROPERTY MANAGEMENT: third-party/percentage/fixed management fees. Does NOT include on-site employee wages (that is payroll). High confidence only when explicitly labeled.
- expenses.payroll — salaries, wages, on-site staff/personnel, payroll taxes, benefits, bonuses. Not management fees, not contractors.
- expenses.administrative — admin expense, G&A. HIGH-REVIEW category: owners put different things here — never automatically combine it with payroll or management fees; mark admin mappings "low" confidence unless unmistakable.
- expenses.repairsMaintenance — R&M, repairs, maintenance (plumbing/electrical/HVAC/appliance/general). NOT major capital improvements or renovations (those are belowNoi.capitalExpenditures).
- expenses.turnover — turnover, unit turn, make-ready, unit preparation (turnover cleaning/painting/minor repairs/flooring). Use expenses.repairsMaintenance instead when the documents don't separate turnover.
- expenses.utilities — water, sewer, gas, electric, trash paid by the property. Keep separate from income.utilityReimbursement.
- expenses.propertyTaxes — real estate/RE/county taxes. NOT income taxes or payroll taxes.
- expenses.insurance — property/liability/casualty/building insurance.
- expenses.landscaping — landscaping, lawn care, grounds (maintenance).
- expenses.snowRemoval — snow removal/plowing, snow & ice. Use expenses.landscaping when the documents combine them.
- expenses.janitorial — janitorial, cleaning services, custodial, housekeeping (common areas).
- expenses.pestControl — pest control, extermination.
- expenses.security — security services/guard, patrol, monitoring.
- expenses.marketing — marketing, advertising, leasing advertising, promotion.
- expenses.legal — legal/attorney fees for NORMAL operations. Acquisition, disposition, financing, or development legal costs: put in expenses.legal but add a dataFlag that they may be non-operating.
- expenses.accounting — accounting/CPA/bookkeeping/audit fees.
- expenses.officeSupplies — office expense/supplies/costs. May overlap with administrative — do not combine them yourself; keep each line where its label points and mark "low" confidence if unclear.
- expenses.bankFees — bank/banking/credit-card/merchant/transaction fees.
- expenses.licensesPermits — licenses, permits, inspection fees.
- expenses.other — ONLY what fits no category above (e.g. HOA dues). Keep the original label and add a dataFlag so the user reviews it.

BELOW-NOI categories (report them, but they are NEVER operating expenses and NEVER reduce NOI):
- belowNoi.capitalExpenditures — CapEx, capital improvements/projects, replacements, reserves, roof/HVAC replacement, major renovation, parking lot.
- belowNoi.tenantImprovements — TI, tenant buildout, leasehold improvements.
- belowNoi.leasingCommissions — LC, leasing/broker commissions, leasing fees.
- belowNoi.debtService — mortgage, loan payment, principal & interest, P&I, interest expense.
- belowNoi.depreciationAmortization — depreciation, amortization, D&A.`;

export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function extractFromDocuments(
  docs: DocInput[],
  model?: string | null
): Promise<{ extraction: Extraction; usage: AiUsage }> {
  const client = getClient();

  const content: Anthropic.ContentBlockParam[] = [];
  for (const doc of docs) content.push(...(await docContentBlocks(doc)));
  content.push({
    type: "text",
    text: "Extract the income, expense, and rent roll data from the documents above into the required JSON structure. Remember: annual amounts, sources for every number, and data quality flags.",
  });

  // Streamed: the SDK requires streaming for requests whose max_tokens implies a
  // potentially >10-minute response; finalMessage() gives the same Message object.
  const response = await client.messages
    .stream({
      model: resolveModel(model),
      max_tokens: 24000,
      thinking: { type: "adaptive" },
      system: EXTRACTION_SYSTEM,
      output_config: { format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
      messages: [{ role: "user", content }],
    })
    .finalMessage();

  if (response.stop_reason === "refusal") {
    throw new Error("The AI declined to process these documents.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("AI extraction output was truncated. Try uploading fewer/smaller documents.");
  }

  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("AI extraction returned no output.");
  const parsed = JSON.parse(text) as {
    rawLines: { category: string; label: string; annualAmount: number; source: string; confidence: "high" | "low" }[];
    rentRoll: Extraction["rentRoll"];
    dataFlags: Extraction["dataFlags"];
  };

  // Build the category structure from the flat line ledger: every category's
  // total is the sum of its lines, so total-equals-sum holds by construction.
  const extraction = normalizeExtraction({ rentRoll: parsed.rentRoll, dataFlags: parsed.dataFlags })!;
  for (const rl of parsed.rawLines ?? []) {
    const [sec, key] = rl.category.split(".");
    const group =
      sec === "income" || sec === "expenses" || sec === "belowNoi"
        ? (extraction[sec] as Record<string, ExtractedLineItem>)
        : undefined;
    const bucket = group?.[key];
    if (!bucket) continue;
    (bucket.lines ??= []).push({
      label: rl.label,
      annualAmount: rl.annualAmount,
      source: rl.source,
      confidence: rl.confidence,
    });
    bucket.annualAmount += rl.annualAmount;
    bucket.source =
      bucket.lines!.length === 1
        ? rl.source
        : `${bucket.lines!.length} document lines (see the expanded category)`;
  }
  return {
    extraction,
    usage: {
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

// ---------- Document sanity check (cheap, at upload time) ----------

const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    detectedType: {
      type: "string",
      enum: ["RENT_ROLL", "T12", "OFFERING_MEMO", "CALC_WORKSHEET", "OTHER"],
    },
    note: { type: "string" },
  },
  required: ["detectedType", "note"],
  additionalProperties: false,
} as const;

export interface DocClassification {
  detectedType: "RENT_ROLL" | "T12" | "OFFERING_MEMO" | "CALC_WORKSHEET" | "OTHER";
  note: string;
}

// PDFs above this are skipped: base64 expansion would blow the API request cap,
// and huge files are the slowest to round-trip for a mere shape check.
const MAX_CLASSIFY_PDF_BYTES = 15 * 1024 * 1024;

// Runs on Haiku regardless of the user's chosen model: it's a shape check, not
// an extraction, and should cost a fraction of a cent. Pass the upload buffer
// to avoid re-reading the file that was just written.
export async function classifyDocument(
  doc: DocInput,
  data?: Buffer
): Promise<{ classification: DocClassification; usage: AiUsage }> {
  const buffer = data ?? (await readUpload(doc.path));
  if (isPdfDoc(doc) && buffer.length > MAX_CLASSIFY_PDF_BYTES) {
    throw new Error("PDF too large for the upload sanity check.");
  }
  const client = getClient();
  const content: Anthropic.ContentBlockParam[] = await docContentBlocks(doc, buffer);
  content.push({
    type: "text",
    text: `What kind of document is this?
- RENT_ROLL: unit-by-unit listing of rents/occupancy
- T12: monthly operating income & expense history (trailing twelve months or similar P&L)
- OFFERING_MEMO: marketing/deal package describing a property
- CALC_WORKSHEET: a calculator, model, or what-if worksheet of assumptions rather than records
- OTHER: anything else (tax bill, insurance, lease, utility statement, ...)
Give the single best type and a one-sentence note describing what the file actually contains.`,
  });
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 300,
    system:
      "You classify real-estate documents by their actual content. Answer with the JSON structure only.",
    output_config: { format: { type: "json_schema", schema: CLASSIFY_SCHEMA } },
    messages: [{ role: "user", content }],
  });
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Classifier returned no output.");
  return {
    classification: JSON.parse(text) as DocClassification,
    usage: {
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}

// ---------- Analysis summary ----------

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string" },
    opportunities: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    assumptionNotes: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: ["overview", "opportunities", "risks", "assumptionNotes", "summary"],
  additionalProperties: false,
};

const SUMMARY_SYSTEM = `You are an underwriting assistant for commercial real estate professionals. You produce professional, factual investment analysis summaries for multifamily properties.

Strict rules:
- You are a data organization, underwriting, financial analysis, scenario modeling, and risk identification assistant. You are NOT an investment advisor, financial advisor, appraiser, or decision-maker.
- NEVER make a definitive investment recommendation. Never say "this property is a good investment" or "you should buy this". Instead use language like "the analysis indicates this property may meet selected investment criteria based on the assumptions entered; users should verify all information before making decisions."
- Ground every statement in the provided figures and cite assumptions explicitly (e.g. "based on the assumed market rent of $X/unit/month").
- opportunities: concrete value-add opportunities visible in the data (below-market rents, renovation upside, expense reduction, additional income potential).
- risks: items that should be investigated (high insurance, deferred maintenance implied by age, low DSCR, incomplete financial information, market uncertainty).
- assumptionNotes: list the key assumptions that drive the results and what happens if they change.
- summary: a short closing paragraph that reminds the user to verify AI-generated information before using it for investment decisions.`;

export async function generateSummary(
  context: string,
  model?: string | null
): Promise<{ summary: AiSummary; usage: AiUsage }> {
  const client = getClient();

  const response = await client.messages
    .stream({
      model: resolveModel(model),
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: SUMMARY_SYSTEM,
      output_config: { format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Here is the underwriting data for a multifamily property analysis. Produce the property analysis summary.\n\n${context}`,
        },
      ],
    })
    .finalMessage();

  if (response.stop_reason === "refusal") {
    throw new Error("The AI declined to summarize this analysis.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("AI summary output was truncated. Try re-running the analysis.");
  }

  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("AI summary returned no output.");
  return {
    summary: JSON.parse(text) as AiSummary,
    usage: {
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
