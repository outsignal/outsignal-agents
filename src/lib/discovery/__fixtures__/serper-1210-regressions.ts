/**
 * Curated from scripts/maintenance/_1210-apr-firecrawl-results.json on 2026-04-24.
 *
 * PASS cases were selected from Firecrawl-verified domains that still have a
 * company-to-domain signal strong enough for the hardened adapter to keep.
 * FAIL cases were selected from Firecrawl-verified false positives that the
 * hardened adapter should now refuse rather than force-pick.
 */

export interface Serper1210RegressionCase {
  companyName: string;
  domain: string;
}

export const SERPER_1210_FAIL_CASES: Serper1210RegressionCase[] = [
  { companyName: "FDC UK TRANSPORT LIMITED", domain: "fdcuk.co.uk" },
  { companyName: "WARLEY CARRIERS LTD", domain: "tstgroup.uk" },
  { companyName: "ADW AGGREGATES LIMITED", domain: "adwgroupwarehousing.com" },
  { companyName: "LAUGHING DOG ENGINEERING SERVICES LIMITED", domain: "identeco.co.uk" },
  { companyName: "D&D EAZY HAULAGE LTD", domain: "ddwlogistics.com" },
  { companyName: "HOWARD SHIPPING SERVICES LTD", domain: "hoship.com" },
  { companyName: "G.H. BY PRODUCTS (DERBY) LIMITED", domain: "ahughesandson.co.uk" },
  { companyName: "CJS INTERNATIONAL LTD", domain: "cjsglobal.com" },
  { companyName: "GPG BUBBLE MOVEMENTS LTD", domain: "boeing.com" },
  { companyName: "VIC CONTRACTORS LTD", domain: "viccivil.com" },
  { companyName: "AMOR LOGISTICS LTD", domain: "all-forward.com" },
  { companyName: "KAM HAULAGE LTD", domain: "kamlogistics.bg" },
  { companyName: "MBA HAULAGE LIMITED", domain: "mbalogistics.com" },
  { companyName: "SLN TRANSPORT LTD", domain: "slnhaulage.co.uk" },
  { companyName: "EDMUND BREWER HAULAGE LIMITED", domain: "penrithbusinessparks.co.uk" },
  { companyName: "K & D IZZARD TRANSPORT LTD", domain: "htc-uk.com" },
  { companyName: "KELERBAY LTD", domain: "doreebonner.co.uk" },
  { companyName: "GENERAL EXPRESS SERVICES LTD", domain: "geslogistics.com" },
  { companyName: "COWAN RECOVERY LTD", domain: "cmg-org.com" },
  { companyName: "D J SPALL (RECYCLING) LTD", domain: "ebay.co.uk" },
];

export const SERPER_1210_PASS_CASES: Serper1210RegressionCase[] = [
  { companyName: "K.J.&S TRANSPORT LTD", domain: "kjstransport.co.uk" },
  { companyName: "PAV HAULAGE LTD", domain: "pavhaulage.co.uk" },
  { companyName: "NW TRADING (HOLDINGS) LIMITED", domain: "nwtrading.co.uk" },
  { companyName: "T W R (HAULAGE) LTD", domain: "twehaulage.com" },
  { companyName: "M A EVANS TRANSPORT LTD", domain: "evanstransport.co.uk" },
  { companyName: "RJR GROUP (ENG) LIMITED", domain: "rjrgroup.co.uk" },
  { companyName: "R D WILLIAMS & SONS (HAULAGE) LTD", domain: "williamshaulage.co.uk" },
  { companyName: "V&M UK TRANS LTD", domain: "vmuktr.co.uk" },
  { companyName: "BROUGHTON TRANSPORT SOLUTIONS LTD", domain: "broughtontransport.com" },
  { companyName: "P P O'CONNOR GROUP LTD", domain: "ppoconnor.co.uk" },
  { companyName: "LOTHIAN COUNTRY BUSES LIMITED", domain: "lothianbuses.com" },
  { companyName: "M & S TYRE SERVICES LTD", domain: "mandstyres.co.uk" },
  { companyName: "WALKER TRANSPORT (IRELAND) LTD", domain: "walkers-transport.co.uk" },
  { companyName: "M GROUP (SERVICES) LIMITED", domain: "mgroupltd.com" },
  { companyName: "DMDS SERVICES LTD", domain: "dmdsltd.com" },
  { companyName: "TRENT MOTOR TRACTION COMPANY LIMITED(THE)", domain: "trentbarton.co.uk" },
  { companyName: "UK LIFT & HAULAGE LTD", domain: "ukliftandhaul.co.uk" },
  { companyName: "WOODLAND LOGISTICS LTD", domain: "woodlandgroup.com" },
  { companyName: "BULK HAULAGE GROUP LIMITED", domain: "bulklogisticsgroup.com" },
  { companyName: "STEELE & CO MOVING SERVICES LIMITED", domain: "steeleandco.co.uk" },
];
