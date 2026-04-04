# Brief: Writer Agent — Deeper Memory Recording

## Problem
The writer agent's onComplete hook only records a one-liner summary:
```
"BlankTag C1: linkedin pvp sequence generated. KB: cold-email-basics"
```

It doesn't record:
- The actual copy angles/hooks used
- Specific proof points referenced (case studies, stats)
- Client feedback received and how it was incorporated
- Which variants were written and their differentiators
- Why certain approaches were chosen over others

This means the next writer session starts with zero knowledge of what was written before or what the client liked/disliked. Client feedback given in one session is lost by the next.

## Impact
BlankTag's campaign was rewritten based on client feedback (James's comments on tone, angle, question style) but none of that feedback or the resulting copy decisions were recorded. The next writer session would make the same mistakes again.

## Fix Required

### 1. Richer onComplete recording
The writer's onComplete hook in `src/lib/agents/writer.ts` should record:
- **Angles used**: e.g., "white-label backstory", "growth-focused", "Shopify specialist"
- **Key proof points**: e.g., "Chai Guys case study (50% spend reduction)"
- **Closing question style**: e.g., "in-house vs agency", "open-ended growth question"
- **Variant count and differentiation**: e.g., "6 variants: 2x insider angle, 3x specialist angle, 1x audit offer"

### 2. Client feedback recording
When client feedback is provided (via the portal approval flow, orchestrator chat, or direct input), it should be written to `.nova/memory/{slug}/feedback.md` with the specific feedback and how it was addressed. For example:
```
[2026-04-02] — James (BlankTag): Requested flip to lead with white-label backstory. Wants growth-focused angle over loss aversion. "Different game to standard ecom" doesn't make sense. Wants alternative closing questions beyond "in-house or agency?"
```

### 3. Campaign content summary
After writing, append a structured summary to `campaigns.md`:
```
[2026-04-02] — C1 LinkedIn sequence rewritten: 4 steps, 6 variants at step 2. Angles: white-label trust (2 variants), Shopify growth specialist (3 variants), free audit (1 variant). Proof: Chai Guys 310% YoY. Closing: growth-focused open question. Client feedback incorporated: lead with backstory, growth over loss aversion.
```

## Key Files
- `src/lib/agents/writer.ts` — onComplete hook (lines 707-723)
- `src/lib/agents/memory.ts` — appendToMemory()
- `.nova/memory/{slug}/campaigns.md` — campaign memory
- `.nova/memory/{slug}/feedback.md` — client feedback memory

## Success Criteria
1. Writer onComplete records angles, proof points, variants, and closing style
2. Client feedback is stored in feedback.md with timestamp and attribution
3. Next writer session can read what was written before and what the client said about it
