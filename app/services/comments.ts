import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { db } from "../db/db";
import { calendarEvents, comments, kanbanTasks, notes } from "../db/schema";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EntityType = "note" | "task" | "event";

export type CommentRow = typeof comments.$inferSelect;

export interface PendingCommentWithEntity {
  comment: CommentRow;
  entityTitle: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertEntityExists(entityType: string, entityId: string): void {
  let exists = false;

  switch (entityType) {
    case "note": {
      const row = db
        .select({ id: notes.id })
        .from(notes)
        .where(eq(notes.id, entityId))
        .get();
      exists = !!row;
      break;
    }
    case "task": {
      const row = db
        .select({ id: kanbanTasks.id })
        .from(kanbanTasks)
        .where(eq(kanbanTasks.id, entityId))
        .get();
      exists = !!row;
      break;
    }
    case "event": {
      const row = db
        .select({ id: calendarEvents.id })
        .from(calendarEvents)
        .where(eq(calendarEvents.id, entityId))
        .get();
      exists = !!row;
      break;
    }
  }

  if (!exists) {
    throw new Error(`Entity not found: ${entityType} ${entityId}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new comment with status="pending" and expires_at = now + 7 days.
 *
 * @throws if the referenced entity does not exist.
 */
export function createComment(
  entityType: EntityType,
  entityId: string,
  content: string,
): CommentRow {
  assertEntityExists(entityType, entityId);

  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  db.insert(comments)
    .values({
      id,
      entityType,
      entityId,
      content,
      status: "pending",
      createdAt: timestamp,
      expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
    })
    .run();

  return db.select().from(comments).where(eq(comments.id, id)).get()!;
}

/** List all comments for an entity, ordered by creation time. */
export function getComments(
  entityType: EntityType,
  entityId: string,
): CommentRow[] {
  return db
    .select()
    .from(comments)
    .where(
      and(
        eq(comments.entityType, entityType),
        eq(comments.entityId, entityId),
      ),
    )
    .orderBy(asc(comments.createdAt))
    .all();
}

/**
 * Mark a pending comment as processed.
 * Returns the updated comment, or `undefined` if the comment does not exist.
 */
export function markProcessed(id: string): CommentRow | undefined {
  const existing = db
    .select()
    .from(comments)
    .where(eq(comments.id, id))
    .get();

  if (!existing) return undefined;

  db.update(comments)
    .set({ status: "processed" })
    .where(eq(comments.id, id))
    .run();

  return db.select().from(comments).where(eq(comments.id, id)).get()!;
}

/**
 * Delete a comment by id.
 * Returns `true` if a comment was deleted, `false` if it did not exist.
 */
export function deleteComment(id: string): boolean {
  const existing = db
    .select({ id: comments.id })
    .from(comments)
    .where(eq(comments.id, id))
    .get();

  if (!existing) return false;

  db.delete(comments).where(eq(comments.id, id)).run();
  return true;
}

/**
 * Return all non-expired pending comments with their parent entity title.
 *
 * Only comments whose `expires_at` is in the future are returned.
 * This is a passive TTL — expired comments remain in the database but are
 * filtered out of this query.
 */
export function getPendingComments(): PendingCommentWithEntity[] {
  const now = new Date().toISOString();

  const pending = db
    .select()
    .from(comments)
    .where(
      and(
        eq(comments.status, "pending"),
        gt(comments.expiresAt, now),
      ),
    )
    .orderBy(asc(comments.createdAt))
    .all();

  if (pending.length === 0) return [];

  // Collect entity IDs per type for batch lookups
  const noteIds: string[] = [];
  const taskIds: string[] = [];
  const eventIds: string[] = [];

  for (const c of pending) {
    if (c.entityType === "note") {
      noteIds.push(c.entityId);
    } else if (c.entityType === "task") {
      taskIds.push(c.entityId);
    } else if (c.entityType === "event") {
      eventIds.push(c.entityId);
    }
  }

  // Batch-fetch entity titles
  const titleByEntityId = new Map<string, string>();

  if (noteIds.length > 0) {
    const rows = db
      .select({ id: notes.id, title: notes.title })
      .from(notes)
      .where(inArray(notes.id, noteIds))
      .all();
    for (const row of rows) {
      titleByEntityId.set(row.id, row.title);
    }
  }

  if (taskIds.length > 0) {
    const rows = db
      .select({ id: kanbanTasks.id, title: kanbanTasks.title })
      .from(kanbanTasks)
      .where(inArray(kanbanTasks.id, taskIds))
      .all();
    for (const row of rows) {
      titleByEntityId.set(row.id, row.title);
    }
  }

  if (eventIds.length > 0) {
    const rows = db
      .select({ id: calendarEvents.id, title: calendarEvents.title })
      .from(calendarEvents)
      .where(inArray(calendarEvents.id, eventIds))
      .all();
    for (const row of rows) {
      titleByEntityId.set(row.id, row.title);
    }
  }

  return pending.map((comment) => ({
    comment,
    entityTitle: titleByEntityId.get(comment.entityId) ?? null,
  }));
}
