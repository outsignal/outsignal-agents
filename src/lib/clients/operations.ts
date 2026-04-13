/**
 * Shared operations layer for the Client Management feature.
 *
 * ALL Prisma queries and business logic for clients live here.
 * API routes and MCP tools are thin wrappers that call these functions.
 * Never put DB queries or business logic inside route handlers directly.
 *
 * Exports: listClients, getClient, createClient, updateClient, deleteClient,
 *          populateClientTasks, updateTaskStatus, updateSubtaskStatus,
 *          addTask, updateTask, deleteTask
 */

import { prisma } from "@/lib/db";
import { TASK_TEMPLATES, type TemplateType } from "./task-templates";

export interface ClientLink {
  label: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Pipeline status groups
// ---------------------------------------------------------------------------

const PIPELINE_STATUSES = [
  "new_lead",
  "contacted",
  "qualified",
  "demo",
  "proposal",
  "negotiation",
  "closed_lost",
  "unqualified",
];

const POST_PIPELINE_STATUSES = ["closed_won", "churned"];

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface StageProgress {
  stage: string;
  total: number;
  completed: number;
  percentage: number;
}

export interface ClientSummary {
  id: string;
  name: string;
  pipelineStatus: string;
  campaignType: string;
  workspaceSlug: string | null;
  workspaceType?: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contactName: string | null;
  website: string | null;
  companyOverview: string | null;
  notes: string | null;
  stageProgress: StageProgress[];
  outstandingTasks: number;
  overdueTasks: number;
  createdAt: Date;
}

export interface ClientTaskDetail {
  id: string;
  stage: string;
  title: string;
  status: string;
  order: number;
  assignee: string;
  dueDate: Date | null;
  notes: string | null;
  blockedBy: string[];
  recurring: string | null;
  recurringDay: number | null;
  subtasks: { id: string; title: string; status: string; order: number }[];
  subtaskProgress: { total: number; completed: number };
}

export interface ClientDetail extends ClientSummary {
  website: string | null;
  companyOverview: string | null;
  proposalId: string | null;
  notes: string | null;
  links: ClientLink[];
  startedAt: Date | null;
  tasks: ClientTaskDetail[];
  updatedAt: Date;
}

export interface CreateClientParams {
  name: string;
  contactEmail?: string;
  contactPhone?: string;
  contactName?: string;
  website?: string;
  companyOverview?: string;
  notes?: string;
  links?: ClientLink[];
  pipelineStatus?: string;
  campaignType?: string;
  workspaceSlug?: string;
  proposalId?: string;
}

export interface UpdateClientParams {
  name?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactName?: string;
  website?: string;
  companyOverview?: string;
  notes?: string;
  links?: ClientLink[];
  pipelineStatus?: string;
  campaignType?: string;
  workspaceSlug?: string;
  proposalId?: string;
}

export interface ClientFilters {
  pipelineStatus?: string;
  hasWorkspace?: boolean;
  search?: string;
  isPipeline?: boolean; // true = pre-closed_won statuses only, false = closed_won+
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string into a string array (blockedBy field).
 */
function parseBlockedBy(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Parse a JSON string into a ClientLink array.
 */
function parseLinks(value: string | null): ClientLink[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Compute stage progress from a list of tasks.
 */
function computeStageProgress(
  tasks: { stage: string; status: string }[],
): StageProgress[] {
  const stageMap = new Map<string, { total: number; completed: number }>();

  for (const task of tasks) {
    const entry = stageMap.get(task.stage) ?? { total: 0, completed: 0 };
    entry.total += 1;
    if (task.status === "complete") {
      entry.completed += 1;
    }
    stageMap.set(task.stage, entry);
  }

  return Array.from(stageMap.entries()).map(([stage, counts]) => ({
    stage,
    total: counts.total,
    completed: counts.completed,
    percentage: counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0,
  }));
}

/**
 * Format a raw task record (with subtasks) into ClientTaskDetail.
 */
function formatTaskDetail(
  raw: {
    id: string;
    stage: string;
    title: string;
    status: string;
    order: number;
    assignee: string;
    dueDate: Date | null;
    notes: string | null;
    blockedBy: string | null;
    recurring: string | null;
    recurringDay: number | null;
    subtasks: { id: string; title: string; status: string; order: number }[];
  },
): ClientTaskDetail {
  const sortedSubtasks = [...raw.subtasks].sort((a, b) => a.order - b.order);
  const completed = sortedSubtasks.filter((s) => s.status === "complete").length;

  return {
    id: raw.id,
    stage: raw.stage,
    title: raw.title,
    status: raw.status,
    order: raw.order,
    assignee: raw.assignee,
    dueDate: raw.dueDate,
    notes: raw.notes,
    blockedBy: parseBlockedBy(raw.blockedBy),
    recurring: raw.recurring,
    recurringDay: raw.recurringDay,
    subtasks: sortedSubtasks.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      order: s.order,
    })),
    subtaskProgress: {
      total: sortedSubtasks.length,
      completed,
    },
  };
}

/**
 * Format a raw client record (with tasks and subtasks) into ClientDetail.
 */
function formatClientDetail(
  raw: {
    id: string;
    name: string;
    pipelineStatus: string;
    campaignType: string;
    workspaceSlug: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    contactName: string | null;
    website: string | null;
    companyOverview: string | null;
    proposalId: string | null;
    notes: string | null;
    links: string | null;
    startedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    tasks: {
      id: string;
      stage: string;
      title: string;
      status: string;
      order: number;
      assignee: string;
      dueDate: Date | null;
      notes: string | null;
      blockedBy: string | null;
      recurring: string | null;
      recurringDay: number | null;
      subtasks: { id: string; title: string; status: string; order: number }[];
    }[];
  },
): ClientDetail {
  // Sort tasks by stage order then by order within stage
  const stageOrder = ["onboarding", "campaign_setup", "campaign_launch", "customer_success"];
  const sortedTasks = [...raw.tasks].sort((a, b) => {
    const stageA = stageOrder.indexOf(a.stage);
    const stageB = stageOrder.indexOf(b.stage);
    if (stageA !== stageB) return stageA - stageB;
    return a.order - b.order;
  });

  const now = new Date();

  return {
    id: raw.id,
    name: raw.name,
    pipelineStatus: raw.pipelineStatus,
    campaignType: raw.campaignType,
    workspaceSlug: raw.workspaceSlug,
    contactEmail: raw.contactEmail,
    contactPhone: raw.contactPhone,
    contactName: raw.contactName,
    stageProgress: computeStageProgress(raw.tasks),
    outstandingTasks: raw.tasks.filter((t) => t.status !== "complete").length,
    overdueTasks: raw.tasks.filter(
      (t) => t.status !== "complete" && t.dueDate != null && t.dueDate < now,
    ).length,
    createdAt: raw.createdAt,
    website: raw.website,
    companyOverview: raw.companyOverview,
    proposalId: raw.proposalId,
    notes: raw.notes,
    links: parseLinks(raw.links),
    startedAt: raw.startedAt,
    tasks: sortedTasks.map(formatTaskDetail),
    updatedAt: raw.updatedAt,
  };
}

/**
 * Prisma include for tasks with subtasks.
 */
const tasksInclude = {
  tasks: {
    include: {
      subtasks: {
        select: {
          id: true,
          title: true,
          status: true,
          order: true,
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// 1. listClients — list clients with optional filters
// ---------------------------------------------------------------------------

/**
 * List clients with optional filters, ordered by createdAt descending.
 *
 * Filters:
 *   - pipelineStatus: exact match
 *   - search: name contains (case-insensitive)
 *   - hasWorkspace: true = workspaceSlug is not null, false = is null
 *   - isPipeline: true = pre-closed_won statuses, false = post-pipeline statuses
 *
 * @param filters - Optional filtering criteria
 * @returns Array of ClientSummary objects
 */
export async function listClients(
  filters?: ClientFilters,
): Promise<ClientSummary[]> {
  const where: Record<string, unknown> = {};

  if (filters?.pipelineStatus) {
    where.pipelineStatus = filters.pipelineStatus;
  }

  if (filters?.search) {
    where.name = { contains: filters.search, mode: "insensitive" };
  }

  if (filters?.hasWorkspace === true) {
    where.workspaceSlug = { not: null };
  } else if (filters?.hasWorkspace === false) {
    where.workspaceSlug = null;
  }

  if (filters?.isPipeline === true) {
    where.pipelineStatus = { in: PIPELINE_STATUSES };
  } else if (filters?.isPipeline === false) {
    where.pipelineStatus = { in: POST_PIPELINE_STATUSES };
  }

  const clients = await prisma.client.findMany({
    where,
    include: {
      tasks: {
        select: {
          stage: true,
          status: true,
          dueDate: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const now = new Date();

  // Fetch workspace types for clients that have a workspaceSlug
  const slugs = [...new Set(clients.map((c) => c.workspaceSlug).filter(Boolean))] as string[];
  const workspaceTypeMap = new Map<string, string>();
  if (slugs.length > 0) {
    const workspaces = await prisma.workspace.findMany({
      where: { slug: { in: slugs } },
      select: { slug: true, type: true },
    });
    for (const ws of workspaces) {
      workspaceTypeMap.set(ws.slug, ws.type);
    }
  }

  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    pipelineStatus: c.pipelineStatus,
    campaignType: c.campaignType,
    workspaceSlug: c.workspaceSlug,
    workspaceType: c.workspaceSlug ? workspaceTypeMap.get(c.workspaceSlug) : undefined,
    contactEmail: c.contactEmail,
    contactPhone: c.contactPhone,
    contactName: c.contactName,
    website: c.website,
    companyOverview: c.companyOverview,
    notes: c.notes,
    stageProgress: computeStageProgress(c.tasks),
    outstandingTasks: c.tasks.filter((t) => t.status !== "complete").length,
    overdueTasks: c.tasks.filter(
      (t) => t.status !== "complete" && t.dueDate != null && t.dueDate < now,
    ).length,
    createdAt: c.createdAt,
  }));
}

// ---------------------------------------------------------------------------
// 2. getClient — get a single client by ID
// ---------------------------------------------------------------------------

/**
 * Get a single client by ID with all tasks and subtasks.
 *
 * Tasks are ordered by [stage, order], subtasks ordered by order.
 * blockedBy JSON string is parsed into a string array.
 *
 * @param id - Client ID
 * @returns ClientDetail or null if not found
 */
export async function getClient(id: string): Promise<ClientDetail | null> {
  const client = await prisma.client.findUnique({
    where: { id },
    include: tasksInclude,
  });

  if (!client) return null;

  return formatClientDetail(client);
}

// ---------------------------------------------------------------------------
// 3. createClient — create a new client
// ---------------------------------------------------------------------------

/**
 * Create a new client record.
 *
 * If pipelineStatus is "closed_won", automatically populates tasks from
 * the template matching the client's campaignType.
 *
 * @param params - Client creation parameters
 * @returns The created ClientDetail
 */
export async function createClient(
  params: CreateClientParams,
): Promise<ClientDetail> {
  const client = await prisma.client.create({
    data: {
      name: params.name,
      contactEmail: params.contactEmail ?? null,
      contactPhone: params.contactPhone ?? null,
      contactName: params.contactName ?? null,
      website: params.website ?? null,
      companyOverview: params.companyOverview ?? null,
      notes: params.notes ?? null,
      links: params.links ? JSON.stringify(params.links) : null,
      pipelineStatus: params.pipelineStatus ?? "new_lead",
      campaignType: params.campaignType ?? "email_linkedin",
      workspaceSlug: params.workspaceSlug ?? null,
      proposalId: params.proposalId ?? null,
    },
    include: tasksInclude,
  });

  // Auto-populate tasks if created as closed_won
  if (client.pipelineStatus === "closed_won") {
    await populateClientTasks(
      client.id,
      client.campaignType as TemplateType,
    );

    // Re-fetch to include the populated tasks
    const updated = await prisma.client.findUnique({
      where: { id: client.id },
      include: tasksInclude,
    });

    return formatClientDetail(updated!);
  }

  return formatClientDetail(client);
}

// ---------------------------------------------------------------------------
// 4. updateClient — update client metadata
// ---------------------------------------------------------------------------

/**
 * Update client fields. Only provided fields are updated.
 *
 * If pipelineStatus changes to "closed_won" and the client has no tasks yet,
 * automatically populates tasks from the template.
 *
 * @param id - Client ID
 * @param params - Fields to update
 * @returns Updated ClientDetail
 * @throws If client not found
 */
export async function updateClient(
  id: string,
  params: UpdateClientParams,
): Promise<ClientDetail> {
  // Check current state for auto-populate logic
  const current = await prisma.client.findUnique({
    where: { id },
    select: {
      pipelineStatus: true,
      campaignType: true,
      _count: { select: { tasks: true } },
    },
  });

  if (!current) {
    throw new Error(`Client not found: '${id}'`);
  }

  // Build update data with only provided fields
  const data: Record<string, unknown> = {};
  if (params.name !== undefined) data.name = params.name;
  if (params.contactEmail !== undefined) data.contactEmail = params.contactEmail;
  if (params.contactPhone !== undefined) data.contactPhone = params.contactPhone;
  if (params.contactName !== undefined) data.contactName = params.contactName;
  if (params.website !== undefined) data.website = params.website;
  if (params.companyOverview !== undefined) data.companyOverview = params.companyOverview;
  if (params.notes !== undefined) data.notes = params.notes;
  if (params.pipelineStatus !== undefined) data.pipelineStatus = params.pipelineStatus;
  if (params.campaignType !== undefined) data.campaignType = params.campaignType;
  if (params.workspaceSlug !== undefined) data.workspaceSlug = params.workspaceSlug;
  if (params.proposalId !== undefined) data.proposalId = params.proposalId;
  if (params.links !== undefined) data.links = JSON.stringify(params.links);

  const client = await prisma.client.update({
    where: { id },
    data,
    include: tasksInclude,
  });

  // Auto-populate tasks if status changed to closed_won and no tasks exist
  const statusChangedToClosedWon =
    params.pipelineStatus === "closed_won" &&
    current.pipelineStatus !== "closed_won";

  if (statusChangedToClosedWon && current._count.tasks === 0) {
    const templateType = (params.campaignType ?? current.campaignType) as TemplateType;
    await populateClientTasks(client.id, templateType);

    // Re-fetch to include populated tasks
    const updated = await prisma.client.findUnique({
      where: { id: client.id },
      include: tasksInclude,
    });

    return formatClientDetail(updated!);
  }

  return formatClientDetail(client);
}

// ---------------------------------------------------------------------------
// 5. deleteClient — delete a client (cascade handles tasks/subtasks)
// ---------------------------------------------------------------------------

/**
 * Delete a client by ID. Cascade delete handles tasks and subtasks.
 *
 * @param id - Client ID
 * @throws If client not found
 */
export async function deleteClient(id: string): Promise<void> {
  const existing = await prisma.client.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) {
    throw new Error(`Client not found: '${id}'`);
  }

  await prisma.client.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// 6. populateClientTasks — create tasks from template
// ---------------------------------------------------------------------------

/**
 * Populate a client with tasks and subtasks from a template.
 *
 * Reads from TASK_TEMPLATES[templateType], creates ClientTask records with
 * ClientSubtask children, sets client.startedAt to now(), and resolves
 * blockedByIndices to actual task IDs.
 *
 * @param clientId - Client ID to populate
 * @param templateType - Template to use ("email", "email_linkedin", "linkedin", or "consultancy")
 * @throws If template type is invalid or client not found
 */
export async function populateClientTasks(
  clientId: string,
  templateType: TemplateType,
): Promise<void> {
  const templates = TASK_TEMPLATES[templateType];
  if (!templates) {
    throw new Error(`Invalid template type: '${templateType}'`);
  }

  // Create all tasks first (without blockedBy) to get their IDs
  const createdTaskIds: string[] = [];
  const now = new Date();

  for (const template of templates) {
    let dueDate: Date | null = null;
    if (template.dueDaysFromStart != null) {
      dueDate = new Date(now.getTime() + template.dueDaysFromStart * 24 * 60 * 60 * 1000);
    }

    const task = await prisma.clientTask.create({
      data: {
        clientId,
        stage: template.stage,
        title: template.title,
        order: template.order,
        assignee: template.assignee ?? "pm",
        status: "todo",
        dueDate,
        recurring: template.recurring ?? null,
        recurringDay: template.recurringDay ?? null,
        subtasks: {
          create: template.subtasks.map((sub) => ({
            title: sub.title,
            order: sub.order,
            status: "todo",
          })),
        },
      },
    });

    createdTaskIds.push(task.id);
  }

  // Resolve blockedByIndices to actual task IDs
  for (let i = 0; i < templates.length; i++) {
    const template = templates[i];
    if (template.blockedByIndices && template.blockedByIndices.length > 0) {
      const blockedByIds = template.blockedByIndices
        .filter((idx) => idx >= 0 && idx < createdTaskIds.length)
        .map((idx) => createdTaskIds[idx]);

      if (blockedByIds.length > 0) {
        await prisma.clientTask.update({
          where: { id: createdTaskIds[i] },
          data: { blockedBy: JSON.stringify(blockedByIds) },
        });
      }
    }
  }

  // Set startedAt on the client
  await prisma.client.update({
    where: { id: clientId },
    data: { startedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// 7. updateTaskStatus — update a task's status
// ---------------------------------------------------------------------------

/**
 * Update the status of a client task.
 *
 * @param taskId - ClientTask ID
 * @param status - New status ("todo", "in_progress", or "complete")
 * @returns Updated ClientTaskDetail
 * @throws If task not found
 */
export async function updateTaskStatus(
  taskId: string,
  status: string,
): Promise<ClientTaskDetail> {
  // If completing, fetch current state to check recurring
  let existingTask: { recurring: string | null; recurringDay: number | null; status: string; clientId: string; stage: string; title: string; assignee: string } | null = null;
  if (status === "complete") {
    existingTask = await prisma.clientTask.findUnique({
      where: { id: taskId },
      select: { recurring: true, recurringDay: true, status: true, clientId: true, stage: true, title: true, assignee: true },
    });
  }

  // Atomic check-and-update: only transition if not already complete (prevents race condition)
  if (status === "complete") {
    const result = await prisma.clientTask.updateMany({
      where: { id: taskId, status: { not: "complete" } },
      data: { status },
    });

    // If count is 0, another request already completed this task — skip recurrence creation
    if (
      result.count > 0 &&
      existingTask &&
      existingTask.recurring
    ) {
      await createNextRecurrence({
        clientId: existingTask.clientId,
        stage: existingTask.stage,
        title: existingTask.title,
        assignee: existingTask.assignee,
        recurring: existingTask.recurring,
        recurringDay: existingTask.recurringDay,
      });
    }
  } else {
    await prisma.clientTask.update({
      where: { id: taskId },
      data: { status },
    });
  }

  // Re-fetch the task with subtasks for the response
  const task = await prisma.clientTask.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      subtasks: {
        select: {
          id: true,
          title: true,
          status: true,
          order: true,
        },
      },
    },
  });

  return formatTaskDetail(task);
}

// ---------------------------------------------------------------------------
// 8. updateSubtaskStatus — update a subtask's status with auto-parent sync
// ---------------------------------------------------------------------------

/**
 * Update a subtask's status and auto-update the parent task status.
 *
 * Auto-sync rules:
 *   - If all subtasks are "complete" -> parent task becomes "complete"
 *   - If any subtask is "in_progress" or "complete" -> parent becomes "in_progress"
 *   - Otherwise -> parent stays/becomes "todo"
 *
 * @param subtaskId - ClientSubtask ID
 * @param status - New status ("todo", "in_progress", or "complete")
 * @throws If subtask not found
 */
export async function updateSubtaskStatus(
  subtaskId: string,
  status: string,
): Promise<void> {
  // Update the subtask
  const subtask = await prisma.clientSubtask.update({
    where: { id: subtaskId },
    data: { status },
    select: { taskId: true },
  });

  // Fetch all sibling subtasks to determine parent status
  const siblings = await prisma.clientSubtask.findMany({
    where: { taskId: subtask.taskId },
    select: { status: true },
  });

  let parentStatus: string;

  if (siblings.length === 0) {
    // No subtasks — leave parent unchanged
    return;
  }

  const allComplete = siblings.every((s) => s.status === "complete");
  const anyActive = siblings.some(
    (s) => s.status === "in_progress" || s.status === "complete",
  );

  if (allComplete) {
    parentStatus = "complete";
  } else if (anyActive) {
    parentStatus = "in_progress";
  } else {
    parentStatus = "todo";
  }

  // Fetch the parent task's current status and recurring info before updating
  const parentTask = await prisma.clientTask.findUnique({
    where: { id: subtask.taskId },
    select: { status: true, recurring: true, recurringDay: true, clientId: true, stage: true, title: true, assignee: true },
  });

  // Atomic check-and-update for completion: prevents duplicate recurrence creation
  if (parentStatus === "complete") {
    const result = await prisma.clientTask.updateMany({
      where: { id: subtask.taskId, status: { not: "complete" } },
      data: { status: parentStatus },
    });

    // Only create recurrence if we were the one to transition it (count > 0)
    if (
      result.count > 0 &&
      parentTask &&
      parentTask.recurring
    ) {
      await createNextRecurrence({
        clientId: parentTask.clientId,
        stage: parentTask.stage,
        title: parentTask.title,
        assignee: parentTask.assignee,
        recurring: parentTask.recurring,
        recurringDay: parentTask.recurringDay,
      });
    }
  } else {
    await prisma.clientTask.update({
      where: { id: subtask.taskId },
      data: { status: parentStatus },
    });
  }
}

// ---------------------------------------------------------------------------
// 9. addTask — add a new task to a client
// ---------------------------------------------------------------------------

/**
 * Add a new task to a client at the end of the specified stage.
 *
 * Order is automatically set to max(order) + 1 within the stage.
 *
 * @param clientId - Client ID
 * @param params - { stage, title, dueDate? }
 * @returns Created ClientTaskDetail
 * @throws If client not found
 */
export async function addTask(
  clientId: string,
  params: { stage: string; title: string; dueDate?: Date; assignee?: string; recurring?: string; recurringDay?: number },
): Promise<ClientTaskDetail> {
  // Verify client exists
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true },
  });

  if (!client) {
    throw new Error(`Client not found: '${clientId}'`);
  }

  // Find the max order in this stage for this client
  const maxOrderTask = await prisma.clientTask.findFirst({
    where: { clientId, stage: params.stage },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const nextOrder = (maxOrderTask?.order ?? -1) + 1;

  const task = await prisma.clientTask.create({
    data: {
      clientId,
      stage: params.stage,
      title: params.title,
      order: nextOrder,
      assignee: params.assignee ?? "pm",
      dueDate: params.dueDate ?? null,
      status: "todo",
      recurring: params.recurring ?? null,
      recurringDay: params.recurringDay ?? null,
    },
    include: {
      subtasks: {
        select: {
          id: true,
          title: true,
          status: true,
          order: true,
        },
      },
    },
  });

  return formatTaskDetail(task);
}

// ---------------------------------------------------------------------------
// 10. updateTask — update task fields
// ---------------------------------------------------------------------------

/**
 * Update task fields (title, dueDate, notes, status).
 *
 * Only provided fields are updated.
 * If the task is recurring and status changes to "complete", a new occurrence
 * is automatically created with the next due date.
 *
 * @param taskId - ClientTask ID
 * @param params - Fields to update
 * @returns Updated ClientTaskDetail
 * @throws If task not found
 */
export async function updateTask(
  taskId: string,
  params: { title?: string; dueDate?: Date | null; notes?: string; status?: string; assignee?: string },
): Promise<ClientTaskDetail> {
  // If status is changing to "complete", fetch full task first to check recurring
  let existingTask: { recurring: string | null; recurringDay: number | null; status: string; clientId: string; stage: string; title: string; assignee: string } | null = null;
  if (params.status === "complete") {
    existingTask = await prisma.clientTask.findUnique({
      where: { id: taskId },
      select: { recurring: true, recurringDay: true, status: true, clientId: true, stage: true, title: true, assignee: true },
    });
  }

  const data: Record<string, unknown> = {};
  if (params.title !== undefined) data.title = params.title;
  if (params.dueDate !== undefined) data.dueDate = params.dueDate;
  if (params.notes !== undefined) data.notes = params.notes;
  if (params.status !== undefined) data.status = params.status;
  if (params.assignee !== undefined) data.assignee = params.assignee;

  // Atomic check-and-update for completion: prevents duplicate recurrence creation
  if (params.status === "complete") {
    const result = await prisma.clientTask.updateMany({
      where: { id: taskId, status: { not: "complete" } },
      data,
    });

    // Only create recurrence if we were the one to transition it (count > 0)
    if (
      result.count > 0 &&
      existingTask &&
      existingTask.recurring
    ) {
      await createNextRecurrence({
        clientId: existingTask.clientId,
        stage: existingTask.stage,
        title: existingTask.title,
        assignee: existingTask.assignee,
        recurring: existingTask.recurring,
        recurringDay: existingTask.recurringDay,
      });
    }
  } else {
    await prisma.clientTask.update({
      where: { id: taskId },
      data,
    });
  }

  // Re-fetch the task with subtasks for the response
  const task = await prisma.clientTask.findUniqueOrThrow({
    where: { id: taskId },
    include: {
      subtasks: {
        select: {
          id: true,
          title: true,
          status: true,
          order: true,
        },
      },
    },
  });

  return formatTaskDetail(task);
}

// ---------------------------------------------------------------------------
// Recurring task helpers
// ---------------------------------------------------------------------------

/**
 * Calculate the next due date for a recurring task.
 *
 * - Weekly: next occurrence of the specified weekday (0=Sun .. 6=Sat) from today
 * - Monthly with day 1-31: that day in the next month (clamped to month length)
 * - Monthly with day -1: last working day (Mon-Fri) of the next month
 */
export function calculateNextDueDate(recurring: string, recurringDay: number | null): Date {
  const now = new Date();

  if (recurring === "weekly") {
    const targetDay = recurringDay ?? 5; // default Friday
    const currentDay = now.getDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil <= 0) daysUntil += 7; // always next week minimum
    const next = new Date(now);
    next.setDate(next.getDate() + daysUntil);
    next.setHours(9, 0, 0, 0); // 9am
    return next;
  }

  if (recurring === "monthly") {
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    if (recurringDay === -1) {
      // Last working day of next month
      const lastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0);
      // Walk backwards from last day to find Mon-Fri
      while (lastDay.getDay() === 0 || lastDay.getDay() === 6) {
        lastDay.setDate(lastDay.getDate() - 1);
      }
      lastDay.setHours(9, 0, 0, 0);
      return lastDay;
    }

    // Specific day of month (clamped to month length)
    const day = recurringDay ?? 1;
    const daysInNextMonth = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
    const clampedDay = Math.min(day, daysInNextMonth);
    const result = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), clampedDay, 9, 0, 0, 0);
    return result;
  }

  // Fallback: 7 days from now
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 7);
  fallback.setHours(9, 0, 0, 0);
  return fallback;
}

/**
 * Create the next occurrence of a recurring task.
 *
 * The new task gets status "todo" and a dueDate set to the next occurrence.
 * Subtasks are NOT copied.
 */
export async function createNextRecurrence(task: {
  clientId: string;
  stage: string;
  title: string;
  assignee: string;
  recurring: string;
  recurringDay: number | null;
}): Promise<void> {
  const dueDate = calculateNextDueDate(task.recurring, task.recurringDay);

  // Find the max order in this stage for this client
  const maxOrderTask = await prisma.clientTask.findFirst({
    where: { clientId: task.clientId, stage: task.stage },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  const nextOrder = (maxOrderTask?.order ?? -1) + 1;

  await prisma.clientTask.create({
    data: {
      clientId: task.clientId,
      stage: task.stage,
      title: task.title,
      assignee: task.assignee,
      recurring: task.recurring,
      recurringDay: task.recurringDay,
      status: "todo",
      dueDate,
      order: nextOrder,
    },
  });
}

/**
 * Ensure all recurring tasks have a pending (todo/in_progress) sibling.
 *
 * Finds all completed recurring tasks where no pending task with the same
 * title exists for the same client. Creates the next occurrence for each.
 *
 * This is a catch-up function for cases where the auto-creation didn't fire
 * (e.g. task completed directly in the DB).
 *
 * @returns Number of new tasks created
 */
export async function ensureRecurringTasksCurrent(): Promise<number> {
  // Find all recurring tasks that are complete
  const completedRecurring = await prisma.clientTask.findMany({
    where: {
      recurring: { not: null },
      status: "complete",
    },
    select: {
      id: true,
      clientId: true,
      stage: true,
      title: true,
      assignee: true,
      recurring: true,
      recurringDay: true,
    },
  });

  if (completedRecurring.length === 0) return 0;

  // Group by clientId+title to check for pending siblings
  const keys = new Set(completedRecurring.map((t) => `${t.clientId}::${t.title}`));

  // Find all pending (todo/in_progress) recurring tasks with matching clientId+title
  const pendingTasks = await prisma.clientTask.findMany({
    where: {
      recurring: { not: null },
      status: { in: ["todo", "in_progress"] },
    },
    select: {
      clientId: true,
      title: true,
    },
  });

  const pendingKeys = new Set(pendingTasks.map((t) => `${t.clientId}::${t.title}`));

  // Find keys that have completed but no pending sibling
  let created = 0;
  const processedKeys = new Set<string>();

  for (const task of completedRecurring) {
    const key = `${task.clientId}::${task.title}`;
    if (pendingKeys.has(key)) continue; // already has a pending sibling
    if (processedKeys.has(key)) continue; // already created one this run
    processedKeys.add(key);

    await createNextRecurrence({
      clientId: task.clientId,
      stage: task.stage,
      title: task.title,
      assignee: task.assignee,
      recurring: task.recurring!,
      recurringDay: task.recurringDay,
    });
    created++;
  }

  return created;
}

// ---------------------------------------------------------------------------
// 11. deleteTask — delete a task (cascade handles subtasks)
// ---------------------------------------------------------------------------

/**
 * Delete a client task by ID. Cascade delete handles subtasks.
 *
 * @param taskId - ClientTask ID
 * @throws If task not found
 */
export async function deleteTask(taskId: string): Promise<void> {
  const existing = await prisma.clientTask.findUnique({
    where: { id: taskId },
    select: { id: true },
  });

  if (!existing) {
    throw new Error(`Task not found: '${taskId}'`);
  }

  await prisma.clientTask.delete({ where: { id: taskId } });
}
