# Requirements: Outsignal Lead Engine

**Defined:** 2026-02-27
**Core Value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.

## v1.1 Requirements

Requirements for v1.1 Outbound Pipeline milestone. Each maps to roadmap phases.

### Leads Agent

- [ ] **LEAD-01**: Admin can search people and companies from Cmd+J dashboard chat
- [ ] **LEAD-02**: Admin can create, view, and manage target lists from dashboard chat
- [ ] **LEAD-03**: Admin can score leads (ICP qualification) from dashboard chat
- [ ] **LEAD-04**: Admin can export verified leads to EmailBison from dashboard chat
- [ ] **LEAD-05**: Leads Agent shares operations layer with MCP tools (no logic divergence)
- [ ] **LEAD-06**: All Leads Agent operations logged to AgentRun audit trail

### Portal Review

- [ ] **PORTAL-01**: Client can view a sample preview of leads in their target list from the portal
- [ ] **PORTAL-02**: Client can approve or reject the entire lead list (binary)
- [ ] **PORTAL-03**: Client can view preview of email/LinkedIn copy from the portal
- [ ] **PORTAL-04**: Client can approve or reject the entire copy batch (binary)
- [ ] **PORTAL-05**: Portal approval endpoints enforce workspace ownership via session

### Campaign Deploy

- [ ] **DEPLOY-01**: EmailBison campaign API capabilities discovered via spike (create, assign, sequence steps)
- [ ] **DEPLOY-02**: System creates new EmailBison campaigns or updates existing ones on approval
- [ ] **DEPLOY-03**: System adds sequence steps (email copy) to campaigns from approved drafts
- [ ] **DEPLOY-04**: System assigns leads from approved TargetList to campaign (if API supports)
- [ ] **DEPLOY-05**: Deploy handles leads-only, copy-only, or both depending on what's approved
- [ ] **DEPLOY-06**: Deploy is fire-and-forget with progress tracking

### Notifications

- [ ] **NOTIF-01**: Admin receives Slack notification when client approves or rejects
- [ ] **NOTIF-02**: Admin receives email notification when client approves or rejects

### Schema + Admin

- [ ] **SCHEMA-01**: TargetList has status field (building → pending_review → approved → rejected → deployed)
- [ ] **SCHEMA-02**: Admin can promote target list to pending_review and drafts to review status

## Future Requirements

Deferred to later milestones. Tracked but not in current roadmap.

### Campaign Agent

- **CAMP-01**: Admin can deploy campaigns from Cmd+J chat (thin wrapper over deploy service)

### Lead Scoring

- **SCORE-01**: Leads scored 1-10 based on signal overlap with cold email framework tiers

## Out of Scope

| Feature | Reason |
|---------|--------|
| Per-lead approve/reject in portal | Binary list-level approval only — per-lead is a scope trap |
| Enrichment from dashboard chat | Costs money per API call — keep as CLI-only to prevent accidental spend |
| Real-time intent signals | High complexity, future milestone |
| LinkedIn sequencer | Separate workstream, in progress on feature branch |
| Campaign Agent runner | Thin wrapper over deploy service — defer to v1.2 after deploy is proven |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LEAD-01 | Phase 7 | Pending |
| LEAD-02 | Phase 7 | Pending |
| LEAD-03 | Phase 7 | Pending |
| LEAD-04 | Phase 7 | Pending |
| LEAD-05 | Phase 7 | Pending |
| LEAD-06 | Phase 7 | Pending |
| DEPLOY-01 | Phase 7 | Pending |
| SCHEMA-01 | Phase 8 | Pending |
| SCHEMA-02 | Phase 8 | Pending |
| PORTAL-01 | Phase 9 | Pending |
| PORTAL-02 | Phase 9 | Pending |
| PORTAL-03 | Phase 9 | Pending |
| PORTAL-04 | Phase 9 | Pending |
| PORTAL-05 | Phase 9 | Pending |
| NOTIF-01 | Phase 9 | Pending |
| NOTIF-02 | Phase 9 | Pending |
| DEPLOY-02 | Phase 10 | Pending |
| DEPLOY-03 | Phase 10 | Pending |
| DEPLOY-04 | Phase 10 | Pending |
| DEPLOY-05 | Phase 10 | Pending |
| DEPLOY-06 | Phase 10 | Pending |

**Coverage:**
- v1.1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0

---
*Requirements defined: 2026-02-27*
*Last updated: 2026-02-27 after roadmap creation*
