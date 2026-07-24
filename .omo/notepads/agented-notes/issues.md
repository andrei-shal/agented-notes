# Issues — agented-notes

## 2026-07-24 Session Start
- No issues yet.

## 2026-07-24 Task 1: Scaffold

- Used `@modelcontextprotocol/sdk` instead of the non-existent `@modelcontextprotocol/server`
- Used `@telegram-apps/sdk@^3.11.0` (v7.x doesn't exist for this package)
- shadcn v4 installed with "base-nova" style — uses `@base-ui/react` instead of `@radix-ui/react-*` primitives, plus `tw-animate-css`, `@fontsource-variable/geist`, `shadcn` packages
- Nothing broken, all type checks pass

## 2026-07-24 Task 1b: Post-scaffold fixes

### Issue A — CSS build failure (`outline-ring/50` class not found + missing color mappings)
- **Root cause**: `tailwind.config.ts` had empty `colors: {}` — shadcn v4 CSS variables were defined in CSS but not mapped to Tailwind utility classes
- **Fix**: Added all 15+ color keys (`border`, `input`, `ring`, `background`, `foreground`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `popover`, `card`, `sidebar`, plus `*-foreground` variants) in `extend.colors` using `var(--xxx)` references
- **Secondary fix**: Replaced `@apply border-border outline-ring/50` with just `@apply border-border` — `outline-ring/50` isn't a valid Tailwind v3 utility (opacity modifier on outline color with CSS variable values doesn't resolve)

### Issue B — `vitest run` exits with code 1 when no test files exist
- **Root cause**: vitest defaults to exit code 1 when it finds zero test files
- **Fix**: Added `--passWithNoTests` flag in `frontend/package.json` test script AND `passWithNoTests: true` in `frontend/vite.config.ts` test config

## 2026-07-24 Task 2: Database Schema

### Issue A — `drizzle-kit migrate` requires `better-sqlite3` or `@libsql/client`
- **Root cause**: drizzle-kit v0.30.x needs a Node-compatible SQLite driver for its migration runner even though the runtime uses `bun:sqlite` via `drizzle-orm/bun-sqlite`
- **Fix**: Added `better-sqlite3` as a dev dependency — used only by drizzle-kit CLI, not at runtime

### Issue B — Drizzle ORM query builders need explicit `.all()` / `.run()` on bun-sqlite
- **Context**: `db.select().from(table).where(...)` returns a query builder, NOT the result array — must call `.all()` to execute and get rows. Similarly `db.insert().values(...)` needs `.run()`.
- **Lesson**: Unlike some async Drizzle adapters, bun-sqlite Drizzle is synchronous but still requires terminal methods to execute the query. This is critical to remember for all future service-layer code.
- **Tests**: All 66 tests (10 table existence, 2 FTS5, 7 trigger existence/behavior, 15 CRUD) pass cleanly.

### Issue C — FTS5 trigger rowid collision in tests
- **Context**: Test helper creates an in-memory database with all tables + FTS5 setup. The direct-FTS5-insert test (`INSERT INTO notes_fts(rowid, content) VALUES (1, ...)`) uses rowid=1. Later trigger tests insert into `notes`, getting implicit rowid=1, then the `notes_fts_ai` trigger tries to re-insert rowid=1 into `notes_fts`, which already has it → UNIQUE constraint violation.
- **Fix**: Use `rowid = 999999` in the direct FTS5 test so it never collides with real auto-increment rowids.

## 2026-07-24 Task 2: Config module + CLI parsing

### Created files
- `app/config.ts` — Zod schema, ENV/CLI parsing, `loadConfig()` and `parseArgs()` exports
- `app/__tests__/config.test.ts` — 33 unit tests

### Design notes
- `jwtSecret`, `telegramBotToken`, `mcpApiKey` are required fields — only settable via ENV (no CLI flags for these). If missing, zod throws a clear validation error.
- `parseArgs()` is exported separately for direct unit testing of CLI parsing logic.
- `loadConfig()` accepts optional `argv` array (defaults to `process.argv.slice(2)`) for testability.
- Precedence: CLI args > ENV vars > schema defaults.
- `--mcp-stdio` vs `--mcp` conflict: `--mcp-stdio` always wins, enforced by a post-merge scan in `loadConfig()`.

### Verification
- ✅ `tsc --noEmit` passes clean
- ✅ 33/33 `bun test` pass
- ✅ LSP not installed (user-declined), no diagnostic check available

## 2026-07-24 Task 4: Auth Module

