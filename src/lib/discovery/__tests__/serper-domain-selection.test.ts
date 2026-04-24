import { describe, expect, it } from "vitest";
import {
  buildSerperCompanyQuery,
  buildSerperQueryAttempts,
  computeDomainFuzzyScore,
  evaluateSerperDomainCandidate,
  rankSerperDomainCandidates,
} from "../serper-domain-selection";

describe("serper-domain-selection", () => {
  it("builds a contextual query with exclusions", () => {
    expect(
      buildSerperCompanyQuery("Acme Logistics Ltd", {
        contextKeywords: ["haulage", "logistics", "transport", "freight"],
        location: "West Midlands",
      }),
    ).toBe(
      "\"Acme Logistics Ltd\" \"West Midlands\" (haulage OR logistics OR transport OR freight) -site:linkedin.com -site:facebook.com",
    );
  });

  it("builds fallback attempts that keep gl and hl stable", () => {
    expect(
      buildSerperQueryAttempts({
        companyName: "Acme Logistics Ltd",
        contextKeywords: ["haulage", "logistics"],
        location: "West Midlands",
        gl: "uk",
        hl: "en-GB",
      }),
    ).toEqual([
      {
        query:
          "\"Acme Logistics Ltd\" \"West Midlands\" (haulage OR logistics) -site:linkedin.com -site:facebook.com",
        gl: "uk",
        hl: "en-GB",
      },
      {
        query:
          "\"Acme Logistics Ltd\" (haulage OR logistics) -site:linkedin.com -site:facebook.com",
        gl: "uk",
        hl: "en-GB",
      },
    ]);
  });

  it("rejects a low-similarity domain even when the snippet has transport keywords", () => {
    const candidate = evaluateSerperDomainCandidate(
      {
        title: "FDC UK Transport Ltd",
        link: "https://fdcuk.co.uk",
        snippet: "Delivery, transport and bus services across the UK",
        position: 1,
      },
      {
        companyName: "FDC UK TRANSPORT LIMITED",
        contextKeywords: ["haulage", "logistics", "transport", "freight"],
      },
    );

    expect("rejectionReason" in candidate && candidate.rejectionReason).toBe("fuzzy_threshold");
  });

  it.each([
    "zoominfo.com",
    "apollo.io",
    "clearbit.com",
    "rocketreach.co",
    "lusha.com",
    "dnb.com",
    "signalhire.com",
  ])("blocks hard-skip broker domain %s", (domain) => {
    const candidate = evaluateSerperDomainCandidate(
      {
        title: `Acme Logistics | ${domain}`,
        link: `https://www.${domain}/c/acme-logistics/123`,
        snippet: "Acme Logistics company profile",
        position: 1,
      },
      {
        companyName: "Acme Logistics Ltd",
        contextKeywords: ["logistics"],
      },
    );

    expect("rejectionReason" in candidate && candidate.rejectionReason).toBe("hard_skip_domain");
  });

  it("rejects non-UK TLDs for UK workspaces when the company name has no country hint", () => {
    const candidate = evaluateSerperDomainCandidate(
      {
        title: "Kam Logistics",
        link: "https://kamlogistics.com.au",
        snippet: "Transport and haulage specialists",
        position: 1,
      },
      {
        companyName: "KAM HAULAGE LTD",
        contextKeywords: ["haulage", "transport"],
      },
    );

    expect("rejectionReason" in candidate && candidate.rejectionReason).toBe("non_uk_tld");
  });

  it("ranks the strongest valid domain above noisier results", () => {
    const ranked = rankSerperDomainCandidates(
      [
        {
          title: "Acme Logistics on Facebook",
          link: "https://facebook.com/acme-logistics",
          snippet: "Acme Logistics on Facebook",
          position: 1,
        },
        {
          title: "Acme Logistics Ltd | Haulage and Freight",
          link: "https://acmelogistics.co.uk",
          snippet: "Haulage, logistics, transport and freight services",
          position: 2,
        },
        {
          title: "Acme Transport Group",
          link: "https://acmegroup.com",
          snippet: "Transport services",
          position: 3,
        },
      ],
      {
        companyName: "Acme Logistics Ltd",
        contextKeywords: ["haulage", "logistics", "transport", "freight"],
      },
    );

    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.domain).toBe("acmelogistics.co.uk");
    expect(ranked[1]?.domain).toBe("acmegroup.com");
  });

  it("returns no ranked candidates when every result stays under the acceptance threshold", () => {
    const ranked = rankSerperDomainCandidates(
      [
        {
          title: "General search result",
          link: "https://example.com",
          snippet: "A website about business",
          position: 1,
        },
      ],
      {
        companyName: "COWAN RECOVERY LTD",
        contextKeywords: ["haulage", "logistics", "transport", "freight"],
      },
    );

    expect(ranked).toEqual([]);
  });

  it("keeps the fuzzy threshold tunable enough to reject clothing-brand mismatches", () => {
    expect(
      computeDomainFuzzyScore("FDC UK TRANSPORT LIMITED", "fdcuk.co.uk"),
    ).toBeLessThan(40);
    expect(
      computeDomainFuzzyScore("K.J.&S TRANSPORT LTD", "kjstransport.co.uk"),
    ).toBeGreaterThanOrEqual(40);
  });
});
