import { Hono } from "hono";
import { sql, count, eq, desc } from "drizzle-orm";
import { getDb } from "../db/db";
import {
  notes,
  kanbanTasks,
  kanbanColumns,
  calendarEvents,
  comments,
  tags,
  notesToTags,
} from "../db/schema";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const analyticsRouter = new Hono();

// ── GET /api/analytics/stats ────────────────────────────────────────────

analyticsRouter.get("/stats", async (c) => {
  const totalNotes = getDb().select({ count: count() }).from(notes).get()?.count ?? 0;

  const totalTasks = getDb().select({ count: count() }).from(kanbanTasks).get()?.count ?? 0;

  const tasksByColumn = getDb()
    .select({
      column_id: kanbanTasks.columnId,
      column_name: kanbanColumns.name,
      count: count(),
    })
    .from(kanbanTasks)
    .leftJoin(kanbanColumns, eq(kanbanTasks.columnId, kanbanColumns.id))
    .groupBy(kanbanTasks.columnId)
    .all();

  const totalEvents = getDb().select({ count: count() }).from(calendarEvents).get()?.count ?? 0;

  const commentsByStatus = getDb()
    .select({
      status: comments.status,
      count: count(),
    })
    .from(comments)
    .groupBy(comments.status)
    .all();

  const totalTags = getDb().select({ count: count() }).from(tags).get()?.count ?? 0;

  return c.json({
    total_notes: totalNotes,
    total_tasks: totalTasks,
    tasks_by_column: tasksByColumn,
    total_events: totalEvents,
    comments: commentsByStatus,
    total_tags: totalTags,
  });
});

// ── GET /api/analytics/tags ─────────────────────────────────────────────

analyticsRouter.get("/tags", async (c) => {
  const tagFrequencies = getDb()
    .select({
      name: tags.name,
      count: count(notesToTags.noteId),
    })
    .from(tags)
    .leftJoin(notesToTags, eq(tags.id, notesToTags.tagId))
    .groupBy(tags.id, tags.name)
    .orderBy(desc(count(notesToTags.noteId)))
    .all();

  return c.json({ tags: tagFrequencies });
});

// ── GET /api/analytics/activity ─────────────────────────────────────────

analyticsRouter.get("/activity", async (c) => {
  // Notes created per day (last 30 days)
  const notesActivity = getDb()
    .select({
      date: sql<string>`substr(${notes.createdAt}, 1, 10)`,
      created: count(),
    })
    .from(notes)
    .where(
      sql`${notes.createdAt} >= datetime('now', '-30 days')`,
    )
    .groupBy(sql`substr(${notes.createdAt}, 1, 10)`)
    .orderBy(sql`substr(${notes.createdAt}, 1, 10)`)
    .all();

  // Tasks created per day (last 30 days)
  const tasksActivity = getDb()
    .select({
      date: sql<string>`substr(${kanbanTasks.createdAt}, 1, 10)`,
      created: count(),
    })
    .from(kanbanTasks)
    .where(
      sql`${kanbanTasks.createdAt} >= datetime('now', '-30 days')`,
    )
    .groupBy(sql`substr(${kanbanTasks.createdAt}, 1, 10)`)
    .orderBy(sql`substr(${kanbanTasks.createdAt}, 1, 10)`)
    .all();

  // Merge into a single array keyed by date
  const activityMap = new Map<string, { notes_created: number; tasks_created: number }>();

  for (const row of notesActivity) {
    activityMap.set(row.date, { notes_created: row.created, tasks_created: 0 });
  }

  for (const row of tasksActivity) {
    const existing = activityMap.get(row.date);
    if (existing) {
      existing.tasks_created = row.created;
    } else {
      activityMap.set(row.date, { notes_created: 0, tasks_created: row.created });
    }
  }

  const activity = Array.from(activityMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));

  return c.json({ activity });
});
