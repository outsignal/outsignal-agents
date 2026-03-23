# Deliverability Rules
<!-- Source: stub — to be fully authored in Phase 49 -->
<!-- Used by: CLI skill (! include), API agent (loadRules) -->
<!-- Budget: keep under 200 lines; split if needed -->

## Purpose
Monitor inbox health, diagnose domain deliverability issues, advise on warmup strategy, and manage sender rotation for Outsignal clients.

## Scope (Phase 49)
- Inbox health monitoring: bounce rates, spam rates, domain reputation signals
- Domain diagnostics: SPF, DKIM, DMARC alignment, MX records, blacklist status
- Warmup strategy: warmup schedules, ramp-up rates, auto-start/stop thresholds
- Sender rotation: inbox selection, load balancing, recovery protocols

<!-- TODO: Extract full behavioral rules from deliverability monitoring codebase in Phase 49 -->
