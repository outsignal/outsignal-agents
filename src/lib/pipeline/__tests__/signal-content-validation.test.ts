import { describe, expect, it } from "vitest";

import { validateSignalCampaignContent } from "../signal-content-validation";

describe("validateSignalCampaignContent", () => {
  it("flags LinkedIn spintax as a hard violation", () => {
    const result = validateSignalCampaignContent({
      channels: ["linkedin"],
      copyStrategy: "linkedin",
      linkedinSequence: [
        { position: 1, body: "Hi {FIRSTNAME}" },
        { position: 2, body: "{noticed|saw} you're hiring." },
      ],
    });

    expect(result.hardViolations.length).toBeGreaterThan(0);
    expect(
      result.hardViolations.some(
        (v) =>
          v.step === 2 &&
          v.field === "linkedin:body" &&
          v.violation.includes("spintax"),
      ),
    ).toBe(true);
  });

  it("accepts clean email and LinkedIn sequences", () => {
    const result = validateSignalCampaignContent({
      channels: ["email", "linkedin"],
      copyStrategy: "pvp",
      emailSequence: [
        {
          position: 1,
          subjectLine: "Quick note",
          body: "Hi {FIRSTNAME}, are you open to a quick chat?",
        },
      ],
      linkedinSequence: [
        { position: 1, body: "Hi {FIRSTNAME}, thought I'd say hello." },
        { position: 2, body: "Would it be worth a quick chat?" },
      ],
    });

    expect(result.hardViolations).toEqual([]);
  });
});
