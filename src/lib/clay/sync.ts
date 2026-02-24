import { prisma } from "@/lib/db";

interface ClayContact {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  companyDomain?: string;
  jobTitle?: string;
  phone?: string;
  linkedinUrl?: string;
  location?: string;
  enrichmentData?: Record<string, unknown>;
}

interface ClayCompany {
  name: string;
  domain: string;
  industry?: string;
  headcount?: number;
  location?: string;
  techStack?: Record<string, unknown>;
  enrichmentData?: Record<string, unknown>;
}

export async function importClayContacts(
  contacts: ClayContact[],
  options?: { workspace?: string; vertical?: string },
) {
  const results = { created: 0, updated: 0, errors: 0 };

  for (const contact of contacts) {
    try {
      await prisma.lead.upsert({
        where: {
          email_workspace: {
            email: contact.email,
            workspace: options?.workspace ?? "",
          },
        },
        create: {
          email: contact.email,
          firstName: contact.firstName,
          lastName: contact.lastName,
          company: contact.company,
          companyDomain: contact.companyDomain,
          jobTitle: contact.jobTitle,
          phone: contact.phone,
          linkedinUrl: contact.linkedinUrl,
          location: contact.location,
          source: "clay",
          workspace: options?.workspace ?? null,
          vertical: options?.vertical,
          enrichmentData: contact.enrichmentData
            ? JSON.stringify(contact.enrichmentData)
            : null,
        },
        update: {
          firstName: contact.firstName,
          lastName: contact.lastName,
          company: contact.company,
          companyDomain: contact.companyDomain,
          jobTitle: contact.jobTitle,
          phone: contact.phone,
          linkedinUrl: contact.linkedinUrl,
          location: contact.location,
          enrichmentData: contact.enrichmentData
            ? JSON.stringify(contact.enrichmentData)
            : undefined,
        },
      });
      results.created++;
    } catch {
      results.errors++;
    }
  }

  return results;
}

export async function importClayCompany(company: ClayCompany) {
  return prisma.company.upsert({
    where: { domain: company.domain },
    create: {
      name: company.name,
      domain: company.domain,
      industry: company.industry,
      headcount: company.headcount,
      location: company.location,
      techStack: company.techStack ? JSON.stringify(company.techStack) : null,
      enrichmentData: company.enrichmentData
        ? JSON.stringify(company.enrichmentData)
        : null,
    },
    update: {
      name: company.name,
      industry: company.industry,
      headcount: company.headcount,
      location: company.location,
      techStack: company.techStack
        ? JSON.stringify(company.techStack)
        : undefined,
      enrichmentData: company.enrichmentData
        ? JSON.stringify(company.enrichmentData)
        : undefined,
    },
  });
}
