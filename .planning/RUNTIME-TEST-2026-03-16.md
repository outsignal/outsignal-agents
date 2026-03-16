# Runtime Test Results — 2026-03-16

## Database: PASS
- Connection: OK
- Table counts: 8 workspaces, 19,952 people, 62,812 companies, 28 campaigns, 394 replies, 283 senders

## External APIs: 6 PASS / 2 INCONCLUSIVE / 1 SKIPPED

| Service | Status | Notes |
|---------|--------|-------|
| ANTHROPIC_API_KEY | PASS | Valid |
| RESEND_API_KEY | PASS | Valid |
| SLACK_BOT_TOKEN | PASS | Valid (team: Outsignal) |
| OPENAI_API_KEY | PASS | Valid |
| FIRECRAWL_API_KEY | PASS | Valid (status 200) |
| VERCEL_API_TOKEN | PASS | Valid |
| APIFY_API_TOKEN | INCONCLUSIVE | Status 404 — endpoint may have changed, not an auth error |
| SERPER_API_KEY | INCONCLUSIVE | Status 400 — bad request, not auth error |
| TRIGGER_SECRET_KEY | SKIPPED | Tested via deploy (v20260316.2, 16 tasks) |

## EmailBison Workspaces: 6 PASS / 2 NO TOKEN

| Workspace | Status | Campaigns |
|-----------|--------|-----------|
| outsignal | PASS | 11 |
| myacq | PASS | 2 |
| 1210-solutions | PASS | 0 |
| rise | PASS | 5 |
| lime-recruitment | PASS | 7 |
| yoopknows | PASS | 2 |
| blanktag | NO TOKEN | — |
| covenco | NO TOKEN | — |

## LinkedIn Worker: PASS
- Railway URL: reachable, HTTP 200
- Health response: `{"ok":true,"session":false}` — up but no active browser session
- LINKEDIN_WORKER_URL: correctly set
- WORKER_API_SECRET: present in .env

## Slack Notifications: PASS
- Test message delivered to #outsignal-ops

## Email Notifications: FAIL
- Resend returned 403: `notification.outsignal.ai` domain not verified
- RESEND_FROM is set to `Outsignal <notifications@notification.outsignal.ai>`
- Domain needs to be verified in Resend dashboard, or RESEND_FROM needs updating to a verified domain

---

## Issues Found (fix immediately)

1. **RESEND_FROM domain not verified** — All email notifications (reply alerts, weekly digests, etc.) are silently failing. The `notification.outsignal.ai` domain must be added and verified at https://resend.com/domains, OR `RESEND_FROM` must be changed to use an already-verified domain.

## Warnings (monitor)

1. **Apify API test returned 404** — likely endpoint change, not an auth issue. Verify manually if Apify actors still work.
2. **Serper API test returned 400** — likely payload format change. Verify manually if search discovery adapter still works.
3. **blanktag & covenco have no EB API token** — expected (LinkedIn-only / consultancy), but note if campaigns are ever created for them.
4. **LinkedIn worker session: false** — no active browser session. Normal if idle, but LinkedIn actions won't execute until a session is started.
