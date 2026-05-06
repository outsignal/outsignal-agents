ALTER TABLE "IcpProfile" ADD COLUMN "parentProfileId" TEXT;

CREATE INDEX "IcpProfile_parentProfileId_idx" ON "IcpProfile"("parentProfileId");

-- Restrict parent deletion so child profiles must be reviewed or unlinked
-- before deleting a universal/profile parent.
ALTER TABLE "IcpProfile"
  ADD CONSTRAINT "IcpProfile_parentProfileId_fkey"
  FOREIGN KEY ("parentProfileId")
  REFERENCES "IcpProfile"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
