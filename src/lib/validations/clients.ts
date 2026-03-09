import { z } from "zod";

// POST /api/clients
export const createClientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  contactEmail: z.string().email().optional(),
  contactName: z.string().optional(),
  website: z.string().optional(),
  companyOverview: z.string().optional(),
  notes: z.string().optional(),
  links: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
  pipelineStatus: z.string().optional(),
  campaignType: z.string().optional(),
  workspaceSlug: z.string().optional(),
  proposalId: z.string().optional(),
});

// PATCH /api/clients/[id]
export const updateClientSchema = z.object({
  name: z.string().min(1).optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactName: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  companyOverview: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  links: z.array(z.object({ label: z.string(), url: z.string() })).nullable().optional(),
  pipelineStatus: z.string().optional(),
  campaignType: z.string().optional(),
  workspaceSlug: z.string().nullable().optional(),
  proposalId: z.string().nullable().optional(),
});

// POST /api/clients/[id]/populate
export const populateClientTasksSchema = z.object({
  templateType: z.enum(["email", "email_linkedin", "scale"]).optional(),
});

// POST /api/clients/[id]/tasks
export const addTaskSchema = z.object({
  stage: z.string().min(1, "stage is required"),
  title: z.string().min(1, "title is required"),
  dueDate: z.string().optional(),
});

// PATCH /api/clients/[id]/tasks/[taskId]
export const updateTaskSchema = z.object({
  title: z.string().optional(),
  status: z.string().optional(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// PATCH /api/clients/[id]/tasks/[taskId]/subtasks/[subtaskId]
export const updateSubtaskSchema = z.object({
  status: z.enum(["todo", "in_progress", "complete"]),
});
