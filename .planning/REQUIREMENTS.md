# Requirements: Outsignal v10.0 Unified Outbound Architecture

**Defined:** 2026-04-08
**Core Value:** Channel-agnostic outbound platform where EmailBison is just one provider behind an adapter, not the foundation everything depends on.

## v10.0 Requirements

### Foundation

- [x] **FOUND-01**: All channel types, action types, and sender types extracted into typed constants (no raw strings in business logic)
- [x] **FOUND-02**: `ChannelAdapter` interface defined with methods: `getLeads`, `getActions`, `getMetrics`, `deploy`, `pause`, `resume`, `getSequenceSteps`
- [x] **FOUND-03**: Adapter registry (`Map<ChannelType, ChannelAdapter>`) with `getAdapter(channel)` resolver
- [x] **FOUND-04**: Unified type definitions: `UnifiedLead`, `UnifiedAction`, `UnifiedMetrics`, `UnifiedStep`, `CampaignChannelRef`

### Adapters

- [x] **ADAPT-01**: LinkedIn adapter implementing full `ChannelAdapter` interface (wraps existing DB queries + Railway worker calls)
- [x] **ADAPT-02**: Email adapter implementing full `ChannelAdapter` interface (wraps existing EmailBison client)
- [x] **ADAPT-03**: Adapter unit tests with mock implementations validating interface contract

### Campaign

- [x] **CAMP-01**: Campaign deployment uses adapters (`executeDeploy` resolves adapter per channel, no direct EmailBison/LinkedIn calls)
- [x] **CAMP-02**: Campaign pause/resume uses adapters
- [x] **CAMP-03**: `CampaignChannelRef` replaces direct `emailBisonCampaignId` lookups across the codebase

### Sender

- [x] **SEND-01**: Sender queries go through channel-aware helpers (no more `channel: { in: ['linkedin', 'both'] }` scattered across files)
- [x] **SEND-02**: Workspace channel configuration — config that defines which channels each client has enabled

### Portal

- [x] **PORT-01**: Portal campaign detail page consumes adapters for stats, leads, activity, sequence (replaces dual code paths)
- [x] **PORT-02**: Portal dashboard consumes adapters for cross-channel overview metrics
- [x] **PORT-03**: Portal activity feed consumes adapters (no direct table queries)

### Analytics & Notifications

- [x] **ANAL-01**: Metrics snapshot task uses adapters for per-channel metrics collection
- [ ] **ANAL-02**: Cross-channel performance comparison view — side-by-side email vs LinkedIn metrics per workspace
- [x] **ANAL-03**: Notifications are channel-aware (deploy, health alerts, digests adapt to workspace's enabled channels)

## Future Requirements

### New Channel Adapters

- **CHAN-01**: Paid ads adapter (when provider is selected)
- **CHAN-02**: Cold calls adapter (when provider is selected)
- **CHAN-03**: SMS/WhatsApp adapter (if needed)

### Advanced Cross-Channel

- **CROSS-01**: Cross-channel attribution (which channel combination produces best results)
- **CROSS-02**: Unified sequence builder (interleaved email + LinkedIn in one timeline) — explicitly deferred, agency model requires separate approval flows

## Out of Scope

| Feature | Reason |
|---------|--------|
| Unified sequence builder (interleaved channels) | Agency approval model requires separate email/LinkedIn sequences for dual approval |
| Real-time cross-channel switching | EmailBison latency makes it meaningless |
| Replacing EmailBison as email provider | EmailBison stays as the email provider — adapter wraps it, doesn't replace it |
| Paid ads / cold call implementation | v10.0 builds the adapter foundation — actual new channel adapters are future work |
| Webhook handlers through adapters | Webhooks are inbound event handlers, peers to adapters, not children |
| Sender.channel junction table refactor | Cleaner model but too large a migration surface for this milestone |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 71 | Complete |
| FOUND-02 | Phase 71 | Complete |
| FOUND-03 | Phase 71 | Complete |
| FOUND-04 | Phase 71 | Complete |
| ADAPT-01 | Phase 72 | Complete |
| ADAPT-02 | Phase 72 | Complete |
| ADAPT-03 | Phase 72 | Complete |
| SEND-01 | Phase 72 | Complete |
| SEND-02 | Phase 72 | Complete |
| CAMP-01 | Phase 73 | Complete |
| CAMP-02 | Phase 73 | Complete |
| CAMP-03 | Phase 73 | Complete |
| PORT-01 | Phase 74 | Complete |
| PORT-02 | Phase 74 | Complete |
| PORT-03 | Phase 74 | Complete |
| ANAL-01 | Phase 75 | Complete |
| ANAL-02 | Phase 75 | Pending |
| ANAL-03 | Phase 75 | Complete |

**Coverage:**
- v10.0 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0

---
*Requirements defined: 2026-04-08*
*Last updated: 2026-04-08 after roadmap creation*
