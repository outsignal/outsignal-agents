import { beforeEach, describe, expect, it, vi } from "vitest";
import { bulkEnrichPerson, prospeoAdapter } from "../providers/prospeo";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

function mockProspeoResponse(body: unknown = {
  error: false,
  person: {
    email: { email: "ada@example.com" },
    mobile: { revealed: true, mobile: "+447700900123" },
  },
}) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } as Response;
}

describe("Prospeo enrich-person request shape", () => {
  beforeEach(() => {
    process.env.PROSPEO_API_KEY = "test-key";
    fetchMock.mockReset();
  });

  it("wraps single /enrich-person datapoints in data and requests verified mobile reveal", async () => {
    fetchMock.mockResolvedValueOnce(mockProspeoResponse());

    await prospeoAdapter({
      linkedinUrl: "https://www.linkedin.com/in/ada",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.prospeo.io/enrich-person",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          enrich_mobile: true,
          only_verified_mobile: true,
          data: {
            linkedin_url: "https://www.linkedin.com/in/ada",
          },
        }),
      }),
    );
  });

  it("keeps /bulk-enrich-person request shape unchanged", async () => {
    fetchMock.mockResolvedValueOnce(mockProspeoResponse({
      error: false,
      matched: [],
      not_matched: ["person-1"],
      invalid_datapoints: [],
    }));

    await bulkEnrichPerson([
      {
        personId: "person-1",
        firstName: "Ada",
        lastName: "Lovelace",
        companyDomain: "example.com",
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.prospeo.io/bulk-enrich-person",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          only_verified_email: false,
          data: [
            {
              identifier: "person-1",
              first_name: "Ada",
              last_name: "Lovelace",
              company_website: "example.com",
            },
          ],
        }),
      }),
    );
  });
});
