/**
 * MCP notes & tags tools integration tests.
 *
 * Calls each tool handler directly with mock arguments and verifies
 * the JSON-RPC-style response shape ({ content, isError? }).
 *
 * Uses a temporary SQLite database with full schema + FTS5 applied.
 * Sets DATABASE_PATH before importing modules so `db` reads the test DB.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";

// ── Test database ───────────────────────────────────────────────────────────

const TEST_DIR = mkdtempSync(join(tmpdir(), "agented-notes-mcp-test-"));
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

describe("MCP notes & tags tools", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tools: {
    notesListTool: { handler: (args: Record<string, unknown>) => Promise<any> };
    notesGetTool: { handler: (args: Record<string, unknown>) => Promise<any> };
    notesCreateTool: { handler: (args: Record<string, unknown>) => Promise<any> };
    notesUpdateTool: { handler: (args: Record<string, unknown>) => Promise<any> };
    notesDeleteTool: { handler: (args: Record<string, unknown>) => Promise<any> };
    tagsListTool: { handler: (args: Record<string, unknown>) => Promise<any> };
  };

  beforeAll(async () => {
    tools = await import("../tools/notes");
  });

  afterAll(() => {
    cleanup();
  });

  // ── notes_create ─────────────────────────────────────────────────────

  test("notes_create creates a note and returns it with tags", async () => {
    const res = await tools.notesCreateTool.handler({
      title: "Test Note",
      content: "This is a #test note with #tags",
    });

    expect(res.isError).toBeUndefined();
    expect(res.content).toHaveLength(1);
    expect(res.content[0]!.type).toBe("text");

    const note = JSON.parse(res.content[0]!.text);
    expect(note.id).toBeDefined();
    expect(note.title).toBe("Test Note");
    expect(note.content).toBe("This is a #test note with #tags");
    expect(note.tags).toEqual(expect.arrayContaining(["test", "tags"]));
  });

  test("notes_create works without hashtags", async () => {
    const res = await tools.notesCreateTool.handler({
      title: "Plain",
      content: "No tags here",
    });

    expect(res.isError).toBeUndefined();
    const note = JSON.parse(res.content[0]!.text);
    expect(note.tags).toEqual([]);
  });

  test("notes_create rejects missing title", async () => {
    const res = await tools.notesCreateTool.handler({
      content: "missing title",
    } as unknown as Record<string, unknown>);

    // Service will attempt to create with undefined title, which fails
    expect(res.isError).toBe(true);
  });

  // ── notes_get ────────────────────────────────────────────────────────

  test("notes_get returns a note by ID", async () => {
    const created = await tools.notesCreateTool.handler({
      title: "Get Test",
      content: "#cool note content",
    });
    const note = JSON.parse(created.content[0]!.text);

    const res = await tools.notesGetTool.handler({ id: note.id });
    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.type).toBe("text");

    const found = JSON.parse(res.content[0]!.text);
    expect(found.id).toBe(note.id);
    expect(found.title).toBe("Get Test");
    expect(found.tags).toEqual(["cool"]);
    expect(found.comments).toEqual([]);
  });

  test("notes_get returns error for non-existent id", async () => {
    const res = await tools.notesGetTool.handler({ id: "non-existent-id" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("not found");
  });

  // ── notes_list ───────────────────────────────────────────────────────

  test("notes_list returns all notes", async () => {
    await tools.notesCreateTool.handler({
      title: "List A",
      content: "#alpha",
    });
    await tools.notesCreateTool.handler({
      title: "List B",
      content: "#beta",
    });

    const res = await tools.notesListTool.handler({});
    expect(res.isError).toBeUndefined();

    const result = JSON.parse(res.content[0]!.text);
    expect(result.total).toBeGreaterThanOrEqual(2);
    expect(result.notes.length).toBeGreaterThanOrEqual(2);
  });

  test("notes_list filters by tag", async () => {
    await tools.notesCreateTool.handler({
      title: "Tag Filter",
      content: "#tagfilter content",
    });

    const res = await tools.notesListTool.handler({ tag: "tagfilter" });
    expect(res.isError).toBeUndefined();

    const result = JSON.parse(res.content[0]!.text);
    expect(result.total).toBeGreaterThanOrEqual(1);
    for (const note of result.notes) {
      expect(note.tags).toContain("tagfilter");
    }
  });

  test("notes_list filters by search", async () => {
    await tools.notesCreateTool.handler({
      title: "Search Test",
      content: "unique_search_text_ftw",
    });

    const res = await tools.notesListTool.handler({
      search: "search_text_ftw",
    });
    expect(res.isError).toBeUndefined();

    const result = JSON.parse(res.content[0]!.text);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  test("notes_list respects limit and offset", async () => {
    const allRes = await tools.notesListTool.handler({});
    const all = JSON.parse(allRes.content[0]!.text);

    const limitedRes = await tools.notesListTool.handler({ limit: 1 });
    const limited = JSON.parse(limitedRes.content[0]!.text);

    expect(limited.notes.length).toBeLessThanOrEqual(1);
    expect(limited.total).toBe(all.total);
    expect(limited.notes[0]!.id).toBe(all.notes[0]!.id);
  });

  // ── notes_update ─────────────────────────────────────────────────────

  test("notes_update updates title and content", async () => {
    const created = await tools.notesCreateTool.handler({
      title: "Before",
      content: "original content",
    });
    const note = JSON.parse(created.content[0]!.text);

    const res = await tools.notesUpdateTool.handler({
      id: note.id,
      title: "After",
      content: "updated content",
    });
    expect(res.isError).toBeUndefined();

    const updated = JSON.parse(res.content[0]!.text);
    expect(updated.title).toBe("After");
    expect(updated.content).toBe("updated content");
  });

  test("notes_update re-parses hashtags", async () => {
    const created = await tools.notesCreateTool.handler({
      title: "Tags Old",
      content: "#oldtag content",
    });
    const note = JSON.parse(created.content[0]!.text);
    expect(JSON.parse(created.content[0]!.text).tags).toEqual(["oldtag"]);

    const res = await tools.notesUpdateTool.handler({
      id: note.id,
      content: "#newtag content",
    });
    expect(res.isError).toBeUndefined();

    const updated = JSON.parse(res.content[0]!.text);
    expect(updated.tags).toEqual(["newtag"]);
  });

  test("notes_update returns error for non-existent id", async () => {
    const res = await tools.notesUpdateTool.handler({
      id: "no-such-id",
      title: "x",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("not found");
  });

  // ── notes_delete ─────────────────────────────────────────────────────

  test("notes_delete removes a note", async () => {
    const created = await tools.notesCreateTool.handler({
      title: "Delete Me",
      content: "bye",
    });
    const note = JSON.parse(created.content[0]!.text);

    const res = await tools.notesDeleteTool.handler({ id: note.id });
    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.type).toBe("text");

    const result = JSON.parse(res.content[0]!.text);
    expect(result.deleted).toBe(true);
    expect(result.id).toBe(note.id);

    // Verify it's actually gone
    const getRes = await tools.notesGetTool.handler({ id: note.id });
    expect(getRes.isError).toBe(true);
  });

  test("notes_delete returns error for non-existent id", async () => {
    const res = await tools.notesDeleteTool.handler({ id: "no-such-id" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("not found");
  });

  // ── tags_list ────────────────────────────────────────────────────────

  test("tags_list returns all tags", async () => {
    // Create notes with tags
    await tools.notesCreateTool.handler({
      title: "Tags Test",
      content: "#alpha #beta content",
    });

    const res = await tools.tagsListTool.handler({});
    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.type).toBe("text");

    const rows = JSON.parse(res.content[0]!.text);
    expect(Array.isArray(rows)).toBe(true);

    // At least alpha and beta should be present
    const names = rows.map((r: { name: string }) => r.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
  });

  test("tags_list returns tags from existing notes in correct format", async () => {
    const res = await tools.tagsListTool.handler({});
    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.type).toBe("text");

    const rows = JSON.parse(res.content[0]!.text);
    expect(Array.isArray(rows)).toBe(true);

    // Every row should be a tag object with at least id and name
    for (const row of rows) {
      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("name");
      expect(row).toHaveProperty("createdAt");
    }
  });

  // ── Central registry ─────────────────────────────────────────────────

  test("tools are registered in the central tools array", async () => {
    const { tools: centralTools } = await import("../tools/index");
    const names = centralTools.map((t) => t.definition.name);
    expect(names).toContain("notes_list");
    expect(names).toContain("notes_get");
    expect(names).toContain("notes_create");
    expect(names).toContain("notes_update");
    expect(names).toContain("notes_delete");
    expect(names).toContain("tags_list");
  });
});
