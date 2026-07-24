/**
 * Notes service tests.
 *
 * Uses a temporary SQLite database with full schema + FTS5 applied.
 * Sets DATABASE_PATH before importing the service module so `db`
 * reads from the test database.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";

// ── Test database ───────────────────────────────────────────────────────────

const TEST_DIR = mkdtempSync(join(tmpdir(), "agented-notes-svc-test-"));
const DB_PATH = join(TEST_DIR, "test.db");

process.env["DATABASE_PATH"] = DB_PATH;

// Create, migrate, and FTS5-setup the test database
{
  const sqlite = new Database(DB_PATH, { create: true });
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const migrationDir = join(import.meta.dir, "../../drizzle");
  const files = Array.from(
    new Bun.Glob("*.sql").scanSync({ cwd: migrationDir }),
  ).sort();
  for (const file of files) {
    const content = readFileSync(join(migrationDir, file), "utf-8");
    for (const stmt of content.split("--> statement-breakpoint\n")) {
      const trimmed = stmt.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }

  // FTS5 setup (matches app/db/fts5.ts)
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(content);
    CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
      DELETE FROM notes_fts WHERE rowid = old.rowid;
    END;
    CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
      REPLACE INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);
  sqlite.close();
}

function cleanup(): void {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("NotesService", () => {
  let svc: typeof import("../../services/notes");
  let dbMod: typeof import("../../db/db");
  let schema: typeof import("../../db/schema");

  beforeAll(async () => {
    svc = await import("../../services/notes");
    dbMod = await import("../../db/db");
    schema = await import("../../db/schema");
  });

  afterAll(() => {
    cleanup();
  });

  // ── createNote ────────────────────────────────────────────────────

  test("createNote inserts a note and returns it with tags", () => {
    const note = svc.createNote(
      "Test Note",
      "This is a #test note with #hashtags",
    );

    expect(note.id).toBeDefined();
    expect(note.title).toBe("Test Note");
    expect(note.content).toBe("This is a #test note with #hashtags");
    expect(note.createdAt).toBeDefined();
    expect(note.updatedAt).toBeDefined();
    expect(note.tags).toEqual(expect.arrayContaining(["test", "hashtags"]));
    expect(note.tags).toHaveLength(2);
  });

  test("createNote creates a note without hashtags", () => {
    const note = svc.createNote("Plain", "No tags here");
    expect(note.tags).toEqual([]);
  });

  // ── getNote ───────────────────────────────────────────────────────

  test("getNote returns null for non-existent id", () => {
    expect(svc.getNote("non-existent-id")).toBeNull();
  });

  test("getNote returns a note with its tags and comments", () => {
    const created = svc.createNote("Get Test", "#cool note content");
    const found = svc.getNote(created.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.title).toBe("Get Test");
    expect(found!.tags).toEqual(["cool"]);
    expect(found!.comments).toEqual([]);
  });

  // ── listNotes ─────────────────────────────────────────────────────

  test("listNotes returns all notes with pagination", () => {
    svc.createNote("List A", "#alpha");
    svc.createNote("List B", "#beta");
    svc.createNote("List C", "#gamma");

    const result = svc.listNotes({});
    expect(result.total).toBeGreaterThanOrEqual(3);
    expect(result.notes.length).toBeGreaterThanOrEqual(3);
  });

  test("listNotes filters by tag", () => {
    svc.createNote("Tag Filter Test", "#tagfilter");
    const result = svc.listNotes({ tag: "tagfilter" });
    expect(result.total).toBeGreaterThanOrEqual(1);
    for (const note of result.notes) {
      expect(note.tags).toContain("tagfilter");
    }
  });

  test("listNotes filters by search (FTS5)", () => {
    svc.createNote("Search Test", "unique_search_text_ftw");
    const result = svc.listNotes({ search: "search_text_ftw" });
    expect(result.total).toBeGreaterThanOrEqual(1);
    for (const note of result.notes) {
      expect(note.content.toLowerCase()).toContain("search_text_ftw");
    }
  });

  test("listNotes respects limit and offset", () => {
    const all = svc.listNotes({});
    const limited = svc.listNotes({ limit: 2, offset: 0 });

    expect(limited.notes.length).toBeLessThanOrEqual(2);
    expect(limited.total).toBe(all.total);
    expect(limited.notes[0]!.id).toBe(all.notes[0]!.id);
  });

  test("listNotes returns empty array for offset beyond total", () => {
    const result = svc.listNotes({ offset: 9999 });
    expect(result.notes).toEqual([]);
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  // ── updateNote ────────────────────────────────────────────────────

  test("updateNote updates title and content", () => {
    const note = svc.createNote("Before", "original content");
    const updated = svc.updateNote(note.id, {
      title: "After",
      content: "updated content",
    });

    expect(updated.title).toBe("After");
    expect(updated.content).toBe("updated content");
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(note.createdAt).getTime(),
    );
  });

  test("updateNote re-parses hashtags", () => {
    const note = svc.createNote("Tags Old", "#oldtag content");
    expect(note.tags).toEqual(["oldtag"]);

    const updated = svc.updateNote(note.id, {
      content: "#newtag content",
    });

    expect(updated.tags).toEqual(["newtag"]);
  });

  test("updateNote throws NotFoundError for non-existent id", () => {
    expect(() => svc.updateNote("no-such-id", { title: "x" })).toThrow(
      svc.NotFoundError,
    );
  });

  // ── deleteNote ────────────────────────────────────────────────────

  test("deleteNote removes a note", () => {
    const note = svc.createNote("Delete Me", "bye");
    svc.deleteNote(note.id);
    expect(svc.getNote(note.id)).toBeNull();
  });

  test("deleteNote removes associated comments", () => {
    const note = svc.createNote("Comment Note", "test");
    const commentId = crypto.randomUUID();

    dbMod.db.insert(schema.comments)
      .values({
        id: commentId,
        entityType: "note",
        entityId: note.id,
        content: "A comment",
      })
      .run();

    svc.deleteNote(note.id);

    const remaining = dbMod.db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.id, commentId))
      .all();
    expect(remaining).toEqual([]);
  });

  test("deleteNote cleans up unused tags", () => {
    const note = svc.createNote("Tag Cleanup", "#lonelytag");
    expect(note.tags).toContain("lonelytag");

    svc.deleteNote(note.id);

    const tagRows = dbMod.db
      .select()
      .from(schema.tags)
      .where(eq(schema.tags.name, "lonelytag"))
      .all();
    expect(tagRows).toEqual([]);
  });

  test("deleteNote throws NotFoundError for non-existent id", () => {
    expect(() => svc.deleteNote("no-such-id")).toThrow(svc.NotFoundError);
  });
});
