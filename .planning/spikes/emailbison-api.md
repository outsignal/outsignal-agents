# EmailBison API Spike

**Probed:** 2026-02-27
**Instance:** `https://app.outsignal.ai/api` (Outsignal white-label workspace)
**Purpose:** Verify campaign create, sequence step schema, lead upload, and lead-to-campaign assignment endpoints for Phase 10 design (DEPLOY-01 requirement)

---

## Summary

Lead upload and campaign creation both work via API. Sequence steps can be added to an existing campaign via `POST /campaigns/{id}/sequence-steps`. However, **there is no API endpoint to assign an existing lead to a campaign**. All tested approaches for lead-campaign assignment return 404 or 405. Phase 10 (DEPLOY-04) must plan around this gap.

---

## Verified Endpoints

### Lead Operations

**`POST /leads`** — Create a lead in the workspace
```
Status: 201
Request body:
{
  "email": "required@example.com",
  "first_name": "string (optional)",
  "last_name": "string (optional)",
  "title": "string (optional)",
  "company": "string (optional)",
  "phone": "string (optional)",
  "custom_variables": [{ "name": "string", "value": "string" }]
}

Response:
{
  "data": {
    "id": 22145,
    "first_name": "Test",
    "last_name": "Spike",
    "email": "...",
    "title": "CEO",
    "company": "SpikeTest Inc",
    "status": "unverified",
    "custom_variables": [],
    "overall_stats": { "emails_sent": null, "opens": null, ... },
    "created_at": "2026-02-27T18:08:15.000000Z"
  }
}

Notes:
- campaign_id field in body is silently ignored (tested) — no campaign assignment
- Lead status on creation is always "unverified"
- Returns EmailBison-internal integer ID (e.g. 22145)
```

**`DELETE /leads/{id}`** — Delete a lead
```
Status: 200
```

**`GET /campaigns/{id}/leads`** — List leads in a campaign
```
Status: 200
Returns paginated list of leads with lead_campaign_data array
```

### Campaign Operations

**`POST /campaigns`** — Create a campaign
```
Status: 201
Request body:
{
  "name": "required string",
  "type": "outbound | inbound (default: outbound)",
  "max_emails_per_day": number (default: 1000),
  "max_new_leads_per_day": number (default: 100),
  "plain_text": boolean (default: true)
}

Response:
{
  "data": {
    "id": 53,
    "uuid": "...",
    "sequence_id": null,   ← IMPORTANT: fresh campaign has no sequence
    "name": "API-Spike-Test-...",
    "status": "draft",
    ...
  }
}

Notes:
- Fresh campaign always has sequence_id: null
- Must POST sequence steps to create a sequence
```

**`POST /campaigns/{id}/duplicate`** — Duplicate a campaign (copies sequence)
```
Status: 201
Request body: {} (name param is ignored — always "Copy of {original}")
Response: Same as campaign create but with inherited sequence_id

Notes:
- sequence_id is SHARED with the original (same sequence record)
- Name is always "Copy of {original}" regardless of request
- Best way to create a campaign with existing sequence steps
```

**`DELETE /campaigns/{id}`** — Delete a campaign
```
Status: 200
Response: { "data": { "success": true, "message": "... has been queued for deletion." } }
Note: Deletion is asynchronous (queued)
```

### Sequence Step Operations

**`GET /campaigns/{id}/sequence-steps`** — List sequence steps
```
Status: 200
Response when sequence exists:
{
  "data": [
    {
      "id": 174,
      "email_subject": "Hiring AI signals",
      "order": 1,
      "email_body": "<p>HTML content</p>",
      "wait_in_days": 3,
      "variant": false,
      "variant_from_step": null,
      "attachments": null,
      "thread_reply": false,
      "created_at": "2026-02-06T13:42:38.000000Z",
      "updated_at": "2026-02-06T14:05:50.000000Z"
    },
    ...
  ]
}

Response when no sequence:
{
  "data": { "success": false, "message": "Sequence steps do not exist for {campaign name}" }
}

IMPORTANT: The path /campaigns/sequence-steps?campaign_id={id} used in EmailBisonClient.getSequenceSteps()
returns 404. The CORRECT path is /campaigns/{id}/sequence-steps.
Fix needed in src/lib/emailbison/client.ts.
```

