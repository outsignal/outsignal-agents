/**
 * BL-093 (2026-04-16) — per-campaign sender allocation helper.
 *
 * Validates `resolveAllocatedSenders(campaignId, allWorkspaceSenderIds)`:
 *   - Allocated campaign → returns the intersection of allocated EB IDs
 *     and workspace's currently-healthy senders.
 *   - Unknown campaign → returns ALL workspace sender IDs (fallback to
 *     pre-BL-093 behaviour for unallocated workspaces).
 *   - Allocated sender that's no longer healthy → silently dropped.
 *
 * Pin the canary cmneqixpv allocation explicitly so a future allocation
 * map edit doesn't silently change the canary's sender count.
 */

import { describe, it, expect } from "vitest";
import { resolveAllocatedSenders } from "@/lib/channels/email-adapter";

// Workspace's full sender pool (verified 2026-04-16 against the
// 1210-solutions DB rows: 58 healthy email senders sorted by
// emailBisonSenderId asc). 661/662/663 ARE present; 664/665 are absent
// (not healthy / not channel-eligible / no EB ID). Reproduce via:
//   `npx tsx scripts/maintenance/_bl093-derive-allocation.ts`.
//
// F1 correction (monty-qa BL-093 review): earlier fixture inverted the
// 30/31/32 entries to [663, 664, 665] which silently agreed with a
// wrong-but-self-consistent map and hid the production allocation bug
// for buckets 0/1/2. Replaced with the live-DB pool.
const ALL_1210_SENDER_IDS = [
  631, 632, 633, 634, 635, 636, 637, 638, 639, 640,
  641, 642, 643, 644, 645, 646, 647, 648, 649, 650,
  651, 652, 653, 654, 655, 656, 657, 658, 659, 660,
  661, 662, 663, 666, 667, 668, 669, 670, 671, 672,
  673, 674, 675, 676, 677, 678, 679, 680, 681, 682,
  683, 684, 685, 686, 687, 688, 689, 690,
];

