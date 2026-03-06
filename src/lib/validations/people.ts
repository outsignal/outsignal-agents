import { z } from "zod";

// POST /api/people/import
export const importPeopleSchema = z.object({
  contacts: z.array(z.record(z.string(), z.unknown())).optional(),
  company: z.record(z.string(), z.unknown()).optional(),
  workspace: z.string().optional(),
  vertical: z.string().optional(),
});
