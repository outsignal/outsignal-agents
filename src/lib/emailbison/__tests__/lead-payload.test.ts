import { describe, expect, it } from "vitest";

import { buildEmailLeadPayload } from "../lead-payload";

describe("buildEmailLeadPayload", () => {
  it("normalises company and adds supported custom variables", () => {
    const payload = buildEmailLeadPayload(
      {
        email: "lead@example.com",
        firstName: "Alice",
        lastName: "Ng",
        jobTitle: "Ops Director",
        company: "Acme Services UK Limited",
        companyDomain: "acme.com",
        location: "Leeds, UK",
      },
      "Campaign brief lastEmailMonth:February",
    );

    expect(payload).toEqual({
      email: "lead@example.com",
      firstName: "Alice",
      lastName: "Ng",
      jobTitle: "Ops Director",
      company: "Acme",
      customVariables: [
        { name: "LOCATION", value: "Leeds, UK" },
        { name: "LASTEMAILMONTH", value: "February" },
      ],
    });
  });

  it("omits empty custom variables cleanly", () => {
    const payload = buildEmailLeadPayload({
      email: "lead@example.com",
      company: "Example Ltd",
    });

    expect(payload).toEqual({
      email: "lead@example.com",
      company: "Example",
      customVariables: undefined,
      firstName: undefined,
      lastName: undefined,
      jobTitle: undefined,
    });
  });
});
