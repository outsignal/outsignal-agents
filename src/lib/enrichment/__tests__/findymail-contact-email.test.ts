import { beforeEach, describe, expect, it, vi } from "vitest";
import { bulkFindEmail, findymailAdapter, mapFindyMailPayload } from "../providers/findymail";
import { CreditExhaustionError } from "../credit-exhaustion";

const liveShapedFindyMailPayload = {
  contact: {
    id: 1229081678,
    name: "Joao Virtudes",
    email: "joao@archigold.co.uk",
    domain: "archigold.co.uk",
    company: "AG Design",
    linkedin_url: "https://linkedin.com/in/joao-virtudes-77115298",
    job_title: "Director",
    company_city: "Ringwood",
    company_region: "England",
    company_country: "United Kingdom",
    city: "Ringwood",
    region: "England",
    country: "United Kingdom",
  },
};

describe("FindyMail contact.email extraction", () => {
  beforeEach(() => {
    process.env.FINDYMAIL_API_KEY = "test-key";
    vi.restoreAllMocks();
  });

  it("extracts email from live contact.email response shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        contact: {
          email: "ada@example.com",
          linkedin_url: "https://linkedin.com/in/ada",
        },
      }),
    } as Response);

    const result = await findymailAdapter({
      linkedinUrl: "https://linkedin.com/in/ada",
    });

    expect(result.email).toBe("ada@example.com");
    expect(result.rawResponse).toEqual({
      contact: {
        email: "ada@example.com",
        linkedin_url: "https://linkedin.com/in/ada",
      },
    });
  });

  it("maps live-shaped contact and flattened company fields", () => {
    const result = mapFindyMailPayload(liveShapedFindyMailPayload);

    expect(result).toMatchObject({
      firstName: "Joao",
      lastName: "Virtudes",
      jobTitle: "Director",
      linkedinUrl: "https://linkedin.com/in/joao-virtudes-77115298",
      company: "AG Design",
      companyDomain: "archigold.co.uk",
      providerIds: { findymailContactId: "1229081678" },
      locationCity: "Ringwood",
      locationState: "England",
      locationCountry: "United Kingdom",
      companyData: {
        name: "AG Design",
        domain: "archigold.co.uk",
        hqCity: "Ringwood",
        hqState: "England",
        hqCountry: "United Kingdom",
      },
    });
  });

  it("prefers explicit first and last names when FindyMail returns them", () => {
    const result = mapFindyMailPayload({
      contact: {
        id: "contact-1",
        name: "Fallback Name",
        first_name: "Ada",
        last_name: "Lovelace",
      },
    });

    expect(result.firstName).toBe("Ada");
    expect(result.lastName).toBe("Lovelace");
    expect(result.providerIds).toEqual({ findymailContactId: "contact-1" });
  });

  it("handles null contact, null company details, and partial fields defensively", () => {
    expect(mapFindyMailPayload({ contact: null })).toEqual({});

    expect(mapFindyMailPayload({
      contact: {
        id: null,
        name: "",
        company: "",
        company_city: "",
        country: "United Kingdom",
      },
    })).toEqual({
      locationCountry: "United Kingdom",
    });
  });

  it("extracts contact.email in bulk FindyMail results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        contact: {
          email: "grace@example.com",
          linkedin_url: "https://linkedin.com/in/grace",
        },
      }),
    } as Response);

    const results = await bulkFindEmail([
      {
        personId: "person-1",
        linkedinUrl: "https://linkedin.com/in/grace",
      },
    ]);

    expect(results.get("person-1")?.email).toBe("grace@example.com");
  });

  it("returns extended contact fields in bulk FindyMail results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => liveShapedFindyMailPayload,
    } as Response);

    const results = await bulkFindEmail([
      {
        personId: "person-1",
        linkedinUrl: "https://linkedin.com/in/joao-virtudes-77115298",
      },
    ]);

    expect(results.get("person-1")).toMatchObject({
      email: "joao@archigold.co.uk",
      firstName: "Joao",
      lastName: "Virtudes",
      providerIds: { findymailContactId: "1229081678" },
      companyData: {
        domain: "archigold.co.uk",
        hqCity: "Ringwood",
      },
    });
  });

  it("throws CreditExhaustionError from bulk FindyMail when credits are exhausted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    } as Response);

    await expect(
      bulkFindEmail([
        {
          personId: "person-1",
          linkedinUrl: "https://linkedin.com/in/joao-virtudes-77115298",
        },
      ]),
    ).rejects.toBeInstanceOf(CreditExhaustionError);
  });
});
