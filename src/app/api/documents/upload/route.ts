import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { documentUploadJsonSchema } from "@/lib/validations/documents";

// NOTE: This route intentionally uses the default Node.js runtime.
// Do NOT add `export const runtime = "edge"` — pdf-parse requires Node.js fs.

// pdf-parse v2 exports { PDFParse } class (not a function). We use dynamic
// import with any cast to avoid conflict with @types/pdf-parse (v1 types).
async function extractPdfText(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfModule = (await import("pdf-parse")) as any;
  const PDFParseClass = pdfModule.PDFParse ?? pdfModule.default?.PDFParse;
  if (!PDFParseClass) {
    throw new Error("pdf-parse module does not export PDFParse class");
  }
  const parser = new PDFParseClass({ data: buffer });
  const result = await parser.getText();
  return (result.text as string) ?? "";
}

// ---------------------------------------------------------------------------
// Heuristic field parser
// ---------------------------------------------------------------------------

interface ParsedFields {
  clientName?: string;
  clientEmail?: string;
  companyOverview?: string;
  packageType?: string;
  setupFee?: number;
  platformCost?: number;
  retainerCost?: number;
}

function extractField(text: string, patterns: string[]): string | undefined {
  for (const pattern of patterns) {
    const regex = new RegExp(
      `${pattern}[:\\s]+([^\n]+)`,
      "i",
    );
    const match = text.match(regex);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

function parsePence(value: string | undefined): number | undefined {
  if (!value) return undefined;
  // Strip currency symbols, commas, whitespace
  const cleaned = value.replace(/[£$€,\s]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return undefined;
  // Convert to pence (multiply by 100)
  return Math.round(num * 100);
}

function parseFields(text: string): ParsedFields {
  const parsed: ParsedFields = {};

  const clientName = extractField(text, [
    "Client Name",
    "Client",
    "Company Name",
  ]);
  if (clientName) parsed.clientName = clientName;

  const clientEmail = extractField(text, [
    "Client Email",
    "Email",
    "Contact Email",
  ]);
  if (clientEmail && clientEmail.includes("@")) {
    parsed.clientEmail = clientEmail;
  }

  const companyOverview = extractField(text, [
    "Company Overview",
    "Company Description",
    "About",
    "Overview",
  ]);
  if (companyOverview) parsed.companyOverview = companyOverview;

  const packageTypeRaw = extractField(text, [
    "Package Type",
    "Package",
    "Service",
  ]);
  if (packageTypeRaw) {
    const lower = packageTypeRaw.toLowerCase();
    if (lower.includes("linkedin") && lower.includes("email")) {
      parsed.packageType = "email_linkedin";
    } else if (lower.includes("linkedin")) {
      parsed.packageType = "linkedin";
    } else if (lower.includes("email")) {
      parsed.packageType = "email";
    }
  }

  const setupFeeRaw = extractField(text, ["Setup Fee", "Setup Cost", "Setup"]);
  const setupFee = parsePence(setupFeeRaw);
  if (setupFee !== undefined) parsed.setupFee = setupFee;

  const platformCostRaw = extractField(text, [
    "Platform Cost",
    "Platform Fee",
    "Platform",
  ]);
  const platformCost = parsePence(platformCostRaw);
  if (platformCost !== undefined) parsed.platformCost = platformCost;

  const retainerCostRaw = extractField(text, [
    "Retainer Cost",
    "Retainer Fee",
    "Monthly Retainer",
    "Retainer",
  ]);
  const retainerCost = parsePence(retainerCostRaw);
  if (retainerCost !== undefined) parsed.retainerCost = retainerCost;

  return parsed;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  // --- Mode 1: PDF file upload (multipart/form-data) ---
  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Failed to parse form data" },
        { status: 400 },
      );
    }

    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 },
      );
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF files are accepted" },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File size exceeds the 10 MB limit" },
        { status: 400 },
      );
    }

    let text: string;
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      text = await extractPdfText(buffer);
    } catch (err) {
      console.error("[POST /api/documents/upload] PDF parse error:", err);
      return NextResponse.json(
        { error: "Failed to parse PDF" },
        { status: 500 },
      );
    }

    return NextResponse.json({ parsed: parseFields(text), raw: text });
  }

  // --- Mode 2: JSON (Google Doc URL or raw text paste) ---
  if (contentType.includes("application/json")) {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }
    const parseResult = documentUploadJsonSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json({ error: "Validation failed", details: parseResult.error.flatten().fieldErrors }, { status: 400 });
    }
    const body = parseResult.data as { url?: string; text?: string; type?: string };

    // Raw text paste mode
    if (body.type === "text" && body.text) {
      const text = body.text;
      return NextResponse.json({ parsed: parseFields(text), raw: text });
    }

    // Google Doc URL mode
    if (body.url) {
      const docId = body.url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1];
      if (!docId) {
        return NextResponse.json(
          { error: "Invalid Google Doc URL — could not extract document ID" },
          { status: 400 },
        );
      }

      const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
      let res: Response;
      try {
        res = await fetch(exportUrl);
      } catch {
        return NextResponse.json(
          { error: "Failed to fetch Google Doc" },
          { status: 400 },
        );
      }

      if (!res.ok || !res.headers.get("content-type")?.includes("text/plain")) {
        return NextResponse.json(
          {
            error:
              "Document must be publicly shared. Ensure 'Anyone with the link can view' is enabled.",
          },
          { status: 400 },
        );
      }

      const text = await res.text();
      return NextResponse.json({ parsed: parseFields(text), raw: text });
    }

    return NextResponse.json(
      { error: "Provide either a Google Doc URL (url) or raw text (text + type='text')" },
      { status: 400 },
    );
  }

  return NextResponse.json(
    { error: "Unsupported content type. Use multipart/form-data for PDF or application/json for URL/text." },
    { status: 415 },
  );
}