describe("resolveAllocatedSenders (BL-093)", () => {
  it("returns the allocated subset for canary cmneqixpv (Facilities/Cleaning)", () => {
    const result = resolveAllocatedSenders(
      "cmneqixpv0001p8710bov1fga",
      ALL_1210_SENDER_IDS,
    );
    // Pinned: 11 senders, bucket 4 (Facilities) round-robin idx % 5 === 4.
    expect(result).toEqual([635, 640, 645, 650, 655, 660, 667, 672, 677, 682, 687]);
  });

  it("returns the allocated subset for Construction (bucket 0)", () => {
    const construction = resolveAllocatedSenders(
      "cmneq92p20000p8p7dhqn8g42",
      ALL_1210_SENDER_IDS,
    );
    // Bucket 0 — 12 senders, idx % 5 === 0. Pin every member to lock the
    // map against silent drift on future edits (this is the assertion
    // monty-qa F1 said was missing — pinning by count alone hid the
    // 663↔661 inversion).
    expect(construction).toEqual([
      631, 636, 641, 646, 651, 656, 661, 668, 673, 678, 683, 688,
    ]);
  });

  it("returns the allocated subset for Green List Priority (bucket 1)", () => {
    const green = resolveAllocatedSenders(
      "cmneq1sdj0001p8cg97lb9rhd",
      ALL_1210_SENDER_IDS,
    );
    expect(green).toEqual([
      632, 637, 642, 647, 652, 657, 662, 669, 674, 679, 684, 689,
    ]);
  });

  it("returns the allocated subset for Healthcare (bucket 2)", () => {
    const healthcare = resolveAllocatedSenders(
      "cmneqhwo50001p843r5hmsul3",
      ALL_1210_SENDER_IDS,
    );
    expect(healthcare).toEqual([
      633, 638, 643, 648, 653, 658, 663, 670, 675, 680, 685, 690,
    ]);
  });

  it("returns the allocated subset for Industrial/Warehouse (bucket 3)", () => {
    const industrial = resolveAllocatedSenders(
      "cmneqa5180001p8rkwyrrlkg8",
      ALL_1210_SENDER_IDS,
    );
    expect(industrial).toEqual([
      634, 639, 644, 649, 654, 659, 666, 671, 676, 681, 686,
    ]);
  });

  it("falls back to ALL workspace senders for an unknown campaign id", () => {
    const result = resolveAllocatedSenders(
      "cm_unknown_campaign_abc",
      ALL_1210_SENDER_IDS,
    );
    expect(result).toEqual(ALL_1210_SENDER_IDS);
    // Defensive — returned a copy, not the same reference.
    expect(result).not.toBe(ALL_1210_SENDER_IDS);
  });

  it("returns empty array when allocated senders are all unhealthy / missing", () => {
    // Simulate workspace with NONE of the allocated senders healthy.
    const result = resolveAllocatedSenders(
      "cmneqixpv0001p8710bov1fga",
      [9999], // unrelated sender
    );
    expect(result).toEqual([]);
  });

  it("returns the intersection when SOME allocated senders are missing", () => {
    // Drop 4 of the 11 allocated senders for facilities.
    const partial = ALL_1210_SENDER_IDS.filter(
      (id) => ![635, 640, 645, 650].includes(id),
    );
    const result = resolveAllocatedSenders(
      "cmneqixpv0001p8710bov1fga",
      partial,
    );
    // 11 - 4 = 7 remaining.
    expect(result).toEqual([655, 660, 667, 672, 677, 682, 687]);
  });

  it("the 5 1210 buckets are mutually disjoint (no sender attached to two campaigns)", () => {
    const construction = new Set(
      resolveAllocatedSenders("cmneq92p20000p8p7dhqn8g42", ALL_1210_SENDER_IDS),
    );
    const green = new Set(
      resolveAllocatedSenders("cmneq1sdj0001p8cg97lb9rhd", ALL_1210_SENDER_IDS),
    );
    const healthcare = new Set(
      resolveAllocatedSenders("cmneqhwo50001p843r5hmsul3", ALL_1210_SENDER_IDS),
    );
    const industrial = new Set(
      resolveAllocatedSenders("cmneqa5180001p8rkwyrrlkg8", ALL_1210_SENDER_IDS),
    );
    const facilities = new Set(
      resolveAllocatedSenders("cmneqixpv0001p8710bov1fga", ALL_1210_SENDER_IDS),
    );

    const all = [construction, green, healthcare, industrial, facilities];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const intersection = [...all[i]].filter((id) => all[j].has(id));
        expect(intersection).toEqual([]);
      }
    }
  });

  it("the union of all 5 buckets equals the full 1210 sender pool (no sender unallocated)", () => {
    // Defence-in-depth against the F1 inversion class of bug — if the
    // map references EB IDs that aren't in the live pool (e.g. 664/665
    // back when buckets 1/2 were inverted), the union loses a sender
    // and this assertion fails. Equivalent to asserting the map fully
    // partitions the pool.
    const allocatedUnion = new Set<number>([
      ...resolveAllocatedSenders("cmneq92p20000p8p7dhqn8g42", ALL_1210_SENDER_IDS),
      ...resolveAllocatedSenders("cmneq1sdj0001p8cg97lb9rhd", ALL_1210_SENDER_IDS),
      ...resolveAllocatedSenders("cmneqhwo50001p843r5hmsul3", ALL_1210_SENDER_IDS),
      ...resolveAllocatedSenders("cmneqa5180001p8rkwyrrlkg8", ALL_1210_SENDER_IDS),
      ...resolveAllocatedSenders("cmneqixpv0001p8710bov1fga", ALL_1210_SENDER_IDS),
    ]);
    expect(allocatedUnion.size).toBe(ALL_1210_SENDER_IDS.length);
    for (const id of ALL_1210_SENDER_IDS) {
      expect(allocatedUnion.has(id)).toBe(true);
    }
  });
});
