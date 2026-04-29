import { beforeEach, describe, expect, it, vi } from "vitest";

const personFindUniqueOrThrowMock = vi.fn();
const personUpdateMock = vi.fn();
const companyFindUniqueOrThrowMock = vi.fn();
const companyUpdateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findUniqueOrThrow: (...args: unknown[]) => personFindUniqueOrThrowMock(...args),
      update: (...args: unknown[]) => personUpdateMock(...args),
    },
    company: {
      findUniqueOrThrow: (...args: unknown[]) => companyFindUniqueOrThrowMock(...args),
      update: (...args: unknown[]) => companyUpdateMock(...args),
    },
  },
}));

import { mergeCompanyData, mergePersonData } from "../merge";

describe("merge existing-data-wins helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats blank person fields as mergeable rather than authoritative", async () => {
    personFindUniqueOrThrowMock.mockResolvedValue({
      id: "person-1",
      company: "",
      location: "London",
    });

    const fieldsWritten = await mergePersonData("person-1", {
      company: "Acme",
      location: "Manchester",
    });

    expect(fieldsWritten).toEqual(["company"]);
    expect(personUpdateMock).toHaveBeenCalledWith({
      where: { id: "person-1" },
      data: { company: "Acme" },
    });
  });

  it("deep-merges person providerIds instead of overwriting existing provider keys", async () => {
    personFindUniqueOrThrowMock.mockResolvedValue({
      id: "person-1",
      providerIds: { aiarkPersonId: "aiark-123" },
      headline: null,
    });

    const fieldsWritten = await mergePersonData("person-1", {
      providerIds: { prospeoPersonId: "prospeo-456" },
      headline: "Founder at Acme",
    });

    expect(fieldsWritten).toEqual(["providerIds", "headline"]);
    expect(personUpdateMock).toHaveBeenCalledWith({
      where: { id: "person-1" },
      data: {
        providerIds: {
          aiarkPersonId: "aiark-123",
          prospeoPersonId: "prospeo-456",
        },
        headline: "Founder at Acme",
      },
    });
  });

  it("deep-merges FindyMail contact IDs into existing person providerIds", async () => {
    personFindUniqueOrThrowMock.mockResolvedValue({
      id: "person-1",
      providerIds: { prospeoPersonId: "prospeo-456" },
      jobTitle: null,
    });

    const fieldsWritten = await mergePersonData("person-1", {
      providerIds: { findymailContactId: "1229081678" },
      jobTitle: "Director",
    });

    expect(fieldsWritten).toEqual(["providerIds", "jobTitle"]);
    expect(personUpdateMock).toHaveBeenCalledWith({
      where: { id: "person-1" },
      data: {
        providerIds: {
          prospeoPersonId: "prospeo-456",
          findymailContactId: "1229081678",
        },
        jobTitle: "Director",
      },
    });
  });

  it("treats blank company fields as mergeable rather than authoritative", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({
      domain: "acme.com",
      description: "   ",
      industry: "Manufacturing",
    });

    const fieldsWritten = await mergeCompanyData("acme.com", {
      description: "Acme builds industrial sensors.",
      industry: "Hardware",
    });

    expect(fieldsWritten).toEqual(["description"]);
    expect(companyUpdateMock).toHaveBeenCalledWith({
      where: { domain: "acme.com" },
      data: { description: "Acme builds industrial sensors." },
    });
  });

  it("deep-merges company providerIds and mirrors new social columns independently", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({
      domain: "acme.com",
      providerIds: { aiarkCompanyId: "aiark-company-123" },
      linkedinUrl: null,
      socialUrls: null,
    });

    const fieldsWritten = await mergeCompanyData("acme.com", {
      providerIds: { prospeoCompanyId: "prospeo-company-456" },
      linkedinUrl: "https://www.linkedin.com/company/acme",
      socialUrls: { linkedin: "https://www.linkedin.com/company/acme" },
    });

    expect(fieldsWritten).toEqual(["providerIds", "linkedinUrl", "socialUrls"]);
    expect(companyUpdateMock).toHaveBeenCalledWith({
      where: { domain: "acme.com" },
      data: {
        providerIds: {
          aiarkCompanyId: "aiark-company-123",
          prospeoCompanyId: "prospeo-company-456",
        },
        linkedinUrl: "https://www.linkedin.com/company/acme",
        socialUrls: { linkedin: "https://www.linkedin.com/company/acme" },
      },
    });
  });

  it("deep-merges company socialUrls instead of rejecting incoming non-overlapping keys", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({
      domain: "acme.com",
      socialUrls: { linkedin: "https://www.linkedin.com/company/acme" },
    });

    const fieldsWritten = await mergeCompanyData("acme.com", {
      socialUrls: { twitter: "https://twitter.com/acme" },
    });

    expect(fieldsWritten).toEqual(["socialUrls"]);
    expect(companyUpdateMock).toHaveBeenCalledWith({
      where: { domain: "acme.com" },
      data: {
        socialUrls: {
          linkedin: "https://www.linkedin.com/company/acme",
          twitter: "https://twitter.com/acme",
        },
      },
    });
  });

  it("lets incoming company socialUrls overwrite overlapping keys like providerIds", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({
      domain: "acme.com",
      socialUrls: {
        linkedin: "https://www.linkedin.com/company/acme",
        twitter: "https://twitter.com/old-acme",
      },
    });

    const fieldsWritten = await mergeCompanyData("acme.com", {
      socialUrls: { twitter: "https://twitter.com/acme" },
    });

    expect(fieldsWritten).toEqual(["socialUrls"]);
    expect(companyUpdateMock).toHaveBeenCalledWith({
      where: { domain: "acme.com" },
      data: {
        socialUrls: {
          linkedin: "https://www.linkedin.com/company/acme",
          twitter: "https://twitter.com/acme",
        },
      },
    });
  });

  it("skips company socialUrls writes when incoming keys are empty or unchanged", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({
      domain: "acme.com",
      socialUrls: { linkedin: "https://www.linkedin.com/company/acme" },
    });

    const fieldsWritten = await mergeCompanyData("acme.com", {
      socialUrls: {},
    });

    expect(fieldsWritten).toEqual([]);
    expect(companyUpdateMock).not.toHaveBeenCalled();
  });

  it("handles null company socialUrls when merging new keys", async () => {
    companyFindUniqueOrThrowMock.mockResolvedValue({
      domain: "acme.com",
      socialUrls: null,
    });

    const fieldsWritten = await mergeCompanyData("acme.com", {
      socialUrls: { instagram: "https://instagram.com/acme" },
    });

    expect(fieldsWritten).toEqual(["socialUrls"]);
    expect(companyUpdateMock).toHaveBeenCalledWith({
      where: { domain: "acme.com" },
      data: {
        socialUrls: { instagram: "https://instagram.com/acme" },
      },
    });
  });
});
