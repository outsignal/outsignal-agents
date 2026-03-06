import { z } from "zod";

// POST /api/lists
export const createListSchema = z.object({
  name: z.string().min(1, "name is required"),
  workspaceSlug: z.string().min(1, "workspaceSlug is required"),
  description: z.string().optional(),
});

// POST /api/lists/[id]/people — add people to list
const selectAllFiltersSchema = z.object({
  q: z.string().optional(),
  vertical: z.array(z.string()).optional(),
  workspace: z.string().optional(),
  enrichment: z.string().optional(),
  company: z.string().optional(),
});

export const addPeopleToListSchema = z.union([
  z.object({
    personIds: z.array(z.string()).min(1),
    selectAllFilters: z.never().optional(),
  }),
  z.object({
    personIds: z.never().optional(),
    selectAllFilters: selectAllFiltersSchema,
  }),
]);

// DELETE /api/lists/[id]/people — remove person from list
export const removePeopleFromListSchema = z.object({
  personId: z.string().min(1, "personId is required"),
});
