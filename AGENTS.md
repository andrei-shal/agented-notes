# agented-notes — Agent Rules

## Project Overview

AI-augmented note-taking application with Kanban boards, calendar events, full-text search,
comments, and Telegram bot integration. Exposes functionality via HTTP API and MCP (Model Context Protocol).

## Tech Stack

| Layer          | Stack |
|----------------|-------|
| Runtime        | Bun 1.3+ |
| Language       | TypeScript (strict mode) — ESNext target, ESM modules |
| Backend        | Hono — fast HTTP framework |
| Database       | SQLite via `bun:sqlite` + Drizzle ORM |
| Frontend       | React 19 + shadcn/ui + Tailwind CSS |
| MCP            | Model Context Protocol — stdio + HTTP transports |
| Auth           | JWT via `jose` |
| Testing        | Bun test runner (`bun test`) |
| Container      | Docker multi-stage (build + Alpine runtime), GHCR via GitHub Actions |

## Project Structure

```
agented-notes/
├── app/                  # Backend (Hono API, DB, MCP server)
│   ├── api/             # HTTP route handlers
│   │   ├── middleware/  # Auth, CORS, rate-limit, validation
│   │   ├── __tests__/   # API integration tests
│   │   ├── auth.ts      # Auth routes (login, register, refresh)
│   │   ├── notes.ts     # Notes CRUD routes
│   │   ├── kanban.ts    # Kanban board routes
│   │   ├── events.ts    # Calendar events routes
│   │   ├── comments.ts  # Comments routes
│   │   ├── search.ts    # Full-text search route
│   │   ├── analytics.ts # Analytics routes
│   │   └── index.ts     # Route registry
│   ├── db/              # Database schema, migrations, FTS5 setup
│   │   ├── schema.ts    # Drizzle ORM schema (all 10 tables)
│   │   ├── db.ts        # Database connection
│   │   ├── fts5.ts      # Full-text search setup (FTS5 virtual tables)
│   │   └── __tests__/   # Schema tests
│   ├── lib/             # Shared utilities
│   │   ├── jwt.ts       # JWT sign/verify (jose)
│   │   ├── hashtags.ts  # Hashtag parsing from text
│   │   ├── errors.ts    # Error classes
│   │   ├── telegram.ts  # Telegram bot API client
│   │   └── __tests__/   # Lib tests
│   ├── services/        # Business logic
│   │   ├── notes.ts     # Note CRUD + tag management
│   │   ├── kanban.ts    # Board/column/task operations
│   │   ├── events.ts    # Calendar event CRUD
│   │   ├── comments.ts  # Comments CRUD + expiration
│   │   ├── search.ts    # FTS5 search logic
│   │   ├── analytics.ts # Stats and analytics
│   │   └── __tests__/   # Service tests
│   ├── mcp/             # MCP server definitions + tools
│   │   ├── server.ts    # MCP server setup
│   │   ├── tools/       # MCP tool implementations
│   │   │   ├── index.ts # Tool registry
│   │   │   ├── notes.ts
│   │   │   ├── todos.ts
│   │   │   ├── events.ts
│   │   │   ├── comments.ts
│   │   │   ├── search.ts
│   │   │   └── analytics.ts
│   │   └── __tests__/   # MCP tool tests
│   ├── index.ts         # Entry point
│   ├── config.ts        # Environment config
│   └── test/setup.ts    # Test setup (DB seeding, cleanup)
├── frontend/            # React SPA (Vite + shadcn + Tailwind)
│   └── src/             # Components, pages, stores
├── data/                # SQLite database (git-ignored)
├── .github/
│   └── workflows/
│       └── docker.yml   # GHCR build & push (master / tags)
└── Dockerfile           # Multi-stage Docker build
```

## Database Schema (10 tables)

1. **users** — User accounts (Telegram-linked or standalone)
2. **notes** — Rich-text notes with title + content
3. **kanban_boards** — Kanban board containers
4. **kanban_columns** — Columns within boards
5. **kanban_tasks** — Tasks within columns (with due dates, tags)
6. **calendar_events** — Calendar events (supports RRULE, reminders)
7. **comments** — Polymorphic comments on any entity (status: pending/approved/rejected, optional expiry)
8. **tags** — Global tag registry with colors
9. **refresh_tokens** — JWT refresh token store (hashed)
10. **notes_to_tags** — Many-to-many junction: notes ↔ tags

Naming: `snake_case` for columns, `camelCase` for JS identifiers.
IDs: UUID v4 via `crypto.randomUUID()`.
Timestamps: ISO 8601 strings (not Unix timestamps).

## Code Conventions

### TypeScript

- Strict mode: all `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`,
  `forceConsistentCasingInFileNames`, `isolatedModules`, `verbatimModuleSyntax` enabled.
- `verbatimModuleSyntax` — use `import type` for type-only imports.
- All exports at module level (no default exports unless required by framework).
- Use `const` over `let`; avoid `var` entirely.

### Formatting & Structure

- 2-space indentation.
- Semicolons required.
- File header comment blocks use `// ── section ──` style.
- Maximum line length: 100 characters.
- One class/interface per file (small helpers may be co-located).
- Test files: `__tests__/` directory next to source, named `{module}.test.ts`.
- Use `and`, `or` rather than `&&`, `||` in SQL-like Drizzle queries.

### Database Access Pattern