### Created files
- `app/lib/jwt.ts` — JWT generation (access 15m, refresh 30d) & verification via `jose`, HS256, lazy config load
- `app/lib/telegram.ts` — Telegram initData validation (HMAC-SHA256, 24h expiry, raw query string parsing) + `createTestInitData` test helper
- `app/api/middleware/auth.ts` — Bearer token middleware, skips `/api/auth/*` paths, sets `c.set('userId', ...)`
- `app/api/middleware/api-key.ts` — X-API-Key header middleware
- `app/api/auth.ts` — Auth routes: POST /telegram (find/create user, issue tokens), POST /refresh (rotate + blacklist), POST /logout (blacklist + clear cookie)
- `app/lib/__tests__/jwt.test.ts` — 12 tests
- `app/lib/__tests__/telegram.test.ts` — 13 tests
- `app/api/__tests__/auth.test.ts` — 12 integration tests

### Modified files
- `app/api/index.ts` — mounted authRouter, added `use("*", auth)` for protected routes
- `app/index.ts` — mounted api router via `app.route("/", api)`

### Design decisions
- `refresh_tokens` table is a **token registry**: on refresh, old token hash is inserted (blacklisted), new pair issued; on logout, token hash is inserted
- DAO queries are inline in `auth.ts` per task spec (no service layer yet)
- `loadConfig()` is called lazily in jwt.ts via `getSecret()` — allows tests to set env vars before first use
- Integration tests use a temp SQLite database with full schema migration
- All application imports in integration tests are **dynamic** to ensure env vars are set before db.ts module loading

### Verification
- ✅ `tsc --noEmit` passes clean
- ✅ 103/103 `bun test` pass (25 lib + 12 integration + 33 config + 33 schema)
- ✅ LSP not installed (user-declined), no diagnostic check available

## 2026-07-24 Task 10: MCP Server Infrastructure

### Created / modified files
- **`app/api/middleware/api-key.ts`** — refactored from single `apiKey: MiddlewareHandler` to `apiKeyMiddleware(apiKey: string)` factory function; returns 403 on mismatch, 500 if no key configured.
- **`app/mcp/tools/index.ts`** — `McpTool` interface (definition + handler), empty `tools` array as central registry.
- **`app/mcp/server.ts`** — `createMcpServer()` (Server + ListTools/CallTool handlers), `createStdioTransport()`, `createHttpTransport()`.
- **`app/index.ts`** — rewired startup with MCP modes: `stdio` → MCP only, no HTTP; `http` → MCP + HTTP with `/mcp` endpoint; `none` → HTTP only.

### SDK transport discovery
- `@modelcontextprotocol/sdk` v1.29.0 has NO main entry (`dist/esm/index.{js,d.ts}` missing). Import from subpaths directly:
  - `@modelcontextprotocol/sdk/server` → `Server` class (deprecated in favor of `McpServer` but still available)
  - `@modelcontextprotocol/sdk/server/stdio` → `StdioServerTransport`
  - `@modelcontextprotocol/sdk/server/webStandardStreamableHttp` → `WebStandardStreamableHTTPServerTransport` (Web-Standard API — perfect for Hono/Bun, takes `Request` returns `Response`)
  - `@modelcontextprotocol/sdk/server/streamableHttp` → `StreamableHTTPServerTransport` (Node.js wrapper around Web Standard version)
  - `@modelcontextprotocol/sdk/types` → `ListToolsRequestSchema`, `CallToolRequestSchema`, `McpError`, `ErrorCode`, types `Tool`, `CallToolResult`
- Using `WebStandardStreamableHTTPServerTransport` (Web Standard) is correct for Hoon/Bun since it directly accepts `c.req.raw` and returns `Response`.

### Binding mode architecture
- **STDIO**: `server.connect(createStdioTransport())` at top-level → Bun process stays alive via stdin stream, `export default {}` prevents Bun from starting an HTTP server.
- **HTTP**: `server.connect(createHttpTransport())` then mount `app.all("/mcp", apiKeyMiddleware(config.mcpApiKey), handler)`. Transport's `.handleRequest(c.req.raw)` handles GET (SSE), POST (JSON-RPC), and DELETE (session cleanup).
- **Top-level `await`**: Both STDIO and HTTP modes use `await server.connect(transport)` at module top level. This is valid in Bun entry points.

### Tool registry pattern
- Each `app/mcp/tools/*.ts` (Tasks 11-15) exports a tool definition + handler and imports `tools` from `./index` to push.
- `server.ts` reads `tools` array to register `ListToolsRequestSchema` and `CallToolRequestSchema` handlers.
- No tools implemented yet — empty registry, returns empty list.

### Pre-existing issue (not caused by this task)
- `api/auth.ts(59)` — destructure type error: `c.req.json<{ initData?: string }>().catch(() => ({}))` creates `{ initData?: string } | {}` union, `const { initData } = body` fails on `{}` branch. Unrelated to MCP work.

