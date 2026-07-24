import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";

// ── АРХИТЕКТУРНОЕ ПРИМЕЧАНИЕ ──────────────────────────────────────
// Это single-user приложение. Таблицы не содержат user_id намеренно.
// Telegram-аутентификация защищает доступ к API, но не изолирует данные.
// Для multi-user потребуется добавить user_id во все основные таблицы.
// ──────────────────────────────────────────────────────────────────

// ── Helper: UUID v4 via crypto ──────────────────────────────────────
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// ── 1. users ────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: text("id").$defaultFn(uuid).primaryKey(),
  telegramId: integer("telegram_id").unique(),
  username: text("username"),
  createdAt: text("created_at").$defaultFn(now),
});

// ── 2. notes ────────────────────────────────────────────────────────
export const notes = sqliteTable("notes", {
  id: text("id").$defaultFn(uuid).primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  createdAt: text("created_at").$defaultFn(now),
  updatedAt: text("updated_at").$defaultFn(now),
});

// ── 3. kanban_boards ────────────────────────────────────────────────
export const kanbanBoards = sqliteTable("kanban_boards", {
  id: text("id").$defaultFn(uuid).primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: text("created_at").$defaultFn(now),
});

// ── 4. kanban_columns ───────────────────────────────────────────────
export const kanbanColumns = sqliteTable("kanban_columns", {
  id: text("id").$defaultFn(uuid).primaryKey(),
  boardId: text("board_id").notNull().references(() => kanbanBoards.id),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  color: text("color"),
  createdAt: text("created_at").$defaultFn(now),
});

// ── 5. kanban_tasks ─────────────────────────────────────────────────
export const kanbanTasks = sqliteTable("kanban_tasks", {
  id: text("id").$defaultFn(uuid).primaryKey(),
  columnId: text("column_id").notNull().references(() => kanbanColumns.id),
  title: text("title").notNull(),
  description: text("description"),
  position: integer("position").notNull().default(0),
  dueDate: text("due_date"),
  tags: text("tags").default("[]"),
  createdAt: text("created_at").$defaultFn(now),
  updatedAt: text("updated_at").$defaultFn(now),
});

// ── 6. calendar_events ──────────────────────────────────────────────
export const calendarEvents = sqliteTable("calendar_events", {
  id: text("id").$defaultFn(uuid).primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  allDay: integer("all_day").default(0),
  rrule: text("rrule"),
  reminderMinutes: integer("reminder_minutes"),
  color: text("color"),
  createdAt: text("created_at").$defaultFn(now),
});

// ── 7. comments ─────────────────────────────────────────────────────
export const comments = sqliteTable("comments", {
  id: text("id").$defaultFn(uuid).primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").$defaultFn(now),
  expiresAt: text("expires_at"),
});

// ── 8. tags ─────────────────────────────────────────────────────────
export const tags = sqliteTable("tags", {
  id: text("id").$defaultFn(uuid).primaryKey(),
  name: text("name").unique().notNull(),
  color: text("color"),
  createdAt: text("created_at").$defaultFn(now),
});

// ── 9. refresh_tokens ───────────────────────────────────────────────
export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    id: text("id").$defaultFn(uuid).primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id").references(() => users.id),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").$defaultFn(now),
  },
  (table) => ({
    hashIdx: index("idx_refresh_tokens_hash").on(table.tokenHash),
    expiresAtIdx: index("idx_refresh_tokens_expires").on(table.expiresAt),
  }),
);

// ── 10. notes_to_tags (junction) ────────────────────────────────────
export const notesToTags = sqliteTable(
  "notes_to_tags",
  {
    noteId: text("note_id")
      .notNull()
      .references(() => notes.id),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.noteId, table.tagId] }),
  }),
);