**`POST /campaigns/{id}/sequence-steps`** — Add sequence steps
```
Status: 200 (or 422 on validation error)

Request body:
{
  "title": "any string (ignored, always null in response)",
  "sequence_steps": [
    {
      "email_subject": "required string",
      "email_body": "required HTML string",
      "wait_in_days": "required integer >= 1"
    }
  ]
}

Validation rules:
- email_subject: required
- email_body: required
- wait_in_days: required, minimum 1 (NOT 0)

CRITICAL BEHAVIOR: This endpoint APPENDS steps to the existing sequence.
It does NOT replace the sequence. If called twice with 1 step each time,
the campaign ends up with 2 steps (plus any pre-existing steps from duplicate).

Response: Full sequence object with all steps (pre-existing + newly added)
```

---

## Lead-to-Campaign Assignment: NOT AVAILABLE

All tested approaches for assigning an existing lead to a campaign via API fail:

| Endpoint Tested | Method | Result |
|-----------------|--------|--------|
| `/campaigns/{id}/leads` | POST | 405 — "Supported methods: GET, HEAD, DELETE" |
| `/campaigns/{id}/leads` | PUT | 405 — Same |
| `/campaigns/{id}/leads` | PATCH | 405 — Same |
| `/campaign-leads` | POST | 404 |
| `/campaigns/{id}/assign-lead` | POST | 404 |
| `/leads/{id}/campaigns` | POST | 404 |
| `/campaigns/{id}/import` | POST | 404 |
| `/campaigns/{id}` | PATCH | 405 |
| `POST /leads` with `campaign_id` field | — | 201, silently ignored |
| `POST /leads` with `campaign_ids` array | — | 201, silently ignored |

**Conclusion:** Campaign-lead assignment is not available via the EmailBison API. This is likely a UI-only operation (CSV import or manual assignment in the dashboard).

---

## Impact on Phase Designs

### Phase 7 (LEAD-04) — Export to EmailBison from chat
- "Export to EmailBison" = upload leads as `POST /leads` to workspace
- Leads appear in EmailBison lead list and can be assigned to campaigns manually from the UI
- Chat confirmation should say: "X leads uploaded to EmailBison workspace" NOT "added to campaign Y"
- Export should report success/failure per lead and note any already-existing leads (check by email before upload, or handle duplicate errors)

### Phase 10 (DEPLOY-04) — System assigns leads to campaign
- **Blocked by missing API endpoint**
- Options:
  1. Accept the gap — leads are uploaded to workspace, campaign assignment is manual
  2. Use `POST /campaigns/{id}/duplicate` to create a campaign pre-populated with sequence steps, then rely on EmailBison's automatic lead-to-campaign routing (unverified — needs further investigation)
  3. Wait for EmailBison API update to expose this endpoint
- **Recommended:** Option 1 for Phase 10. Document gap clearly in DEPLOY-04 planning. Build the upload + sequence-step-write path that works; note campaign assignment is manual.

### Fix Needed in `src/lib/emailbison/client.ts`
`getSequenceSteps()` currently calls `/campaigns/sequence-steps?campaign_id={id}` which returns 404.
Correct path: `/campaigns/${campaignId}/sequence-steps`
```typescript
// Current (broken):
async getSequenceSteps(campaignId: number): Promise<SequenceStep[]> {
  return this.getAllPages<SequenceStep>(
    `/campaigns/sequence-steps?campaign_id=${campaignId}`,
  );
}

// Correct:
async getSequenceSteps(campaignId: number): Promise<SequenceStep[]> {
  return this.getAllPages<SequenceStep>(
    `/campaigns/${campaignId}/sequence-steps`,
  );
}
```

---

*Spike completed: 2026-02-27 via live API probes (6 probe scripts)*
