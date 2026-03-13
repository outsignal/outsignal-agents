import { NextRequest, NextResponse } from "next/server";
import { importClayContacts, importClayCompany } from "@/lib/clay/sync";
import { notify } from "@/lib/notify";
import { parseJsonBody } from "@/lib/parse-json";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { importPeopleSchema } from "@/lib/validations/people";

export async function POST(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await parseJsonBody(request);
    if (body instanceof Response) return body;
    const result = importPeopleSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
    }
    const { contacts, company, workspace, vertical } = result.data;

    const results: { contacts?: { created: number; updated: number; errors: number }; company?: { domain: string } } = {};

    if (contacts && Array.isArray(contacts)) {
      results.contacts = await importClayContacts(contacts as unknown as Parameters<typeof importClayContacts>[0], {
        workspace,
        vertical,
      });
    }

    if (company) {
      const saved = await importClayCompany(company as unknown as Parameters<typeof importClayCompany>[0]);
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
