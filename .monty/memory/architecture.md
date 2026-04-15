<!-- architecture.md | monty | seeded: 2026-04-03 -->
<!-- Write governance: APPEND only, with ISO timestamp. Max 200 lines. -->

# Monty -- Architecture Patterns

<!-- Append entries as: [ISO date] -- [pattern or observation] -->

[2026-04-15T15:00:00Z] -- Pattern: CLI + HTTP route sharing via extracted helper. For any operation that needs both an HTTP surface (portal) AND a CLI surface (ops + agents), the implementation sits in `src/lib/<domain>/<op>.ts` and both callers delegate to it. The route maps helper failure codes back to HTTP status codes via a small mapper function (e.g. `deployFailureHttpStatus`). First use: BL-061 `initiateCampaignDeploy` in `src/lib/campaigns/deploy-campaign.ts`, consumed by `src/app/api/campaigns/[id]/deploy/route.ts` (non-retry branch) and `scripts/cli/campaign-deploy.ts`. The helper returns a discriminated union `{ok:true, ...} | {ok:false, code, reason, ...}` — never throws for business failures, only for genuinely unexpected errors. Dry-run is a first-class helper arg that short-circuits after validation so callers get "what would happen" without mutations. This pattern should be reused for any future CLI-wraps-route work (e.g. campaign pause/resume, sender rotation).
