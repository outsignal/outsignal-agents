-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "providerIds" JSONB,
ADD COLUMN "headline" TEXT,
ADD COLUMN "skills" JSONB,
ADD COLUMN "jobHistory" JSONB,
ADD COLUMN "mobilePhone" TEXT,
ADD COLUMN "locationCity" TEXT,
ADD COLUMN "locationState" TEXT,
ADD COLUMN "locationCountry" TEXT,
ADD COLUMN "locationCountryCode" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "providerIds" JSONB,
ADD COLUMN "hqPhone" TEXT,
ADD COLUMN "hqAddress" TEXT,
ADD COLUMN "hqCity" TEXT,
ADD COLUMN "hqState" TEXT,
ADD COLUMN "hqCountry" TEXT,
ADD COLUMN "hqCountryCode" TEXT,
ADD COLUMN "socialUrls" JSONB,
ADD COLUMN "technologies" JSONB,
ADD COLUMN "fundingTotal" BIGINT,
ADD COLUMN "fundingStageLatest" TEXT,
ADD COLUMN "fundingLatestDate" TIMESTAMP(3),
ADD COLUMN "fundingEvents" JSONB,
ADD COLUMN "jobPostingsActiveCount" INTEGER,
ADD COLUMN "jobPostingTitles" JSONB;