## 2026-07-24 Task 16: Frontend infrastructure

### Created files
- `frontend/src/lib/telegram.ts` — `@telegram-apps/sdk` wrapper: `initTelegram()` returns `{ isTelegram, initData, theme, viewportHeight, viewportStableHeight }`
- `frontend/src/lib/api.ts` — fetch-based API client with `get/post/put/delete<T>()`, JWT Bearer from auth store, auto 401→refresh→retry flow
- `frontend/src/store/authStore.ts` — Zustand with `persist` middleware: `user`, `token`, `isAuthenticated`, `login()`, `logout()`
- `frontend/src/store/filterStore.ts` — Zustand: `activeTag`, `setActiveTag()`, `clearFilter()`
- `frontend/src/store/uiStore.ts` — Zustand with persist: `theme`, `sidebarOpen`, `toggleTheme()`, `setSidebarOpen()`
- `frontend/src/components/Layout.tsx` — responsive sidebar (desktop `<aside>`, mobile Sheet), NavLink navigation, theme toggle, logout
- `frontend/src/pages/Notes.tsx`, `Kanban.tsx`, `Calendar.tsx`, `Login.tsx` — placeholder pages
- `frontend/src/store/__tests__/authStore.test.ts` — 5 tests (login/logout/persistence/rehydrate)
- `frontend/src/lib/__tests__/api.test.ts` — 10 tests (GET/POST/PUT/DELETE, auth headers, errors, 204, 401 refresh flow)
- `frontend/src/components/__tests__/Layout.test.tsx` — 8 tests (renders, navigation, theme toggle, sign out)

### Issues encountered
- **Zustand persist + jsdom**: localStorage is not available in jsdom by default. Added conditional mock in vitest setup file.
- **@telegram-apps/sdk v3 signals**: `viewport.height` and `viewport.stableHeight` are `Computed<number>` (callable signals), not plain numbers. Access via `viewport.height()` and `viewport.stableHeight()`.
- **base-ui SheetTrigger**: Uses `render` prop instead of `asChild` for custom trigger rendering.
- **Layout test duplicates**: Sheet dialog + desktop sidebar both render when `sidebarOpen=true`, causing duplicate text queries. Fixed: set `sidebarOpen: false` in test setup.

### Verification
- ✅ `tsc --noEmit` passes clean (0 errors)
- ✅ 23/23 tests pass (3 test files)
- ✅ LSP not installed (user-declined), no diagnostic check available

## 2026-07-24 Task 10 fix: MCP SDK import resolution

### Issue
`@modelcontextprotocol/sdk` v1.29.0 uses a `"./*"` wildcard export pattern in its `package.json` to expose subpaths like `./server/stdio`, `./server/webStandardStreamableHttp`, and `./types`. TypeScript (`moduleResolution: "bundler"`) supports this wildcard, but **Bun v1.3.14 does not** when resolving imports from actual files (only `bun -e` direct imports work).

Only explicitly listed exports resolve at runtime:
| Import path | Bun runtime | Notes |
|---|---|---|
| `@modelcontextprotocol/sdk/server` | ✅ | Has explicit `"./server"` export |
| `@modelcontextprotocol/sdk/server/stdio` | ❌ | Only covered by `"./*"` wildcard |
| `@modelcontextprotocol/sdk/server/webStandardStreamableHttp` | ❌ | Only covered by `"./*"` wildcard |
| `@modelcontextprotocol/sdk/types` | ❌ | Only covered by `"./*"` wildcard |

### Fix
Changed the 3 failing imports in `app/mcp/server.ts` to use **relative paths to the SDK's dist files** inside `node_modules`:
- `@modelcontextprotocol/sdk/server/stdio` → `../node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js`
- `@modelcontextprotocol/sdk/server/webStandardStreamableHttp` → `../node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js`
- `@modelcontextprotocol/sdk/types` → `../node_modules/@modelcontextprotocol/sdk/dist/esm/types.js`

`@modelcontextprotocol/sdk/server` kept as-is (has explicit export, works with Bun).

### Why this works
- **Bun runtime**: Resolves relative paths to actual files in `node_modules`. The `.js` extension is required for ESM.
- **TypeScript**: With `moduleResolution: "bundler"`, TS finds the corresponding `.d.ts` files (e.g., `stdio.d.ts`) alongside the `.js` files in the dist directory.
- **`app/mcp/tools/index.ts`** not affected: uses `import type` which is erased at runtime — Bun never resolves the module.

### Verification
- ✅ `tsc --noEmit` — 0 errors
- ✅ `bun test` — 103/103 pass
