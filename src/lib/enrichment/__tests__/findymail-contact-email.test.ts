import { beforeEach, describe, expect, it, vi } from "vitest";
import { bulkFindEmail, findymailAdapter } from "../providers/findymail";

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
});
