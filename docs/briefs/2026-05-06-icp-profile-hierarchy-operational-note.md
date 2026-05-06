# ICP Profile Hierarchy Operational Note

Wave 1 adds `IcpProfile.parentProfileId` so workspaces can compose a universal
ICP profile with vertical and sub-vertical child profiles. Existing flat
profiles keep `parentProfileId = null` and continue to resolve as before.

## Delete Behaviour

The parent relation uses `ON DELETE RESTRICT`. A parent profile cannot be
deleted while child profiles still point at it. This is intentional: deleting a
universal profile without first reviewing its children would silently change
scoring semantics.

Operationally, workspace deletion or profile cleanup may need to unlink or
delete child profiles before deleting a parent profile. Phase 3 CLI/admin tools
should surface this clearly instead of exposing raw database constraint errors.

## Follow-Ups

- Wave 2: update the scorer prompt to consume the merged `scoringRubric`, not
  only the merged `description`.
- Wave 1.5: show ICP profile lineage breadcrumbs on each ICP-scored lead in the
  admin UI so PMs can see why a profile was applied.
