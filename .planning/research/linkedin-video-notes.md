# David Mendoza — LinkedIn Outreach System with Claude Code

Source: https://www.youtube.com/watch?v=zbxtIFQ_6aM
"Build a $0/mo LinkedIn Outreach System with Claude Code (TUTORIAL)"

## Architecture Overview

The system uses Claude Code to build a fully autonomous LinkedIn outreach system that avoids detection by using an accessibility tree (not CSS selectors) for browser automation.

## Core Components

### 1. Google Sheets as Queue Database
- Two tabs: "Connection Request Queue" and "InMail Queue"
- Each row: first name, last name, email, title, company, LinkedIn URL, priority (1=urgent, 2=normal), status (pending/sent/error), classification, email context, message template
- Priority 1 = warm/hot reply from cold email (send connection ASAP)
- Priority 2 = cold queue leads

### 2. Queue Builder Script
- Takes lead list, validates LinkedIn URLs
- Rejects fake slugs (shorter than 3 chars, title-like suffixes)
- Checks blacklist by domain
- Routes to InMail (CEOs/VPs/Directors/Founders) vs Connection Request (everyone else)

### 3. Vercel's `agent-browser` Package (KEY INNOVATION)
- Uses **accessibility tree** instead of CSS selectors
- Less bloated than Playwright MCP
- More reliable for LinkedIn's dynamic HTML
- Installed via npm as "agent-browser"
- This is what makes it undetectable — no CSS selector patterns for LinkedIn to flag

### 4. Outreach Orchestrator
- Reads from InMail and Connection queues
- Sends data to browser agent with human-like delays
- **10-20 seconds between profile visits**
- ~80 profile visits/day rate limit
- Processes priority 1 leads first
- Has error handling and retry logic

### 5. Modal (modal.com) — Reply Classification Agent
- Serverless Python platform
- Deploys AI agent that classifies email replies (hot/warm/cold)
- Posts to Slack: classification + summary + draft reply + direct link to inbox
- Sends data to n8n webhook for queue management

### 6. n8n Workflow (Reply → Queue Pipeline)
Triggered by webhook from Modal when positive reply detected:
1. Check if lead exists in Google Sheets database
2. If exists AND has LinkedIn URL → check if in queue → update priority to 1
3. If exists but NO LinkedIn URL → use LinkUp.so to find it → validate → append with priority 1
4. If doesn't exist → enrich via LinkUp.so → append to queue
5. If already sent → ignore

### 7. LinkUp.so for LinkedIn URL Enrichment
- Finds LinkedIn URLs for leads who don't have one
- $5 free credits
- Uses structured output type for easier parsing
- Validates URL contains proper slug pattern

### 8. Message Templates
- Connection requests: reference email context for warm leads (priority 1)
- Generic templates for cold queue leads ("Hey, noticed your company is in {industry} space...")
- Fallback templates for when no context exists
- InMail messages: longer, more detailed

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Accessibility tree over CSS selectors | LinkedIn HTML is finicky, CSS selectors break. Accessibility tree is stable and undetectable |
| Priority-based queue | Warm/hot email replies get immediate connection requests while interest is fresh |
| Human-like delays (10-20s) | Avoids LinkedIn automation detection |
| Blacklist by domain | Domain appears in email and LinkedIn — catches all employees of blacklisted companies |
| InMail vs Connection routing by title | C-level gets InMail (longer message), everyone else gets connection request |
| Google Sheets as database | Simple, visual, easy to manage manually — but not scalable |

## Rate Limits

- Connection requests: configurable daily limit
- InMails: configurable daily limit
- Profile visits: ~80/day
- Delay between actions: 10-20 seconds

## Mapping to Outsignal Architecture

| Mendoza's System | Outsignal Equivalent |
|------------------|---------------------|
| Instantly (cold email) | EmailBison |
| Google Sheets (queue DB) | PostgreSQL/Prisma (new LinkedInQueue model) |
| Modal (reply classification) | Existing webhook handler + Slack notifications |
| n8n (workflow automation) | API route / internal logic |
| LinkUp.so (LinkedIn URL finding) | Prospeo or similar (already in enrichment pipeline) |
| Queue Builder script | API endpoint or scheduled job |
| Outreach Orchestrator | Node.js script with agent-browser |

### Key Differences for Our Implementation
1. **We already have the reply classification** — EmailBison webhooks (LEAD_REPLIED, LEAD_INTERESTED) fire to our existing handler which already posts to Slack
2. **We have a real database** — PostgreSQL with Prisma, not Google Sheets. Can add a LinkedInQueue model or LinkedInAction table
3. **We already have lead data** — 14k+ people with enrichment data. Many may already have LinkedIn URLs
4. **We need to integrate with EmailBison campaign timing** — When Email 1 sends, wait 24h, then connection request. This is the sequencing layer Mendoza doesn't have
5. **We're building an enrichment pipeline** — Phase 2 includes Prospeo which can find LinkedIn URLs, replacing LinkUp.so

### The Ideal Flow for Outsignal
1. Campaign starts in EmailBison → Email 1 sent
2. EmailBison webhook fires (need: "email sent" event, or poll campaign status)
3. After 24h delay → send LinkedIn connection request via agent-browser
4. If prospect replies positively to email → bump to priority 1 → send connection request immediately
5. If connection accepted → optionally send LinkedIn message
6. Continue email sequence in parallel with LinkedIn touchpoints
7. If prospect replies to either channel → pause the other channel
