# Fix Writer Agent Quality — Code Agent Brief

## Problem
The writer agent is ignoring its own quality rules across BOTH modes:

**Reply suggestions:**
- Using "quick question" (banned phrase)
- Using em dashes (explicitly prohibited)
- Reply mode rules are 10 lines buried in a 500-line prompt, referenced by number — model skips them
- Not consistently using intelligence layer (KB, workspace context)

**Cold outreach (campaign copy):**
- "Multi-Channel Demo" campaign: Subject B uses "quick question", Email 4 uses "no worries at all"
- "Situ" campaign: Email 1 opens with "Quick question", Email 3 uses "we'd love to help"
- Em dashes (—) used throughout both campaigns
- Both campaigns were APPROVED with these violations — no quality gate caught them

The rules exist in the prompt but the model ignores them. We need both prompt reinforcement AND a programmatic quality gate.

## Root Cause
In `src/lib/agents/writer.ts`, the Reply Suggestion Mode section (~lines 503-511) is too brief and references rules by number instead of repeating them inline. The model loses track of them in a 500-line system prompt.

## Tasks

### 1. Rewrite Reply Suggestion Mode Section
In `src/lib/agents/writer.ts`, replace the current Reply Suggestion Mode section with a self-contained block. It must include:

**Mandatory rules (repeat inline, DO NOT reference by number):**
- NEVER use em dashes (—) or en dashes (–). Use commas, periods, or "and" instead.
- NEVER use "quick question" or any banned phrases. Full banned list must be inline:
  - "quick question", "I hope this email finds you well", "I wanted to reach out", "just following up", "touching base", "circle back", "synergy", "leverage", "streamline", "excited to", "I'd love to", "pick your brain", "no worries if not", "feel free to", "at your earliest convenience", "as per my last email"
- Soft question CTAs only — never "Let me know", "Are you free Tuesday?", "Can I send you...?"
- No spintax (replies are direct, not broadcast)
- No PVP framework (cold outreach only)
- No forced word count but keep replies concise — under 70 words recommended
- Simple, conversational language. Write like a human, not a salesperson.
- Match the tone and energy of the prospect's reply — if they're casual, be casual. If formal, be formal.

