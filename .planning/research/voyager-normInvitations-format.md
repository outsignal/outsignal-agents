# Voyager Connection Request: Correct Endpoint & Payload

## Summary

The `/growth/normInvitations` endpoint used in the original VoyagerClient implementation
is **deprecated** by LinkedIn. The correct endpoint is the newer Dash-based relationship
creation endpoint.

## Correct Endpoint

```
POST /voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2
```

## Correct Payload Format

```json
{
  "invitee": {
    "inviteeUnion": {
      "memberProfile": "urn:li:fsd_profile:ACoAAA..."
    }
  },
  "customMessage": "Optional note, max 300 characters"
}
```

### Key Differences from Old Format

| Aspect | Old (`/growth/normInvitations`) | New (`/voyagerRelationshipsDashMemberRelationships`) |
|---|---|---|
| Endpoint | `/growth/normInvitations` | `/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=...` |
| URN field | `inviteeUrn` (top-level string) | `invitee.inviteeUnion.memberProfile` (nested) |
| Message field | `message` (optional, omit if empty) | `customMessage` (always present, empty string if no note) |
| Tracking ID | Client-generated `trackingId` | Not required (server-generated) |
| Invitation type | `invitationType: "CONNECTION"` | Implicit from endpoint |

## Error Handling

- **HTTP 400** with `CANT_RESEND_YET` in body: Already sent a pending invitation to this person.
  Map to `{ success: false, error: "already_invited" }`.
- **HTTP 429**: Rate limited. Retry with backoff.
- **HTTP 403**: Auth expired or forbidden.

## Note Validation

LinkedIn enforces a **300-character maximum** on connection request notes. Validate
client-side before sending to avoid unnecessary API calls.

## Source

- `linkedin-api` Python library v2.3.1 (https://github.com/tomquirk/linkedin-api)
  - File: `linkedin_api/linkedin.py`, method `add_connection()`
  - The Python library updated to this endpoint format; the old `normInvitations` path
    returns errors on current LinkedIn builds.
- Confirmed via network traffic analysis of LinkedIn web app (Chrome DevTools).

## Date

2026-03-02
