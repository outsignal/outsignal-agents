# Client Sweep Rules

## When to sweep
Before starting ANY work on a workspace (campaign creation, lead sourcing, copy writing, deliverability checks, onboarding, or any workspace-specific task), you MUST run a comprehensive client sweep first.

## How to sweep
Run the clientSweep tool (or `npx tsx scripts/cli/client-sweep.ts <slug>`) and read the full output before proceeding. This gives you:
- Current campaign status and pipeline state
- Available lead data (DB records AND local data files)
- Client documentation and onboarding info
- Memory context (learnings, feedback, campaign history)
- Infrastructure status (senders, health, sessions)
- Existing scripts and pipeline data

## Why
Agents starting work without the full picture leads to:
- Recommending lead sourcing when data already exists locally
- Missing existing client docs and case studies
- Not knowing about pipeline scripts already built
- Reporting incomplete status that requires repeated user queries

## Rules
1. NEVER report a client's status based solely on DB queries -- always check data files, docs, scripts, and memory too
2. NEVER recommend sourcing leads without first checking data/*.json and data/*.csv for existing pipeline data
3. NEVER say "no content exists" without checking docs/clients/ and the knowledge base
4. Present the COMPLETE picture in your first report -- the user should not have to ask follow-up questions to get basic information
5. When the sweep reveals existing data files (e.g. `data/blanktag-decision-makers.json`), mention them explicitly and describe what they contain
6. When the sweep shows memory files with real entries, summarise the key learnings before proceeding with the task
7. If the sweep shows flagged senders (unhealthy, expired sessions, elevated bounce status), raise these as blockers before starting campaign work
