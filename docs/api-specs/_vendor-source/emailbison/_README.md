# EmailBison — Vendor Source Materials (2026-05-06)

This directory holds vendor-supplied source-of-truth for EmailBison API.

## Files in this directory

- `openapi-2026-05-06.json` — Full OpenAPI 3.0.3 spec from Jonathan's authenticated dashboard export
- `openapi-2026-05-06.yaml` — Same spec in YAML form
- `postman-collection-2026-05-06.json` — Importable Postman collection

(These files exported from the EmailBison developer portal — `https://app.outsignal.ai/docs` — on 2026-05-06.)

The raw exports include vendor-provided synthetic example values for tokens, OAuth responses, passwords, names, and email addresses. These are examples from the vendor documentation, not production Outsignal credentials or customer payloads.

## Vendor support clarification on webhook security

Asked EmailBison support 2026-05-06: *"Do you support webhook signing secrets?"*

Response from MikeBison/head bison agent:

> **"no. and most webhook senders don't have them. If you're worried about security, you can always just scope your listeners to only accept webhooks from your bison url"**

**Implication for our P0 Security finding:**
- Wave 5 audit flagged EmailBison webhook receiver as "fail-open unsigned." Vendor confirmed they don't and won't sign webhooks.
- **Phase 1 fix is NOT to implement HMAC signing** — that's impossible.
- Instead: pragmatic options are
  1. **URL secret query param** (e.g. `https://outsignal-app.com/api/webhooks/emailbison?secret=XXXX`). EB webhook UI takes free-text URL — we control what goes in. Reject inbound webhooks missing the param.
  2. **IP allowlist** — if EB publishes outbound IPs, allowlist them.
  3. Both, layered.

The recommended pragmatic path is option 1 (URL secret) — works with EB's UI today without vendor changes.

## Webhook events available (per EB UI as of 2026-05-06)

Confirmed from screenshot of the webhook setup page:

- `email_sent`, `manual_email_sent`
- `lead_first_contacted`, `lead_replied`, `lead_interested`, `lead_unsubscribed`
- `email_opened`, `email_bounced`
- `untracked_reply_received`
- `email_account_added`, `email_account_removed`, `email_account_disconnected`, `email_account_reconnected`
- `tag_attached`, `tag_removed`
- `warmup_disabled_causing_bounces`, `warmup_disabled_receiving_bounces`

## Verification status update

- Previous (Wave 2): `verification_status: incomplete` / `doc_confidence: official-partial`
- After this user-fill (2026-05-06): **`verification_status: verified`** / **`doc_confidence: official-full`**

EmailBison spec at `docs/api-specs/emailbison-api-v1.md` should be updated accordingly.
