import { NextRequest, NextResponse } from "next/server";
import { importClayContacts, importClayCompany } from "@/lib/clay/sync";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contacts, company, workspace, vertical } = body;

    const results: { contacts?: { created: number; updated: number; errors: number }; company?: { domain: string } } = {};

    if (contacts && Array.isArray(contacts)) {
      results.contacts = await importClayContacts(contacts, {
        workspace,
        vertical,
      });
    }

    if (company) {
      const saved = await importClayCompany(company);
      results.company = { domain: saved.domain };
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: "Failed to import leads" },
      { status: 500 },
    );
  }
}
