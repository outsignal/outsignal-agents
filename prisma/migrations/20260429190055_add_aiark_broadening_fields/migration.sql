-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "profileSummary" TEXT,
ADD COLUMN "profileImageUrl" TEXT,
ADD COLUMN "seniority" TEXT,
ADD COLUMN "departments" JSONB,
ADD COLUMN "functions" JSONB,
ADD COLUMN "education" JSONB,
ADD COLUMN "certifications" JSONB,
ADD COLUMN "languages" JSONB;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "itSpend" BIGINT,
ADD COLUMN "hqPostalCode" TEXT,
ADD COLUMN "officeLocations" JSONB,
ADD COLUMN "industries" JSONB,
ADD COLUMN "naicsCodes" JSONB,
ADD COLUMN "companyKeywords" JSONB,
ADD COLUMN "hashtags" JSONB;
