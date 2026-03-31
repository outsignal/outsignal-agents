-- AlterTable: Make Person (Lead) email nullable
-- This allows discovered people to be promoted without placeholder emails.
-- PostgreSQL unique constraint on nullable columns: multiple NULLs are allowed.
ALTER TABLE "Lead" ALTER COLUMN "email" DROP NOT NULL;
