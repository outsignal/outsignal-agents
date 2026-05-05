import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toProspeoLocationFormat } from "../country-codes";
import { decomposeRangeToVendorBands } from "../format-adapters";

const PROSPEO_BANDS = [
  "1-10",
  "11-20",
  "21-50",
  "51-100",
  "101-200",
  "201-500",
  "501-1000",
  "1001-2000",
  "2001-5000",
  "5001-10000",
  "10000+",
];

const APIFY_BANDS = [
  "1-10",
  "11-20",
  "21-50",
  "51-100",
  "101-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10001-20000",
  "20001-50000",
  "50000+",
];

describe("discovery format adapters", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("decomposes arbitrary company-size ranges into overlapping Prospeo bands", () => {
    expect(decomposeRangeToVendorBands("5-100", PROSPEO_BANDS)).toEqual([
      "1-10",
      "11-20",
      "21-50",
      "51-100",
    ]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Company size range "5-100" broadens'),
    );

    expect(decomposeRangeToVendorBands("1-10", PROSPEO_BANDS)).toEqual([
      "1-10",
    ]);
    expect(decomposeRangeToVendorBands("15000", PROSPEO_BANDS)).toEqual([
      "10000+",
    ]);
    expect(decomposeRangeToVendorBands("50001-100000", PROSPEO_BANDS)).toEqual([
      "10000+",
    ]);
  });

  it("decomposes arbitrary company-size ranges into overlapping Apify bands", () => {
    expect(decomposeRangeToVendorBands("5-100", APIFY_BANDS)).toEqual([
      "1-10",
      "11-20",
      "21-50",
      "51-100",
    ]);
    expect(decomposeRangeToVendorBands("50000", APIFY_BANDS)).toEqual([
      "20001-50000",
    ]);
    expect(decomposeRangeToVendorBands("60000", APIFY_BANDS)).toEqual([
      "50000+",
    ]);
  });

  it("skips malformed company-size ranges with a warning", () => {
    expect(decomposeRangeToVendorBands("abc", APIFY_BANDS)).toEqual([]);
    expect(decomposeRangeToVendorBands("", APIFY_BANDS)).toEqual([]);
    expect(decomposeRangeToVendorBands(null, APIFY_BANDS)).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it("converts common country aliases to Prospeo location format", () => {
    expect(toProspeoLocationFormat("United Kingdom")).toBe("United Kingdom #GB");
    expect(toProspeoLocationFormat("UK")).toBe("United Kingdom #GB");
    expect(toProspeoLocationFormat("GB")).toBe("United Kingdom #GB");
    expect(toProspeoLocationFormat("United Kingdom #GB")).toBe("United Kingdom #GB");

    expect(toProspeoLocationFormat("Mars")).toBe("Mars");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown country "Mars"'),
    );
  });
});
