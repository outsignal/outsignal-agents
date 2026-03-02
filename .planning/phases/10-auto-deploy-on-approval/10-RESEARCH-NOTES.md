# Phase 10 Research Notes

## EmailBison Campaign Lead Endpoints

Discovered via customer support ticket (2026-03-02). EmailBison has API endpoints for attaching leads to campaigns:

### Option 1: Attach an existing lead list to a campaign
```
POST /api/campaigns/{campaign_id}/leads/attach-lead-list
Body: the ID of the lead list to add
```

### Option 2: Attach specific leads (by lead IDs) to a campaign
```
POST /api/campaigns/{campaign_id}/leads/attach-leads
Body: an array of lead IDs to add
```

### Documentation
- Adding Leads to a Campaign: https://docs.emailbison.com/campaigns/adding-leads-to-a-campaign
- API Reference: https://dedi.emailbison.com/api/reference

### Notes
- If adding leads to an active campaign, EmailBison caches them locally and syncs every 5 minutes to avoid interrupting sending
- For reply followup campaigns, use `POST /api/replies/{reply_id}/followup-campaign/push`
- Followup guide: https://help.bisonsphere.com/en/articles/20-followup-campaigns-guide

### Implications for Phase 10
- Auto-deploy can use `attach-leads` or `attach-lead-list` to push approved target list leads into the EmailBison campaign
- Need to check if our EmailBison client (`src/lib/emailbison/client.ts`) already has methods for these endpoints, or if they need to be added
