# Brief: Monty Radar — API Credit Monitoring

## Problem
We've been caught out twice by exhausted API credits (AI Ark at 0, FindyMail at 0) without knowing until pipelines failed. There's no proactive monitoring of provider credit balances.

## Goal
Add daily credit balance checks to the Monty Radar health monitoring system. Alert via ntfy + Slack when any provider drops below a configurable threshold.

## Providers to Monitor
- **Prospeo** — `GET /account-information` with `X-KEY` header → `response.remaining_credits`
- **AI Ark** — no API endpoint, may need to attempt a minimal search and check for 402 status as a proxy
- **FindyMail** — `GET /api/credits` with Bearer token → email_credits + verifier_credits
- **BounceBan** — no standalone balance endpoint, credits returned per-verification in response
- **Apify** — `GET /v2/users/me/usage` with Bearer token → usage vs limits
- **Adyntel** — check if balance endpoint exists
- **Kitt** — no credits endpoint found, may need dashboard check

## Alert Thresholds (suggested defaults)
- Prospeo: < 500 credits → warning, < 100 → critical
- AI Ark: 402 response → critical (0 credits)
- FindyMail: < 500 email credits → warning, < 100 → critical
- BounceBan: < 1,000 credits → warning, < 200 → critical
- Apify: < $5 remaining → warning, < $1 → critical
- Adyntel: < 500 credits → warning, < 100 → critical

## Integration Point
Monty Radar already runs hourly via a remote agent (Opus 4.6, Max plan) checking workspace health. The credit check should:
1. Run once daily (not hourly — credit balances don't change that fast)
2. Hit each provider's API to get current balance
3. Compare against thresholds
4. Fire ntfy notification if any provider is below warning/critical threshold
5. Include balance summary in the health report

## Key Files
- Monty Radar config: see memory/monty-radar-setup.md
- Health endpoint: `GET /api/health/radar`
- ntfy topic: `outsignal-monty-jjay`
- Slack channels: #outsignal-ops (C0AJCRTDA8H), #outsignal-alerts (C0AKV1VNY9H)

## Success Criteria
1. Daily credit check runs automatically
2. Alerts fire when any provider drops below threshold
3. No more surprises from exhausted credits
