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
});
