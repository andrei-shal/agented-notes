import { sql, count, eq, desc } from "drizzle-orm";
import { db } from "../db/db";
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
// Types
// ---------------------------------------------------------------------------

export interface Stats {
  total_notes: number;
  total_tasks: number;
  tasks_by_column: Array<{
    column_id: string;
    column_name: string | null;
    count: number;
  }>;
  total_events: number;
  comments: Array<{
    status: string;
    count: number;
  }>;
  total_tags: number;
}

export interface TagFrequency {
  name: string;
  count: number;
}

export interface ActivityEntry {
  date: string;
  notes_created: number;
  tasks_created: number;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Return global aggregate statistics across all entity types.
 */
export function getStats(): Stats {
  const totalNotes =
    db.select({ count: count() }).from(notes).get()?.count ?? 0;

  const totalTasks =
    db.select({ count: count() }).from(kanbanTasks).get()?.count ?? 0;

  const tasksByColumn = db
    .select({
      column_id: kanbanTasks.columnId,
      column_name: kanbanColumns.name,
      count: count(),
    })
    .from(kanbanTasks)
    .leftJoin(kanbanColumns, eq(kanbanTasks.columnId, kanbanColumns.id))
    .groupBy(kanbanTasks.columnId)
    .all();

  const totalEvents =
    db.select({ count: count() }).from(calendarEvents).get()?.count ?? 0;

  const commentsByStatus = db
    .select({
      status: comments.status,
      count: count(),
    })
    .from(comments)
    .groupBy(comments.status)
    .all();

  const totalTags =
    db.select({ count: count() }).from(tags).get()?.count ?? 0;

  return {
    total_notes: totalNotes,
    total_tasks: totalTasks,
    tasks_by_column: tasksByColumn,
    total_events: totalEvents,
    comments: commentsByStatus,
    total_tags: totalTags,
  };
}

/**
 * Return all tags sorted by usage frequency (most used first).
 */
export function getTags(): TagFrequency[] {
  return db
    .select({
      name: tags.name,
      count: count(notesToTags.noteId),
    })
    .from(tags)
    .leftJoin(notesToTags, eq(tags.id, notesToTags.tagId))
    .groupBy(tags.id, tags.name)
    .orderBy(desc(count(notesToTags.noteId)))
    .all();
}

/**
 * Return daily creation activity (notes + tasks) for the last 30 days.
 *
 * Days with zero activity for both types are not included in the result.
 */
export function getActivity(): ActivityEntry[] {
  // Notes created per day (last 30 days)
  const notesActivity = db
    .select({
      date: sql<string>`substr(${notes.createdAt}, 1, 10)`,
      created: count(),
    })
    .from(notes)
    .where(sql`${notes.createdAt} >= datetime('now', '-30 days')`)
    .groupBy(sql`substr(${notes.createdAt}, 1, 10)`)
    .orderBy(sql`substr(${notes.createdAt}, 1, 10)`)
    .all();

  // Tasks created per day (last 30 days)
  const tasksActivity = db
    .select({
      date: sql<string>`substr(${kanbanTasks.createdAt}, 1, 10)`,
      created: count(),
    })
    .from(kanbanTasks)
    .where(sql`${kanbanTasks.createdAt} >= datetime('now', '-30 days')`)
    .groupBy(sql`substr(${kanbanTasks.createdAt}, 1, 10)`)
    .orderBy(sql`substr(${kanbanTasks.createdAt}, 1, 10)`)
    .all();

  // Merge into a single map keyed by date
  const activityMap = new Map<
    string,
    { notes_created: number; tasks_created: number }
  >();

  for (const row of notesActivity) {
    activityMap.set(row.date, {
      notes_created: row.created,
      tasks_created: 0,
    });
  }

  for (const row of tasksActivity) {
    const existing = activityMap.get(row.date);
    if (existing) {
      existing.tasks_created = row.created;
    } else {
      activityMap.set(row.date, {
        notes_created: 0,
        tasks_created: row.created,
      });
    }
  }

  return Array.from(activityMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));
}
