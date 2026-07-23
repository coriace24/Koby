import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import * as XLSX from "xlsx";

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

export interface ExtractedLineItem {
  annualAmount: number;
  source: string; // where the number came from, e.g. "T-12 statement, 'Insurance' row"
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

function spreadsheetToText(filePath: string): string {
  const wb = XLSX.readFile(filePath);
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

function docContentBlocks(doc: DocInput): Anthropic.ContentBlockParam[] {
  const header: Anthropic.ContentBlockParam = {
    type: "text",
    text: `Document: "${doc.filename}" (declared type: ${doc.docType})`,
  };
  if (doc.mimeType === "application/pdf" || doc.filename.toLowerCase().endsWith(".pdf")) {
    const data = fs.readFileSync(doc.path).toString("base64");
    return [
      header,
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
      },
    ];
  }
  // Excel / CSV — convert to CSV text
  return [header, { type: "text", text: spreadsheetToText(doc.path) }];
}

// ---------- Extraction ----------

const lineItemSchema = {
  type: "object",
  properties: {
    annualAmount: { type: "number" },
    source: { type: "string" },
  },
  required: ["annualAmount", "source"],
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
- Do not invent numbers. Prefer the most recent trailing-12 data when multiple periods exist.`;

export async function extractFromDocuments(docs: DocInput[], model?: string | null): Promise<Extraction> {
  const client = getClient();

  const content: Anthropic.ContentBlockParam[] = [];
  for (const doc of docs) content.push(...docContentBlocks(doc));
  content.push({
    type: "text",
    text: "Extract the income, expense, and rent roll data from the documents above into the required JSON structure. Remember: annual amounts, sources for every number, and data quality flags.",
  });

  const response = await client.messages.create({
    model: resolveModel(model),
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: EXTRACTION_SYSTEM,
    output_config: { format: { type: "json_schema", schema: EXTRACTION_SCHEMA } },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The AI declined to process these documents.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("AI extraction output was truncated. Try uploading fewer/smaller documents.");
  }

  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("AI extraction returned no output.");
  return JSON.parse(text) as Extraction;
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

export async function generateSummary(context: string, model?: string | null): Promise<AiSummary> {
  const client = getClient();

  const response = await client.messages.create({
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
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The AI declined to summarize this analysis.");
  }

  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("AI summary returned no output.");
  return JSON.parse(text) as AiSummary;
}