**Mandatory tool calls (make these REQUIRED, not optional):**
- MUST call `getWorkspaceIntelligence` before drafting — load the client's vertical, core offers, differentiators, pain points, tone prompt
- MUST call `searchKnowledgeBase` with relevant query (e.g. the prospect's objection, industry, or topic) — ground the reply in the intelligence layer
- If `outreachTonePrompt` is set on the workspace, apply it to the reply

**Reply strategy rules:**
- Read the full thread history to understand context — don't repeat what's already been said
- If the prospect asked a question, answer it directly first, then soft-pivot to next step
- If the prospect raised an objection, acknowledge it genuinely, then reframe using knowledge base intelligence
- If the prospect showed interest, confirm value prop briefly and suggest a concrete next step
- If the prospect is lukewarm, add one relevant proof point (case study, metric) from KB, then ask an open question
- Never ignore what the prospect said — always respond to their specific message
- The reply should feel like it was written by someone who deeply understands the client's business and the prospect's industry

### 2. Add Few-Shot Examples
Add 3 examples directly in the system prompt (inside the Reply Suggestion Mode section):

**Example 1 — Objection handling:**
```
Prospect: "We already have a provider for this."
BAD: "Quick question — would you be open to exploring how we could complement your current setup?"
GOOD: "Completely understand. Most of our clients came to us while working with another provider. The difference they found was [specific differentiator from KB]. Worth a quick comparison?"
```

**Example 2 — Interest shown:**
```
Prospect: "This looks interesting, tell me more."
BAD: "I'd love to jump on a call to walk you through everything! Are you free Tuesday?"
GOOD: "Glad it caught your eye. In short, we [one-line value prop]. Happy to share a couple of examples relevant to [their industry] if that would help?"
```

**Example 3 — Question asked:**
```
Prospect: "How does your pricing work?"
BAD: "Great question! I'd love to schedule a call to discuss our flexible pricing options. Let me know when works for you."
GOOD: "Depends on scope but typically [range or model]. For [their vertical], most clients start with [entry point]. Want me to put together a quick breakdown based on your setup?"
```

### 3. Force Tool Calls in generate-suggestion Task
In `trigger/generate-suggestion.ts`, update the user message to explicitly instruct:

Add to the end of the constructed message:
```
IMPORTANT: You MUST call getWorkspaceIntelligence and searchKnowledgeBase before drafting your reply. Ground your response in the client's vertical context and knowledge base intelligence.
```

### 4. Add Reply Quality Validation
In `trigger/generate-suggestion.ts`, after getting the AI response, add a simple validation check before persisting:

```ts
const bannedPatterns = [
  /quick question/i,
  /\u2014/,           // em dash
  /\u2013/,           // en dash
  /I'd love to/i,
  /I hope this email finds you/i,
  /just following up/i,
  /let me know/i,
  /are you free/i,
  /pick your brain/i,
];

const violations = bannedPatterns.filter(p => p.test(suggestion));
if (violations.length > 0) {
  // Re-generate with explicit correction
  const correctionMessage = `Your reply contains banned patterns: ${violations.map(v => v.source).join(', ')}. Rewrite without these patterns. Keep the same intent but use natural, conversational language.`;
  // Call runAgent again with correction
}
```

This is a safety net — if the model still slips, catch it and force a rewrite.

### 5. Log Tool Usage
In the agent runner or generate-suggestion task, log whether `getWorkspaceIntelligence` and `searchKnowledgeBase` were actually called during the reply generation. This lets us audit whether the model is using the intelligence layer.

Add to the Reply record or log output:
- `suggestionToolsUsed: string[]` — list of tools the agent called during generation

### 6. Cold Outreach Quality Gate
Apply the same banned pattern validation from Task 4 to campaign copy generation. Find where campaign email sequences are generated by the writer agent and add the same validation + auto-rewrite loop.

Also add validation at the campaign approval stage — if a campaign is submitted for approval and contains banned patterns, flag them in the UI so the approver can see the violations before approving.

### 7. Reinforce Banned Phrases in Cold Outreach Prompt
In the cold outreach section of `WRITER_SYSTEM_PROMPT`, move the banned phrases list to the TOP of the quality rules section (not buried at the bottom). Add emphasis:

```
CRITICAL — NEVER USE THESE PHRASES (automatic rejection):
- "quick question" ← MOST COMMON VIOLATION, never use this
- "no worries if not" / "no worries at all"
- "I'd love to" / "we'd love to"
[... full list ...]
```

Also add a final instruction at the very end of the system prompt:
```
FINAL CHECK: Before returning ANY generated copy, verify it contains ZERO em dashes (—), ZERO en dashes (–), and ZERO banned phrases. If you find any, rewrite the offending lines before returning.
```

## Do NOT
- Change the agent runner architecture
- Change the classification or notification flow
- Add new dependencies

## Key Files to Modify
- `src/lib/agents/writer.ts` — rewrite Reply Suggestion Mode section + reinforce cold outreach banned phrases + add examples + add FINAL CHECK instruction
- `trigger/generate-suggestion.ts` — force tool instruction + quality validation + tool usage logging
- Campaign generation code (wherever writer agent generates email sequences) — add same quality validation

## Key Files to Create
- `src/lib/agents/quality-gate.ts` — shared banned pattern checker + auto-rewrite logic, used by both reply suggestions and campaign generation

## Success Criteria
- AI replies AND cold outreach copy NEVER contain em dashes, "quick question", or other banned phrases
- Every reply generation calls both `getWorkspaceIntelligence` and `searchKnowledgeBase`
- Replies reference client-specific context (vertical, differentiators, case studies)
- Replies match the prospect's tone and directly address their message
- Campaign approval UI flags any remaining violations before human approval
- Quality gate catches and auto-rewrites violations programmatically as a safety net
