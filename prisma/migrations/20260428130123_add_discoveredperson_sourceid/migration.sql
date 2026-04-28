-- AlterTable
ALTER TABLE "DiscoveredPerson" ADD COLUMN "sourceId" TEXT;

-- CreateIndex
CREATE INDEX "DiscoveredPerson_discoverySource_sourceId_idx" ON "DiscoveredPerson"("discoverySource", "sourceId");
