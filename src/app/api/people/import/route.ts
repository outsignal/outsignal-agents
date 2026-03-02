import { NextRequest, NextResponse } from "next/server";
import { importClayContacts, importClayCompany } from "@/lib/clay/sync";
import { notify } from "@/lib/notify";

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

    if (results.contacts) {
      notify({
        type: "system",
        severity: "info",
        title: `Clay import completed`,
        message: `${results.contacts.created} created, ${results.contacts.updated} updated`,
        metadata: { created: results.contacts.created, updated: results.contacts.updated },
      }).catch(() => {});
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json(
      { error: "Failed to import people" },
      { status: 500 },
    );
  }
}
