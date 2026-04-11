<!-- campaigns.md | workspace: blanktag | seeded: 2026-03-24 | re-seed: skips if exists -->
<!-- Write governance: APPEND only, with ISO timestamp. Max 200 lines. Never delete existing entries. -->

# blanktag — Campaign History

## Campaign Performance

| Campaign | Channel | Status | Reply Rate | Open Rate | Leads |
|----------|---------|--------|------------|-----------|-------|
| BlankTag - LinkedIn - C1 - UK Shopify + Google Ads | linkedin | draft | 0.0% | 0.0% | 0 |

## Copy Wins

<!-- Agent: append entries as: [ISO date] Campaign: [name] — [what worked and why] -->

(No copy wins recorded yet)

## Copy Losses

<!-- Agent: append entries as: [ISO date] Campaign: [name] — [what failed and why] -->

(No copy losses recorded yet)

[2026-04-02] C1 LinkedIn sequence rewritten per James feedback: white-label backstory lead on all 6 step-2 variants, growth angle, 6 distinct closing questions (scaling performance, profitable growth, growth plan, exploring growth, second opinion, no-strings audit), Chai Guys case study in step 3, Loom closer in step 4

[2026-04-10T09:36:00Z] — C1 sibling-clone deploy (manual A/B workaround for platform gap BL-034)
    Parent: cmmwei70q0007zxgpvyhwwmua (BlankTag C1, status=approved, deployedAt=null, 6 pos2 variants intact — left untouched)
    Shard: deterministic 3x156 slices of list cmn4x4w4g0000zxicipc08h9b (468 leads total, sorted by id, non-overlapping, set-intersection proof before commit)
    Three clone campaigns created, each serving one variant:
      portal 2C → DB note "2B-v1" → campaignId cmnspob3g004ep8xxhm8grecl
      portal 2D → DB note "2B-v2" → campaignId cmnspobho008tp8xxrddnwyeu
      portal 2E → DB note "2B-v3" → campaignId cmnspobtf00d8p8xx8v4ew4jg
    Portal/DB label mapping diverges intentionally — portal labels used for clone names.
    All 3 transitioned deployed→active ~1s after trigger fire. Original C1 verified untouched post-deploy.
    Sender: James, warmup day 0, 5 connect/day limit → ~31 days runway per clone → ~94 days total before the 468-lead pool exhausts.
    Why manual workaround: no existing agent tool covers "clone campaign with sequence-subset + shard target list".
    Long-term fix: BL-034 LinkedIn A/B variant support (filed 2026-04-11 during stash recovery). C2 should use the real feature once shipped.
    Recovered from stash@{0} 2026-04-11.
