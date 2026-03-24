import { prisma } from "@/lib/db";
import { TasksOverviewTable } from "@/components/tasks/tasks-overview-table";

export const metadata = {
  title: "Tasks | Outsignal",
};

export default async function TasksPage() {
  const tasks = await prisma.clientTask.findMany({
    include: {
      client: { select: { id: true, name: true } },
      subtasks: { select: { id: true, status: true } },
    },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { status: "asc" }],
  });

  // Serialize dates for client component
  const serialized = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    stage: t.stage,
    status: t.status,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    notes: t.notes,
    client: t.client,
    subtasks: t.subtasks.map((s) => ({ id: s.id, status: s.status })),
  }));

  return <TasksOverviewTable tasks={serialized} />;
}
