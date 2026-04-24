import { describe, expect, it } from "vitest";

import {
  buildEmailLeadPayload,
  collectMissingRequiredLeadFields,
  MissingRequiredLeadFieldError,
} from "../lead-payload";

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
        { name: "location", value: "Leeds, UK" },
        { name: "lastemailmonth", value: "February" },
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

  it("uses an explicit empty-string fallback only when allowMissingLastName=true", () => {
    const payload = buildEmailLeadPayload(
      {
        email: "lead@example.com",
        firstName: "Alice",
        lastName: null,
      },
      null,
      { allowMissingLastName: true },
    );

    expect(payload).toEqual({
      email: "lead@example.com",
      firstName: "Alice",
      lastName: "",
      company: undefined,
      customVariables: undefined,
      jobTitle: undefined,
    });
  });

  it("collects missing lastName fields into a structured error payload", () => {
    const missing = collectMissingRequiredLeadFields([
      {
        personId: "person_123",
        email: "lead@example.com",
        lastName: null,
      },
    ]);
    const error = new MissingRequiredLeadFieldError(missing);

    expect(missing).toEqual([
      {
        fieldName: "lastName",
        personId: "person_123",
        email: "lead@example.com",
      },
    ]);
    expect(error.name).toBe("MissingRequiredLeadFieldError");
    expect(error.personIds).toEqual(["person_123"]);
    expect(error.emails).toEqual(["lead@example.com"]);
    expect(error.message).toContain("person_123");
  });
});
