import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./db/schema";

const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA foreign_keys = ON;");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS kanban_boards (
    id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    description text,
    created_at text
  );
  CREATE TABLE IF NOT EXISTS kanban_columns (
    id text PRIMARY KEY NOT NULL,
    board_id text NOT NULL,
    name text NOT NULL,
    position integer DEFAULT 0 NOT NULL,
    color text,
    created_at text,
    FOREIGN KEY (board_id) REFERENCES kanban_boards(id)
  );
  CREATE TABLE IF NOT EXISTS kanban_tasks (
    id text PRIMARY KEY NOT NULL,
    column_id text NOT NULL,
    title text NOT NULL,
    description text,
    position integer DEFAULT 0 NOT NULL,
    due_date text,
    tags text DEFAULT '[]',
    created_at text,
    updated_at text,
    FOREIGN KEY (column_id) REFERENCES kanban_columns(id)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(title, description);
  CREATE TRIGGER IF NOT EXISTS tasks_fts_ai AFTER INSERT ON kanban_tasks BEGIN
    INSERT INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
  END;
`);
const db = drizzle(sqlite, { schema });

// Normal insert via Drizzle
const boardId = crypto.randomUUID();
db.insert(schema.kanbanBoards).values({ id: boardId, name: "Board" }).run();
const colId = crypto.randomUUID();
db.insert(schema.kanbanColumns).values({ id: colId, boardId, name: "Column", position: 0 }).run();
const taskId = crypto.randomUUID();
db.insert(schema.kanbanTasks).values({ id: taskId, columnId: colId, title: "unique_task_title_xyz", description: "desc" }).run();

// Check FTS5 via raw SQL
const found = (sqlite as any).query("SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'unique_task_title_xyz'").all();
console.log("FTS5 found via raw SQL:", JSON.stringify(found));

// Check FTS5 via db.$client
const dbClient = db.$client;
const found2 = dbClient.query("SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH 'unique_task_title_xyz'").all();
console.log("FTS5 found via db.$client:", JSON.stringify(found2));