```
api/ (HTTP handler) → services/ (business logic) → db/ via Drizzle ORM
```

- No raw SQL outside `fts5.ts` (FTS5 virtual tables require raw SQL for MATCH).
- All DB access goes through Drizzle query builder.
- `services/` modules throw typed errors (`NotFoundError`, `ValidationError`);
  middleware in `api/middleware/` catches and formats HTTP responses.

### API Design

- Prefix: `/api/v1/`.
- Standard HTTP: GET (read), POST (create), PUT (full update), PATCH (partial), DELETE.
- JSON request/response bodies. Errors: `{ error: string, message: string, status: number }`.
- Auth: JWT Bearer token in `Authorization` header. Refresh via `/api/v1/auth/refresh`.
- MCP API key via `Authorization: Bearer <key>` header for MCP HTTP transport.

### MCP Tools

- Each tool file exports an array of tool definitions compatible with the MCP SDK.
- Tool names: `notes_create`, `notes_list`, `notes_get`, `notes_update`, `notes_delete`,
  `todos_list`, `todos_create`, `todos_update`, `todos_delete`,
  `events_list`, `events_create`, `events_update`, `events_delete`,
  `search_notes`, `comments_list`, `comments_create`, `comments_delete`,
  `analytics_summary`.
- Tools validate inputs via Zod schemas.
- Registry in `tools/index.ts` aggregates all tools.

### Testing

- Test runner: `bun test`.
- Test files: `*.test.ts` co-located in `__tests__/` directories.
- Before each test suite: run `test/setup.ts` which creates a fresh in-memory SQLite database.
- Use `describe`/`it`/`expect` from Bun's built-in test API.
- Factories/hardcoded test data in `db/__tests__/helpers.ts`.

## Agent Rules

1. **Read before write** — Always read existing files before modifying them. Understand the current structure before making changes.

2. **Follow the architecture** — API → Service → DB layering must be maintained. Do not call Drizzle directly from API route handlers.

3. **Type safety** — Use `import type` for type-only imports. Do not use `as any` or `as unknown as T` casts. If a type is genuinely unknown, prefer proper discriminated unions.

4. **Error handling** — Throw typed errors from services (see `app/lib/errors.ts`). HTTP handlers convert via middleware. Always handle error cases in tests.

5. **Test alongside code** — Add or update tests when changing any module in `app/`. Follow existing test patterns for setup/teardown.

6. **No hardcoded secrets** — All configuration lives in environment variables, read through `app/config.ts`.

7. **MCP and API parity** — When adding a feature, add it to both the HTTP API and MCP tools unless explicitly scoped to one.

8. **Database migrations** — Schema changes in `app/db/schema.ts` must be accompanied by corresponding SQL migration files. Run `bun run --cwd app db:migrate` to apply.

9. **Frontend conventions** — React 19 with hooks. Components in `src/components/`, pages in `src/pages/`. Use Tailwind utility classes; avoid inline styles. Follow shadcn/ui patterns for component structure.

10. **Commits** — Atomic commits with conventional commit messages (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`). One logical change per commit.

11. **CI/CD** — Docker-связанные изменения (Dockerfile, entrypoint, workflow) требуют проверки `.github/workflows/docker.yml` на актуальность.

## Useful Commands

```bash
bun install          # Install dependencies
bun run dev          # Start API + frontend in watch mode
bun run check        # Type-check both workspaces
bun run --cwd app test     # Run backend tests
bun run --cwd app db:migrate   # Apply database migrations
bun run --cwd app start       # Start API server (HTTP)
bun run --cwd app start -- --mcp-stdio  # MCP stdio mode
bun run --cwd app start -- --mcp        # MCP HTTP mode
docker compose up -d              # Pull & run from GHCR
docker compose up --build -d      # Build locally instead
docker pull ghcr.io/andrei-shal/agented-notes:latest  # Pull pre-built image from GHCR
```

## Configuration (`.env`)

| Variable              | Required | Description |
|-----------------------|----------|-------------|
| `JWT_SECRET`          | Yes      | JWT signing key (≥16 chars) |
| `TELEGRAM_BOT_TOKEN`  | Yes      | Telegram bot API token |
| `MCP_API_KEY`         | Yes      | API key for MCP HTTP transport |
| `DATABASE_PATH`       | No       | SQLite path (default: `./data/notes.db`) |
| `PORT`                | No       | HTTP port (default: 3000) |

## Architecture Decisions

- **SQLite + Drizzle ORM**: No external database server needed. Drizzle provides type-safe queries.
  FTS5 enables full-text search without Elasticsearch.
- **Polymorphic comments**: `comments.entity_type` + `comments.entity_id` pattern allows
  any entity to have comments without separate join tables.
- **MCP dual transport**: Stdio for desktop AI clients (Claude Desktop), HTTP for web-based clients.
- **Tags via junction table**: `notes_to_tags` enables many-to-many relationships.
  Tags are created on first use (upsert pattern in `notes.ts`).
- **Kanban position as integer**: Column and task ordering uses sequential integers;
  reordering updates all positions in the affected set.
- **Single-user design**: The application is designed for personal use by one
  person. There is no row-level isolation by userId — all entities are shared.
  Telegram auth acts as an access gate, not a multi-tenancy mechanism.
  To convert to multi-user: add `user_id FK` to notes, kanban_boards,
  calendar_events, and filter all service queries by it.
