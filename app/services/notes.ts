import { db } from "../db/db";
import { notes, tags, notesToTags, comments } from "../db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { parseHashtags } from "../lib/hashtags";

// ── Types ───────────────────────────────────────────────────────────────────

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface NoteListFilters {
  tag?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface NoteListResult {
  notes: Note[];
  total: number;
}

export interface NoteComment {
  id: string;
  content: string;
  status: string;
  createdAt: string;
}

export interface NoteWithComments extends Note {
  comments: NoteComment[];
}

// ── Error ───────────────────────────────────────────────────────────────────

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

// ── Internal helpers ────────────────────────────────────────────────────────

function loadTags(noteId: string): string[] {
  return db
    .select({ name: tags.name })
    .from(notesToTags)
    .innerJoin(tags, eq(notesToTags.tagId, tags.id))
    .where(eq(notesToTags.noteId, noteId))
    .all()
    .map((r) => r.name);
}

function ensureTags(
  tx: Pick<typeof db, "insert" | "select">,
  noteId: string,
  content: string,
): void {
  const tagNames = parseHashtags(content);
  for (const name of tagNames) {
    tx.insert(tags).values({ name }).onConflictDoNothing().run();
    const [tag] = tx
      .select({ id: tags.id })
      .from(tags)
      .where(eq(tags.name, name))
      .all();
    if (tag) {
      tx.insert(notesToTags)
        .values({ noteId, tagId: tag.id })
        .onConflictDoNothing()
        .run();
    }
  }
}

function hydrateNote(row: typeof notes.$inferSelect): Note {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.createdAt!,
    updatedAt: row.updatedAt!,
    tags: loadTags(row.id),
  };
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function createNote(title: string, content: string): Note {
  const noteId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.transaction((tx) => {
    tx.insert(notes)
      .values({ id: noteId, title, content, createdAt: now, updatedAt: now })
      .run();
    ensureTags(tx, noteId, content);
  });

  return hydrateNote(
    db.select().from(notes).where(eq(notes.id, noteId)).get()!,
  );
}

export function getNote(id: string): NoteWithComments | null {
  const row = db.select().from(notes).where(eq(notes.id, id)).get();
  if (!row) return null;

  const noteTags = loadTags(id);

  const commentRows = db
    .select({
      id: comments.id,
      content: comments.content,
      status: comments.status,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .where(and(eq(comments.entityType, "note"), eq(comments.entityId, id)))
    .all();

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.createdAt!,
    updatedAt: row.updatedAt!,
    tags: noteTags,
    comments: commentRows.map((c) => ({
      id: c.id,
      content: c.content,
      status: c.status,
      createdAt: c.createdAt!,
    })),
  };
}

export function listNotes(filters: NoteListFilters): NoteListResult {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);

  let allIds: string[];

  if (filters.tag && filters.search) {
    const rows = db.all<{ noteId: string }>(
      sql`
        SELECT DISTINCT n.id AS noteId
        FROM notes n
        INNER JOIN notes_to_tags ntt ON n.id = ntt.note_id
        INNER JOIN tags t ON ntt.tag_id = t.id
        INNER JOIN notes_fts fts ON n.rowid = fts.rowid
        WHERE t.name = ${filters.tag}
          AND fts.content MATCH ${filters.search}
        ORDER BY n.created_at DESC
      `,
    );
    allIds = rows.map((r) => r.noteId);
  } else if (filters.tag) {
    const rows = db.all<{ noteId: string }>(
      sql`
        SELECT DISTINCT n.id AS noteId
        FROM notes n
        INNER JOIN notes_to_tags ntt ON n.id = ntt.note_id
        INNER JOIN tags t ON ntt.tag_id = t.id
        WHERE t.name = ${filters.tag}
        ORDER BY n.created_at DESC
      `,
    );
    allIds = rows.map((r) => r.noteId);
  } else if (filters.search) {
    const rows = db.all<{ noteId: string }>(
      sql`
        SELECT DISTINCT n.id AS noteId
        FROM notes n
        INNER JOIN notes_fts fts ON n.rowid = fts.rowid
        WHERE fts.content MATCH ${filters.search}
        ORDER BY n.created_at DESC
      `,
    );
    allIds = rows.map((r) => r.noteId);
  } else {
    const rows = db.all<{ id: string }>(
      sql`SELECT id FROM notes ORDER BY created_at DESC`,
    );
    allIds = rows.map((r) => r.id);
  }

  const total = allIds.length;
  const pageIds = allIds.slice(offset, offset + limit);

  if (pageIds.length === 0) {
    return { notes: [], total };
  }

  const noteRows = db
    .select()
    .from(notes)
    .where(inArray(notes.id, pageIds))
    .all();
  const noteMap = new Map(noteRows.map((r) => [r.id, r]));

  const tagLinks = db
    .select({ noteId: notesToTags.noteId, name: tags.name })
    .from(notesToTags)
    .innerJoin(tags, eq(notesToTags.tagId, tags.id))
    .where(inArray(notesToTags.noteId, pageIds))
    .all();

  const tagMap = new Map<string, string[]>();
  for (const link of tagLinks) {
    const existing = tagMap.get(link.noteId) ?? [];
    existing.push(link.name);
    tagMap.set(link.noteId, existing);
  }

  const result: Note[] = pageIds.map((id) => {
    const row = noteMap.get(id)!;
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      createdAt: row.createdAt!,
      updatedAt: row.updatedAt!,
      tags: tagMap.get(id) ?? [],
    };
  });

  return { notes: result, total };
}

export function updateNote(
  id: string,
  data: { title?: string; content?: string },
): Note {
  const existing = db
    .select()
    .from(notes)
    .where(eq(notes.id, id))
    .get();
  if (!existing) {
    throw new NotFoundError("Note", id);
  }

  const now = new Date().toISOString();
  const updatedTitle = data.title ?? existing.title;
  const updatedContent = data.content ?? existing.content;

  db.transaction((tx) => {
    tx.update(notes)
      .set({ title: updatedTitle, content: updatedContent, updatedAt: now })
      .where(eq(notes.id, id))
      .run();
    tx.delete(notesToTags).where(eq(notesToTags.noteId, id)).run();
    ensureTags(tx, id, updatedContent);
    tx.delete(tags).where(
      sql`id NOT IN (SELECT tag_id FROM notes_to_tags)`,
    ).run();
  });

  return hydrateNote(
    db.select().from(notes).where(eq(notes.id, id)).get()!,
  );
}

export function deleteNote(id: string): void {
  const existing = db
    .select()
    .from(notes)
    .where(eq(notes.id, id))
    .get();
  if (!existing) {
    throw new NotFoundError("Note", id);
  }

  db.transaction((tx) => {
    tx.delete(comments)
      .where(and(eq(comments.entityType, "note"), eq(comments.entityId, id)))
      .run();
    tx.delete(notesToTags).where(eq(notesToTags.noteId, id)).run();
    tx.delete(notes).where(eq(notes.id, id)).run();
    tx.delete(tags).where(
      sql`id NOT IN (SELECT tag_id FROM notes_to_tags)`,
    ).run();
  });
}
