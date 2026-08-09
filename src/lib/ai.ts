import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import { readUpload } from "./storage";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

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
  fromSection: "income" | "expenses";
  fromKey: string; // category it was extracted into before the user excluded it
}

export interface Extraction {
  income: {
    grossPotentialRent: ExtractedLineItem;
    actualCollectedRent: ExtractedLineItem;
    vacancyLoss: ExtractedLineItem;
    otherIncome: ExtractedLineItem;
  };
  expenses: {
    propertyTaxes: ExtractedLineItem;
    insurance: ExtractedLineItem;
    utilities: ExtractedLineItem;
    repairsMaintenance: ExtractedLineItem;
    managementFees: ExtractedLineItem;
    payroll: ExtractedLineItem;
    landscaping: ExtractedLineItem;
    administrative: ExtractedLineItem;
    other: ExtractedLineItem;
  };
  rentRoll: {
    unitCount: number;
    averageRentPerUnit: number; // $/unit/month
    occupancyPct: number;
  };
  dataFlags: { severity: "info" | "warning" | "critical"; message: string }[];
  excluded?: ExcludedLine[]; // lines the user removed from the analysis entirely
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

async function docContentBlocks(
  doc: DocInput,
  preloaded?: Buffer
): Promise<Anthropic.ContentBlockParam[]> {
  const header: Anthropic.ContentBlockParam = {
    type: "text",
    text: `Document: "${doc.filename}" (declared type: ${doc.docType})`,
  };
  const data = preloaded ?? (await readUpload(doc.path));
  if (doc.mimeType === "application/pdf" || doc.filename.toLowerCase().endsWith(".pdf")) {
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

// Layer 1: the original document lines, labels preserved verbatim, that were
// summed into a category — so users can see and correct the mapping.
const rawLineSchema = {
  type: "object",
  properties: {
    label: { type: "string" },
    annualAmount: { type: "number" },
    source: { type: "string" },
    confidence: { type: "string", enum: ["high", "low"] },
  },
  required: ["label", "annualAmount", "source", "confidence"],
  additionalProperties: false,
} as const;

const lineItemSchema = {
  type: "object",
  properties: {
    annualAmount: { type: "number" },
    source: { type: "string" },
    lines: { type: "array", items: rawLineSchema },
  },
  required: ["annualAmount", "source", "lines"],
  additionalProperties: false,
} as const;

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    income: {
      type: "object",
      properties: {
        grossPotentialRent: lineItemSchema,
        actualCollectedRent: lineItemSchema,
        vacancyLoss: lineItemSchema,
        otherIncome: lineItemSchema,
      },
      required: ["grossPotentialRent", "actualCollectedRent", "vacancyLoss", "otherIncome"],
      additionalProperties: false,
    },
    expenses: {
      type: "object",
      properties: {
        propertyTaxes: lineItemSchema,
        insurance: lineItemSchema,
        utilities: lineItemSchema,
        repairsMaintenance: lineItemSchema,
        managementFees: lineItemSchema,
        payroll: lineItemSchema,
        landscaping: lineItemSchema,
        administrative: lineItemSchema,
        other: lineItemSchema,
      },
      required: [
        "propertyTaxes",
        "insurance",
        "utilities",
        "repairsMaintenance",
        "managementFees",
        "payroll",
        "landscaping",
        "administrative",
        "other",
      ],
      additionalProperties: false,
    },
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
  required: ["income", "expenses", "rentRoll", "dataFlags"],
  additionalProperties: false,
};

const EXTRACTION_SYSTEM = `You are a commercial real estate underwriting analyst assistant. You extract financial data from multifamily property documents (rent rolls, T-12 operating statements, offering memorandums, tax records, utility statements).

Rules:
- Extract ANNUAL dollar amounts. If a document covers fewer than 12 months, annualize and flag it in dataFlags (e.g. "Utility expenses only include four months of data. Annualization applied and verification is recommended.").
- Every extracted number must cite its source: the document name and the specific row/section it came from. If a value could not be found, set annualAmount to 0 and source to "NOT FOUND" and add a dataFlag (e.g. "Property taxes were not included in the provided documents.").
- Flag questionable values in dataFlags (e.g. insurance far below typical market levels, vacancy inconsistent between rent roll and T-12, totals that don't reconcile).
- rentRoll.averageRentPerUnit is the average in-place monthly rent per occupied unit from the rent roll.
- Do not invent numbers. Prefer the most recent trailing-12 data when multiple periods exist.

Raw line ledger — every property owner labels their financials differently, so preserve the document's own wording:
- For each category, "lines" lists the ORIGINAL document line items you summed into it: label EXACTLY as written in the document (never re-word it), that line's annual amount, its source, and a confidence.
- confidence "low" whenever the mapping is a judgment call (ambiguous label, could belong to another category, unusual grouping). "high" only for unmistakable mappings.
- A category's annualAmount must equal the sum of its lines when lines exist. A category with no matching document lines has lines: [] and annualAmount 0.
- Never merge two document lines into one entry; one document row = one line.

Category mapping guide (synonyms owners commonly use):
- grossPotentialRent: gross scheduled rent, market rent, gross potential income, scheduled rent at 100%.
- actualCollectedRent: rent collected, net rental income, rental receipts, effective rental income.
- vacancyLoss: vacancy, vacancy & credit loss, concessions, bad debt, loss to lease.
- otherIncome: laundry, parking, pet fees/rent, storage, application fees, late fees, RUBS/utility reimbursement.
- propertyTaxes: real estate taxes, RE taxes, property tax.
- insurance: property/hazard/liability insurance.
- utilities: water, sewer, gas, electric, trash/refuse.
- repairsMaintenance: repairs, maintenance, turns, make-ready, cleaning, contract services, supplies, pest control.
- managementFees: property management, PM fee, asset management fee.
- payroll: salaries, wages, on-site staff/manager, payroll taxes, employee benefits.
- landscaping: grounds, lawn care, snow removal, CAM/common area maintenance.
- administrative: office, legal, accounting, professional fees, marketing, advertising, permits/licenses.
- other: reserves, capital expenditure holdback, and anything that fits no category above (keep its original label so the user can re-map it).`;

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
  return {
    extraction: JSON.parse(text) as Extraction,
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
  const isPdf = doc.mimeType === "application/pdf" || doc.filename.toLowerCase().endsWith(".pdf");
  if (isPdf && (data?.length ?? Infinity) > MAX_CLASSIFY_PDF_BYTES) {
    throw new Error("PDF too large for the upload sanity check.");
  }
  const client = getClient();
  const content: Anthropic.ContentBlockParam[] = await docContentBlocks(doc, data);
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
