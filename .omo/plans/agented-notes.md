# agented-notes - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->

**What you'll get:** Self-hosted веб-приложение для заметок с Markdown, хэштегами, Kanban-доской для задач и календарём с recurring событиями. Поддерживает вход через браузер (JWT) и Telegram Web App (через initData). Включает MCP сервер (STDIO и Streamable HTTP с API-ключом) — ИИ-агент (Claude Code, Codex CLI) подключается к нему и может читать/писать заметки, управлять задачами, обрабатывать комментарии.

**Why this approach:** Monolith на Bun — один язык (TS) для бэкенда и фронта, один рантайм, встроенный SQLite и test runner. Минимум зависимостей, максимальная простота деплоя (один Docker image). MCP SDK первой стороной даёт полноценный доступ агенту.

**What it will NOT do:** Не будет мультитенантности, встроенного AI/LLM, WebSocket, отдельной очереди сообщений, мобильного приложения (кроме Telegram Web App), S3 или облачных зависимостей.

**Effort:** XL (22 todos, 5 waves)
**Risk:** Medium — MCP SDK Streamable HTTP transport + Telegram Web Apps
**Decisions to sanity-check:** Drizzle schema design, MCP tool names, Kanban column model

Your next move: Approve этот план.

---

> TL;DR (machine): XL effort, Medium risk. Monolith Bun + React + Drizzle SQLite + MCP STDIO/Streamable HTTP. 5 waves, 22 todos.

## Scope
### Must have
- Backend API (Hono + Bun) с CRUD для notes, todos (Kanban), calendar events, comments, tags
- SQLite база через Drizzle ORM с миграциями
- Markdown-заметки с авто-парсингом #хэштегов
- Kanban-доски с кастомными колонками, drag-and-drop ordering
- Календарь с событиями, повторениями (RRULE), напоминаниями
- JWT авторизация для браузера (access + refresh токены)
- Telegram Web App авторизация через initData validation
- Комментарии к заметкам с lifecycle: pending → AI processes → auto-delete
- MCP сервер в двух режимах: STDIO (--mcp-stdio) и Streamable HTTP (--mcp --mcp-port 3100)
- MCP инструменты: CRUD всех сущностей, поиск, аналитика, pending-комментарии
- MCP Streamable HTTP защищён API-ключом (X-API-Key header)
- React 19 SPA (shadcn/ui, Tailwind) с Vite
- Dockerfile + docker-compose.yml
- Telegram Web App mini app совместимость (viewport, theme, back button)

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Мультитенантность / multi-user
- Регистрация и email/password (только Telegram + single admin user)
- WebSocket / real-time / SSE push клиенту (кроме MCP Streamable HTTP)
- Микросервисы / message queue
- S3 / blob storage / external file hosting
- Встроенный AI / LLM вызов
- Мобильное приложение (iOS/Android)
- OAuth / SSO / внешние identity provider-ы

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- **Test decision: tests-after**. Каждый todo включает написание тестов.
- **Backend**: Bun:test + `supertest` (HTTP integration тесты через Hono `app.fetch()`)
  - Unit тесты для каждого сервиса (`app/services/*.test.ts`)
  - Integration тесты для каждого API эндпоинта (`app/api/*.test.ts`)
  - MCP integration тесты (`app/mcp/tools/*.test.ts`) — JSON-RPC через STDIO buffer
- **Frontend**: Vitest + React Testing Library + `msw` (mock service worker для API)
  - Unit тесты для компонентов (`frontend/src/components/*.test.tsx`)
  - Integration тесты для страниц (`frontend/src/pages/*.test.ts`)
- **Coverage target**: ≥80% line coverage для сервисов, ≥60% для компонентов
- Evidence: .omo/evidence/agented-notes/

## Execution strategy
### Parallel execution waves
- **Wave 1 (Foundation)**: Проект, схема БД, конфиг, миграции — основа, без зависимостей
- **Wave 2 (Backend API)**: Все REST эндпоинты — зависит от Wave 1
- **Wave 3 (MCP Server)**: MCP инструменты — зависит от Wave 2 (те же бизнес-логики)
- **Wave 4 (Frontend)**: React SPA — зависит от Wave 2 (API), параллелен Wave 3
- **Wave 5 (DevOps + Polish)**: Docker, README, финальное QA — зависит от всех предыдущих

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1. Scaffold | — | 2,3,12 | — |
| 2. DB Schema | 1 | 3-11 | — |
| 3. Config/ENV/CLI | 1 | 4-11 | 2 |
| 4. Auth module | 2,3 | 5-11 | — |
| 5. Notes API (service layer) | 2,3,4 | 11,13,19 | 6,7,8,9 |
| 6. Todos/Kanban API (service layer) | 2,3,4 | 14,20 | 5,7,8,9 |
| 7. Events API (service layer) | 2,3,4 | 15,21 | 5,6,8,9 |
| 8. Comments API (service layer) | 2,3,4 | 16,19 | 5,6,7,9 |
| 9. Search + Analytics API | 2,3,4 | 11,17 | 5,6,7,8 |
| 10. MCP core (STDIO+HTTP) | 1 | 11-15 | 2,3 |
| 11. MCP notes+tags | 5,10 | 22 | 12,13,14,15 |
| 12. MCP todos | 6,10 | 22 | 11,13,14,15 |
| 13. MCP events | 7,10 | 22 | 11,12,14,15 |
| 14. MCP comments | 8,10 | 22 | 11,12,13,15 |
| 15. MCP search+analytics | 9,10 | 22 | 11,12,13,14 |
| 16. Frontend scaffold | 1 | 17-20 | 2,3,4 |
| 17. Notes page + Detail | 5,8,16 | 21 | 18,19,20 |
| 18. Kanban page | 6,16 | 21 | 17,19,20 |
| 19. Calendar page | 7,16 | 21 | 17,18,20 |
| 20. Auth pages (Login + TG) | 4,16 | — | 17,18,19 |
| 21. Docker + README | 11-15,17-20 | — | — |
| 22. Error handling + polish | 4-9 | — | 21 |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->

### Wave 1: Foundation

- [x] 1. **Scaffold project structure + package.json + tsconfig + test infra**
  What to do / Must NOT do:
  - Создать структуру директорий: `app/` (src), `frontend/` (React Vite SPA), `tests/`
  - `app/` — Bun + Hono + Drizzle + @modelcontextprotocol/server + jose + zod + node:crypto (built-in) + rrule
  - `app/package.json` scripts: `dev`, `start`, `db:generate`, `db:migrate`, `check: "tsc --noEmit"`, `test: "bun test"`
  - `frontend/` — React 19 + Vite + shadcn/ui (Tailwind) + react-router-dom + @telegram-apps/sdk + react-markdown + rehype-highlight + dnd-kit + @fullcalendar/react + @fullcalendar/daygrid + @fullcalendar/interaction + zustand
  - `frontend/package.json` scripts: `dev`, `build`, `test: "vitest"`, `check: "tsc --noEmit"`
  - Настроить Vitest + @testing-library/react + @testing-library/jest-dom + msw во frontend
  - Установить `supertest` (или Hono `app.fetch()` для integration тестов) в app
  - Root `package.json` с workspaces: `["app", "frontend"]`
  - `tsconfig.json` для Bun (strict mode)
  - `.env.example` со всеми переменными
  - `.gitignore`
  - Bun lockfile
  - Создать `app/test/setup.ts` — хелперы для тестов (createTestApp, testDb, mockUser)
  - Создать `frontend/src/test/setup.ts` — Vitest setup с testing-library matchers + msw server
  - Must NOT: никакой бизнес-логики, только каркас
  Parallelization: Wave 1 | Blocked by: — | Blocks: 2,3,10,16
  References: Bun docs (bun.sh), Hono docs (honojs.dev), Drizzle docs (orm.drizzle.team)
  Acceptance criteria: `bun install` без ошибок, `bun run --cwd app check` проходит, `bun run --cwd frontend test` проходит (пустой suite)
  QA scenarios:
    - happy: `bun install` → exit 0
    - happy: `bun run --cwd app check` → tsc clean
    - happy: `bun test --cwd app` → 0 tests, runner works
    - happy: `bun run --cwd frontend test` → vitest runs, 0 tests
    - failure: missing .env → приложение падает с понятной ошибкой
    Evidence: .omo/evidence/agented-notes/task-1-scaffold.log
  Commit: Y | feat(scaffold): initialize project workspace with Bun + Hono + React + Vite + test infra

- [x] 2. **Database schema (Drizzle ORM + SQLite + FTS5 + refresh_tokens)**
  What to do / Must NOT do:
  - Определить Drizzle schema для SQLite в `app/db/schema.ts`:
    - `users` — id (text/uuid), telegram_id (int?), username, created_at
    - `notes` — id, title, content (markdown), tags (computed from hashtags in content), created_at, updated_at
    - `kanban_boards` — id, name, description, created_at
    - `kanban_columns` — id, board_id (FK), name, position (int для сортировки), color, created_at
    - `kanban_tasks` — id, column_id (FK), title, description, position, due_date?, tags, created_at, updated_at
    - `calendar_events` — id, title, description, start_date, end_date, all_day, rrule?, reminder_minutes?, color?, created_at
    - `comments` — id, entity_type (text: note/task/event), entity_id, content, status (text: pending/processed), created_at, expires_at (created_at + 7 дней)
    - `tags` — id, name (unique), color?, created_at
    - `refresh_tokens` — id, token_hash (text), user_id (FK), expires_at, created_at (для blacklist при logout)
  - Через raw SQL в миграции создать FTS5 виртуальные таблицы:
    - `notes_fts(content TEXT)` — для полнотекстового поиска по заметкам
    - `tasks_fts(title TEXT, description TEXT)` — для поиска по задачам
    - Триггеры: после INSERT/UPDATE/DELETE на `notes` и `kanban_tasks` → синхронизация FTS5
  - Настроить Drizzle config (`drizzle.config.ts`) для SQLite
  - Создать `app/db/db.ts` — подключение к SQLite через `bun:sqlite` + Drizzle wrapper
  - Сгенерировать первую миграцию (create all tables + FTS5 + триггеры)
  - **Тесты**: `app/db/__tests__/schema.test.ts` — проверить что все таблицы создаются, FTS5 виртуальные таблицы существуют, триггеры работают (INSERT в notes → данные в notes_fts)
  - Must NOT: сырые SQL запросы для обычных таблиц (только Drizzle). FTS5 — исключение через raw SQL.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 4-9
  References: Drizzle SQLite docs, bun:sqlite docs
  Acceptance criteria: `bun run --cwd app db:generate` создаёт SQL миграцию, `bun run --cwd app db:migrate` создаёт SQLite файл с таблицами
  QA scenarios:
    - happy: drizzle-kit generate → .sql файл создан
    - happy: drizzle-kit migrate → notes.db появился
    - happy: `bun run --cwd app dev` → подключается к БД без ошибок
    - automated: `bun test --cwd app --db/schema.test.ts` → таблицы существуют, индексы созданы
    Evidence: .omo/evidence/agented-notes/task-2-schema.log
  Commit: Y | feat(db): add Drizzle schema for notes, kanban, events, comments, tags

- [x] 3. **Config module + CLI argument parsing**
  What to do / Must NOT do:
  - `app/config.ts`: загрузка конфигурации из ENV + CLI args (CLI args имеют приоритет)
  - Переменные ENV:
    - `PORT` (default 3000)
    - `JWT_SECRET` (обязательно)
    - `TELEGRAM_BOT_TOKEN` (обязательно для TG auth)
    - `MCP_API_KEY` (для SSE режима)
    - `DATABASE_PATH` (default `./data/notes.db`)
  - CLI args (парсить `process.argv`):
    - `--mcp-stdio` — запустить MCP в STDIO режиме (не HTTP, читает JSON-RPC из stdin)
    - `--mcp` — запустить MCP Streamable HTTP на Hono сервере
    - `--mcp-port` — порт для MCP Streamable HTTP (default 3100)
    - `--port` — порт HTTP сервера
  - Must NOT: сторонних CLI парсеров (yargs/commander), использовать только `process.argv`. Config должен валидироваться через zod.
  - **Тесты**: `app/__tests__/config.test.ts` — unit тесты парсинга CLI args и ENV, zod validation error cases
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 4-9
  References: Bun `process.argv`, Zod docs
  Acceptance criteria: `bun run app/index.ts --mcp-stdio` запускает MCP STDIO режим, `bun run app/index.ts` запускает HTTP сервер, `bun test --cwd app --config.test.ts` все тесты проходят
  QA scenarios:
    - happy: без аргументов → HTTP сервер на 3000
    - happy: `--mcp-stdio` → STDIO режим (нет HTTP)
    - happy: `--mcp` → HTTP + MCP на 3100
    - failure: нет `JWT_SECRET` → exit с ошибкой
    - automated: `bun test --cwd app` → тесты config.ts проходят
    Evidence: .omo/evidence/agented-notes/task-3-config.log
  Commit: Y | feat(config): add env + CLI arg config with zod validation

### Wave 2: Backend API

- [x] 4. **Auth module: JWT + Telegram initData + MCP API key**
  What to do / Must NOT do:
  - `app/lib/jwt.ts`: generateAccessToken(userId), generateRefreshToken(userId), verifyAccessToken(token), verifyRefreshToken(token) используя `jose`.
    - refresh token lifetime: 30 дней, access token: 15 минут
  - `app/lib/telegram.ts`: validateTelegramInitData(initData: string, botToken: string) — HMAC-SHA256 проверка подписи.
    - ВАЖНО: initData передаётся как RAW query string (не JSON), т.к. хеш считается над точной строкой запроса.
    - Проверять expiration: initData содержит `auth_date`, отклонять если старше 24 часов.
  - `app/api/auth.ts`:
    - `POST /api/auth/telegram` — принимает initData как raw string, валидирует, создаёт/находит пользователя по telegram_id, возвращает access token в JSON теле, refresh token через `Set-Cookie: refreshToken=<token>; HttpOnly; Secure; Path=/api/auth; SameSite=Strict`
    - `POST /api/auth/refresh` — читает refreshToken из Cookie, валидирует, возвращает новую пару (access в JSON, refresh в Set-Cookie)
    - `POST /api/auth/logout` — хеширует refreshToken (SHA256), сохраняет в `refresh_tokens` таблицу (blacklist), удаляет Cookie
  - Middleware: `app/api/middleware/auth.ts` — проверяет Authorization: Bearer <token>, достаёт userId в `c.set('userId')`
  - Middleware: `app/api/middleware/api-key.ts` — проверяет X-API-Key для MCP HTTP эндпоинта
  - `app/lib/__tests__/telegram.test.ts`: test helper `createTestInitData(botToken, data)` для генерации валидного initData в тестах
  - **Тесты**:
    - `app/lib/__tests__/jwt.test.ts` — unit тесты generate/verify token, expiration, invalid signature
    - `app/lib/__tests__/telegram.test.ts` — createTestInitData + validateTelegramInitData (valid, invalid hash, expired auth_date)
    - `app/api/__tests__/auth.test.ts` — integration тесты через Hono app.fetch(): /auth/telegram (valid initData → 200 + Set-Cookie), /auth/refresh, /auth/logout, /api/notes без токена → 401
  - Must NOT: сессии в памяти, только JWT. Refresh token всегда httpOnly cookie.
  Parallelization: Wave 2 | Blocked by: 2,3 | Blocks: 5-9,20
  References: jose docs (github.com/panva/jose), Telegram Web App initData docs
  Acceptance criteria: `bun test --cwd app` → все auth тесты проходят. curl POST /api/auth/telegram с валидным initData → 200 + Set-Cookie header.
  QA scenarios:
    - happy: Telegram initData validation через test helper
    - happy: access token → успешный запрос
    - happy: refresh token via cookie → новая пара
    - happy: logout → refresh token blacklisted
    - failure: просроченный access → 401
    - failure: невалидный initData → 401
    - failure: initData старше 24ч → 401
    - automated: `bun test --cwd app --auth/test.ts` → все кейсы
    Evidence: .omo/evidence/agented-notes/task-4-auth.log
  Commit: Y | feat(auth): add JWT auth, Telegram initData, httpOnly refresh cookie, API key middleware

- [x] 5. **Notes service + API (CRUD + Markdown + hashtags)**
  What to do / Must NOT do:
  - **Service layer** `app/services/notes.ts`:
    - `createNote(title, content)`, `getNote(id)`, `listNotes(filters)`, `updateNote(id, data)`, `deleteNote(id)`
    - Вся бизнес-логика: парсинг хэштегов, управление связями note↔tag, FTS5 синхронизация
  - **API layer** `app/api/notes.ts` (только валидация/zod + вызов сервиса + HTTP ответ):
    - `GET /api/notes` — список заметок (с пагинацией), поддержка `?tag=xxx` и `?search=xxx`
    - `GET /api/notes/:id` — одна заметка с комментариями
    - `POST /api/notes` — создать заметку (title, content). Авто-парсинг #хэштегов из content
    - `PUT /api/notes/:id` — обновить заметку. Перепарсить хэштеги
    - `DELETE /api/notes/:id` — удалить заметку (удалить связанные комментарии + теги, если они нигде не используются)
  - `app/lib/hashtags.ts`: функция parseHashtags(content: string): string[] — извлекает #word из текста
  - Notes имеют `tags` как computed field: при сохранении парсим content, сверяем с таблицей `tags`, создаём новые если не существуют
  - Must NOT: rich text / WYSIWYG на бэке. Markdown хранится как plain text. API хендлеры НЕ содержат бизнес-логику.
  - **Тесты**:
    - `app/lib/__tests__/hashtags.test.ts` — unit: parseHashtags("Hello #world") → ["world"], empty, special chars
    - `app/services/__tests__/notes.test.ts` — unit: createNote, getNote, listNotes, updateNote, deleteNote, hashtag sync, FTS5 sync
    - `app/api/__tests__/notes.test.ts` — integration через app.fetch(): CRUD, hashtag filter, search, 404
  Parallelization: Wave 2 | Blocked by: 2,3,4 | Blocks: 11,17
  References: Drizzle CRUD docs
  Acceptance criteria: `POST /api/notes` с content="Hello #world" → возвращает note с tags=["world"]. `bun test --cwd app --notes` → все тесты проходят.
  QA scenarios:
    - happy: create, read, update, delete
    - happy: hashtag parsing (#tag в начале, середине, конце)
    - happy: фильтрация по тегу
    - failure: update несуществующей заметки → 404
    - automated: `bun test --cwd app` → notes service + API тесты
    Evidence: .omo/evidence/agented-notes/task-5-notes.log
  Commit: Y | feat(notes): add notes CRUD API with Markdown and hashtag parsing

- [x] 6. **Kanban service + API (boards, columns, tasks)**
  What to do / Must NOT do:
  - **Service layer** `app/services/kanban.ts`: createBoard, getBoard, listBoards, createColumn, moveTask и т.д. — вся бизнес-логика
  - **API layer** `app/api/kanban.ts` (только валидация/zod + вызов сервиса):
    - Boards: `GET/POST/PUT/DELETE /api/kanban/boards`
    - Columns: `GET/POST/PUT/DELETE /api/kanban/boards/:boardId/columns`
    - Tasks: `GET/POST/PUT/DELETE /api/kanban/boards/:boardId/columns/:columnId/tasks`
    - `PATCH /api/kanban/tasks/:id/move` — переместить задачу в другую колонку + изменить position
    - Tasks поддерживают: title, description (markdown), due_date?, tags, position
    - Структура: Board → Column (position, name) → Task (position, column_id)
    - Начальные колонки для новой доски: "To Do", "In Progress", "Done"
  - Must NOT: drag-and-drop на бэке (только API для обновления position). Проверять что position уникален в рамках колонки.
  - **Тесты**:
    - `app/services/__tests__/kanban.test.ts` — unit: createBoard, createColumn, createTask, moveTask, reorder, validate position uniqueness
    - `app/api/__tests__/kanban.test.ts` — integration через app.fetch(): full CRUD, move, 404
  Parallelization: Wave 2 | Blocked by: 2,3,4 | Blocks: 12,18
  References: Drizzle CRUD, query ordering
  Acceptance criteria: Создать board → создать 3 колонки → создать task в колонке → move task в другую колонку. `bun test --cwd app --kanban` → все тесты проходят.
  QA scenarios:
    - happy: full CRUD board → column → task
    - happy: move task between columns
    - happy: reorder tasks (update position)
    - failure: move в несуществующую колонку → 404
    - automated: `bun test --cwd app` → kanban service + API
    Evidence: .omo/evidence/agented-notes/task-6-kanban.log
  Commit: Y | feat(kanban): add kanban boards API with columns and tasks

- [x] 7. **Events service + API (calendar with RRULE)**
  What to do / Must NOT do:
  - **Service layer** `app/services/events.ts`: createEvent, getEvent, listEvents(range), updateEvent, deleteEvent — вся бизнес-логика
  - **API layer** `app/api/events.ts` (только валидация/zod + вызов сервиса):
    - `GET /api/events?from=2025-01-01&to=2025-12-31` — список событий в диапазоне
    - `POST /api/events` — создать событие
    - `PUT /api/events/:id` — обновить
    - `DELETE /api/events/:id` — удалить
  - Поля события: id, title, description, start_date (ISO), end_date?, all_day (boolean), rrule? (строка RRULE), reminder_minutes? (сколько минут до напоминания), color?, created_at
  - На уровне API: при GET запросе с диапазоном, для событий с RRULE вычислять все вхождения в диапазоне и возвращать как flat список
  - Must NOT: превышать `max_occurrences: 365` для server-side RRULE expansion (защита от FREQ=DAILY на 5 лет → OOM)
  - Использовать `npm:rrule` для вычисления вхождений
  - Must NOT: сложный парсинг RRULE вручную. Reminder — просто поле, без отправки уведомлений (пока).
  - **Тесты**:
    - `app/services/__tests__/events.test.ts` — unit: createEvent, listEvents range, RRULE expansion, max_occurrences limit
    - `app/api/__tests__/events.test.ts` — integration: CRUD, RRULE date range, invalid rrule → 400
  Parallelization: Wave 2 | Blocked by: 2,3,4 | Blocks: 13,19
  References: rrule npm package docs, RFC 5545
  Acceptance criteria: Создать событие с RRULE "FREQ=WEEKLY;BYDAY=MO" → GET /api/events?from=2025-01-01&to=2025-01-31 → возвращает все понедельники в январе. `bun test --cwd app --events` → проходят.
  QA scenarios:
    - happy: create single event → read → update → delete
    - happy: recurring event with RRULE → returns occurrences in range
    - happy: event without end_date (end_date = start_date)
    - failure: invalid RRULE string → 400
    - automated: RRULE expansion limit, edge dates
    Evidence: .omo/evidence/agented-notes/task-7-events.log
  Commit: Y | feat(calendar): add calendar events API with RRULE support

- [x] 8. **Comments service + API (pending/processed lifecycle + TTL)**
  What to do / Must NOT do:
  - **Service layer** `app/services/comments.ts`: createComment, getComments, markProcessed, deleteComment, getPendingComments — вся логика
  - **API layer** `app/api/comments.ts` (только валидация + вызов сервиса):
    - `GET /api/notes/:noteId/comments` — список комментариев для заметки
    - `POST /api/notes/:noteId/comments` — создать комментарий (status: pending)
    - `PATCH /api/comments/:id/process` — отметить как processed (используется агентом)
    - `DELETE /api/comments/:id` — удалить комментарий
    - `GET /api/comments/pending` — получить все pending комментарии (для MCP агента)
  - entity_type/entity_id: комментарии могут быть к заметкам, задачам, событиям (полиморфная связь)
  - Комментарий содержит: id, entity_type, entity_id, content, status (pending/processed), created_at, expires_at (created_at + 7 дней)
  - TTL: `GET /api/comments/pending` не возвращает комментарии старше `expires_at` (orphaned cleanup без фонового процесса)
  - При создании комментария: если от пользователя (auth middleware), status=pending. Если от агента (API key middleware), status=processed.
  - Must NOT: auto-delete на уровне API (это делает агент через DELETE). Нет внешних триггеров/вебхуков.
  - **Тесты**:
    - `app/services/__tests__/comments.test.ts` — unit: createComment, markProcessed, getPending (фильтр TTL), deleteComment
    - `app/api/__tests__/comments.test.ts` — integration: CRUD, pending list, process, TTL фильтр
  Parallelization: Wave 2 | Blocked by: 2,3,4 | Blocks: 14,17
  References: Drizzle polymorphic relations
  Acceptance criteria: POST /api/notes/:id/comments → returns comment status=pending. `bun test --cwd app --comments` → проходят.
  QA scenarios:
    - happy: create comment on note → status=pending
    - happy: mark as processed → status=processed
    - happy: delete processed comment
    - happy: GET /api/comments/pending returns only pending
    - happy: TTL — expired comments excluded
    - failure: comment на несуществующую заметку → 404
    - automated: full pending lifecycle test
    Evidence: .omo/evidence/agented-notes/task-8-comments.log
  Commit: Y | feat(comments): add comments API with pending/processed lifecycle

- [x] 9. **Search + Analytics API**
  What to do / Must NOT do:
  - Поиск (`app/api/search.ts`):
    - `GET /api/search?q=xxx&type=notes|tasks|events` — полнотекстовый поиск
    - Использовать SQLite FTS5: создать виртуальную таблицу `notes_fts`, `tasks_fts`
    - При создании/обновлении заметки/задачи автоматически обновлять FTS индекс (триггеры или on-the-fly)
  - Аналитика (`app/api/analytics.ts`):
    - `GET /api/analytics/stats` — общая статистика: количество заметок, задач (по колонкам), событий, комментариев (pending/processed), тегов
    - `GET /api/analytics/tags` — тэги с частотой использования (сколько заметок с каждым тэгом)
    - `GET /api/analytics/activity` — активность по дням (сколько создано заметок/задач за последние 30 дней)
  - Must NOT: сложные data science / ML. Простая агрегация COUNT и GROUP BY.
  - **Тесты**:
    - `app/api/__tests__/search.test.ts` — integration: FTS5 search по notes и tasks, empty query, no results
    - `app/api/__tests__/analytics.test.ts` — integration: stats counts, tags frequency, activity by day
  Parallelization: Wave 2 | Blocked by: 2,3,4 | Blocks: 11,17
  References: SQLite FTS5 docs, Drizzle raw SQL
  Acceptance criteria: Создать заметку с текстом "hello world" → GET /api/search?q=hello → находит заметку. `bun test --cwd app --search` → проходят.
  QA scenarios:
    - happy: FTS5 search finds notes by content
    - happy: stats endpoint returns counts
    - happy: tags analytics
    - failure: empty query → 400 или пустой результат
    - automated: search + analytics тесты
    Evidence: .omo/evidence/agented-notes/task-9-search-analytics.log
  Commit: Y | feat(search): add FTS5 search and analytics API

### Wave 3: MCP Server

- [x] 10. **MCP core server (STDIO + Streamable HTTP)**
  What to do / Must NOT do:
  - Использовать `@modelcontextprotocol/server` v1.x (современный Streamable HTTP транспорт)
  - `app/mcp/server.ts`: создать MCP сервер, зарегистрировать инструменты
  - `app/mcp/transport.ts`:
    - **STDIO режим**: `StdioServerTransport` из `@modelcontextprotocol/server/stdio`
      - Читает JSON-RLC из stdin, пишет в stdout
      - Не запускает HTTP сервер
    - **Streamable HTTP режим**: через `@modelcontextprotocol/server/http` + `WebStandardStreamableHTTPServerTransport` (или `@modelcontextprotocol/hono` с `createMcpHonoApp()`)
      - Единый эндпоинт `POST /mcp` (без отдельных SSE и message endpoint)
      - Транспорт сам решает: простые запросы → JSON-RPC ответ, streaming → SSE
      - Эндпоинт защищён Hono middleware `apiKeyMiddleware` (X-API-Key)
  - В `app/index.ts`:
    - Если `--mcp-stdio`: запустить MCP сервер с STDIO транспортом, без HTTP (процесс жив, пока открыт stdin)
    - Если `--mcp`: смонтировать MCP роут `POST /mcp` на Hono сервер
    - Режимы можно комбинировать: `bun run app/index.ts --mcp --port 3000`
  - Регистрация всех инструментов: каждый файл `app/mcp/tools/*.ts` экспортирует список инструментов. `server.ts` собирает их через динамический импорт или явный registry.
  - MCP error formatting: все ошибки через JSON-RPC error коды (-32600 invalid params, -32603 internal error, -32000 server error)
  - Must NOT: HARDCODED инструменты в server.ts. Не использовать устаревший `SSEServerTransport` из `@modelcontextprotocol/server-legacy`.
  - **Тесты**: `app/mcp/__tests__/server.test.ts` — integration: STDIO buffer (записать JSON-RPC в stdin, прочитать из stdout), HTTP (через app.fetch(/mcp)), tools/list возвращает корректный JSON-RPC ответ
  Parallelization: Wave 3 | Blocked by: 1 | Blocks: 11-15
  References: @modelcontextprotocol/server docs (npm), MCP specification Streamable HTTP, @modelcontextprotocol/hono
  Acceptance criteria: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | bun run app/index.ts --mcp-stdio` → возвращает список инструментов. `bun test --cwd app --mcp/server` → проходят.
  QA scenarios:
    - happy: STDIO mode — tools/list returns tool list
    - happy: Streamable HTTP mode — POST /mcp returns tool list
    - happy: режимы вместе — HTTP сервер + MCP роут
    - failure: HTTP MCP без API-ключа → 401
    - failure: невалидный JSON-RPC → -32600 error
    - automated: MCP transport integration
    Evidence: .omo/evidence/agented-notes/task-10-mcp-core.log
  Commit: Y | feat(mcp): add MCP core server with STDIO and Streamable HTTP transports

- [x] 11. **MCP tools: Notes + Tags**
  What to do / Must NOT do:
  - `app/mcp/tools/notes.ts`:
    - `notes_list` — список заметок (с опциональным фильтром по тегу)
    - `notes_get` — получить заметку по ID
    - `notes_create` — создать заметку (title, content)
    - `notes_update` — обновить заметку
    - `notes_delete` — удалить заметку
    - `tags_list` — список всех тегов
  - Каждый MCP tool — объект с name, description, inputSchema (JSON Schema), handler
  - DRY: вызывают `app/services/notes.ts`, а НЕ API хендлеры и не напрямую `app/db/`
  - Must NOT: дублировать бизнес-логику из API. Вызывать те же сервисы что и API.
  - **Тесты**: `app/mcp/__tests__/tools-notes.test.ts` — integration: через STDIO buffer вызвать каждый tool, проверить JSON-RPC response
  Parallelization: Wave 3 | Blocked by: 5,10 | Blocks: 21
  References: MCP tool schema docs, предыдущий todo 5 (notes API)
  Acceptance criteria: MCP tools/list показывает notes_list. `bun test --cwd app --mcp/tools-notes` → проходят.
  QA scenarios:
    - happy: call each tool
    - happy: notes_create → notes_get → notes_update → notes_delete
    - failure: notes_get с невалидным ID → tool error
    - automated: MCP notes tools integration
    Evidence: .omo/evidence/agented-notes/task-11-mcp-notes.log
  Commit: Y | feat(mcp-tools): add notes and tags MCP tools

- [x] 12. **MCP tools: Todos/Kanban**
  What to do / Must NOT do:
  - `app/mcp/tools/todos.ts`:
    - `kanban_boards_list`
    - `kanban_columns_list` (по board_id)
    - `kanban_tasks_list` (по column_id)
    - `kanban_task_create` (title, description, column_id)
    - `kanban_task_update`
    - `kanban_task_move` (task_id, target_column_id)
    - `kanban_task_delete`
  - **Тесты**: `app/mcp/__tests__/tools-todos.test.ts` — integration: через STDIO buffer CRUD задачи, move, errors
  Parallelization: Wave 3 | Blocked by: 6,10 | Blocks: 21
  References: TODO 6 (Kanban API)
  Acceptance criteria: kanban_task_create → kanban_tasks_list → kanban_task_move → kanban_task_delete — всё через MCP. `bun test --cwd app --mcp/tools-todos` → проходят.
  QA scenarios:
    - happy: create task in column
    - happy: move task to another column
    - failure: move to non-existent column
    - automated: MCP kanban tools
    Evidence: .omo/evidence/agented-notes/task-12-mcp-todos.log
  Commit: Y | feat(mcp-tools): add kanban MCP tools

- [x] 13. **MCP tools: Events**
  What to do / Must NOT do:
  - `app/mcp/tools/events.ts`:
    - `events_list` (с опциональным date range)
    - `events_get`
    - `events_create`
    - `events_update`
    - `events_delete`
  - Для recurring events: events_list возвращает развёрнутые вхождения в указанном диапазоне
  - **Тесты**: `app/mcp/__tests__/tools-events.test.ts` — integration: CRUD, RRULE expansion через MCP
  Parallelization: Wave 3 | Blocked by: 7,10 | Blocks: 21
  References: TODO 7 (Events API)
  Acceptance criteria: events_create с RRULE → events_list с диапазоном → получаем развёрнутые даты. `bun test --cwd app --mcp/tools-events` → проходят.
  QA scenarios:
    - happy: create and list events
    - happy: recurring event expansion
    - failure: invalid date format
    - automated: MCP events tools
    Evidence: .omo/evidence/agented-notes/task-13-mcp-events.log
  Commit: Y | feat(mcp-tools): add calendar events MCP tools

- [x] 14. **MCP tools: Comments (pending comment processing)**
  What to do / Must NOT do:
  - `app/mcp/tools/comments.ts`:
    - `comments_get_pending` — получить все pending комментарии (с прикреплённой сущностью: заметкой/таской/ивентом)
    - `comments_mark_processed` — отметить комментарий как обработанный
    - `comments_delete` — удалить комментарий
  - Агент: 1) получает pending комментарии 2) читает связанную заметку 3) вносит изменения 4) удаляет комментарий (все через MCP)
  - Must NOT: auto-delete при mark_processed. Агент явно вызывает delete.
  - **Тесты**: `app/mcp/__tests__/tools-comments.test.ts` — integration: get_pending, mark_processed, delete через MCP
  Parallelization: Wave 3 | Blocked by: 8,10 | Blocks: 21
  References: TODO 8 (Comments API)
  Acceptance criteria: Создать comment (pending). MCP comments_get_pending → видит его. comments_mark_processed. comments_delete. `bun test --cwd app --mcp/tools-comments` → проходят.
  QA scenarios:
    - happy: get pending → process → delete
    - happy: no pending comments → empty list
    - automated: MCP comments pipeline
    Evidence: .omo/evidence/agented-notes/task-14-mcp-comments.log
  Commit: Y | feat(mcp-tools): add comments MCP tools for AI agent workflow

- [x] 15. **MCP tools: Search + Analytics**
  What to do / Must NOT do:
  - `app/mcp/tools/search.ts`:
    - `search_query` — полнотекстовый поиск (query, type filter)
  - `app/mcp/tools/analytics.ts`:
    - `analytics_stats` — общая статистика
    - `analytics_tags` — теги с частотой
    - `analytics_activity` — активность по дням
  - **Тесты**: `app/mcp/__tests__/tools-search.test.ts` — integration: search и analytics через MCP
  Parallelization: Wave 3 | Blocked by: 9,10 | Blocks: 21
  References: TODO 9 (Search + Analytics API)
  Acceptance criteria: MCP call search_query("hello") → находит заметку. analytics_stats → JSON. `bun test --cwd app --mcp/tools-search` → проходят.
  QA scenarios:
    - happy: search finds by content
    - happy: stats returns counts
    - happy: tags frequency
    - automated: MCP search + analytics
    Evidence: .omo/evidence/agented-notes/task-15-mcp-search.log
  Commit: Y | feat(mcp-tools): add search and analytics MCP tools

### Wave 4: Frontend

- [x] 16. **Frontend scaffold (Vite + React 19 + shadcn/ui + Tailwind + routing)**
  What to do / Must NOT do:
  - `frontend/` — Vite + React 19 + TypeScript
  - Инициализировать shadcn/ui: `npx shadcn@latest add button input card dialog select sheet dropdown-menu textarea badge`
  - Tailwind CSS config с базовыми цветами и темами
  - React Router v7 (BrowserRouter) с layout
  - Telegram Web App integration: @telegram-apps/sdk инициализация, определение окружения (TG vs Browser)
  - `frontend/src/lib/api.ts` — API клиент на fetch с JWT токеном (автоматический refresh при 401)
  - `frontend/src/store/` — Zustand store: auth store (user, login, logout), filter store (active tag), ui store (theme)
  - Адаптивный layout (sidebar + main content), мобильная версия (Telegram Web App narrow viewport)
  - Темная/светлая тема (next-themes или ручная через CSS variables)
  - Must NOT: бизнес-логика страниц. Только каркас, компоненты, роутинг, API client, store.
  Parallelization: Wave 4 | Blocked by: 1 | Blocks: 17-20
  References: Vite docs, React Router docs, shadcn/ui docs, @telegram-apps/sdk docs
  Acceptance criteria: `bun --cwd frontend dev` → открывается страница с layout и sidebar. TG SDK определяет окружение.
  QA scenarios:
    - happy: dev server starts, shows layout
    - happy: API client can make authenticated requests
    Evidence: .omo/evidence/agented-notes/task-16-frontend-scaffold.log
  Commit: Y | feat(frontend): scaffold React 19 + Vite + shadcn/ui + Tailwind + routing

- [x] 17. **Notes page + Note detail page with comments**
  What to do / Must NOT do:
  - `Notes.tsx`:
    - Список заметок (карточки: title, preview, tags, date)
    - Фильтр по тегу (клик по тегу)
    - Кнопка "New Note" → модалка или переход на /notes/new
    - Поиск по заголовку
  - `NoteDetail.tsx`:
    - Просмотр заметки (Markdown рендеринг через react-markdown + rehype-highlight)
    - Редактирование (textarea с Markdown)
    - Комментарии к заметке: список + форма добавления
    - Хэштеги кликабельны (фильтр)
  - Комментарии: пользователь пишет текст → POST /api/notes/:id/comments → комментарий появляется в списке со статусом "pending" и иконкой "ожидает обработки ИИ"
  - Агент (внешний) обрабатывает комментарий → при обновлении статуса на "processed" или удалении, UI обновляется (при рефреше страницы)
  - Must NOT: auto-refresh / polling / websocket. Только ручное обновление (re-fetch на focus или кнопка).
  - **Тесты**:
    - `frontend/src/components/__tests__/NoteCard.test.tsx` — RTL: отображение title, tags, preview
    - `frontend/src/pages/__tests__/Notes.test.tsx` — RTL + msw: список заметок, создание, фильтр по тегу
    - `frontend/src/pages/__tests__/NoteDetail.test.tsx` — RTL + msw: просмотр, редактирование, комментарии
  Parallelization: Wave 4 | Blocked by: 5,8,16 | Blocks: 21
  References: react-markdown docs, shadcn Card/Dialog components
  Acceptance criteria: Можно создать заметку, увидеть её в списке, открыть, редактировать, добавить комментарий. `bun run --cwd frontend test` → notes тесты проходят.
  QA scenarios:
    - happy: create → list → view → edit → delete note
    - happy: add comment → pending badge visible
    - happy: markdown rendering (headings, lists, code blocks)
    - happy: hashtags clickable → filter
    - automated: RTL component + page tests
    Evidence: .omo/evidence/agented-notes/task-17-notes-frontend.log
  Commit: Y | feat(frontend-notes): add notes list, detail, and comment UI

- [x] 18. **Kanban board page (drag-and-drop)**
  What to do / Must NOT do:
  - `Kanban.tsx`:
    - Отображение досок (список, создание новой)
    - Внутри доски: колонки "To Do", "In Progress", "Done" (можно добавлять свои)
    - Карточки задач внутри колонок (title, description preview, due_date badge, tags)
    - Drag-and-drop: перемещение задач между колонками через dnd-kit
    - При DnD: вызов PATCH /api/kanban/tasks/:id/move
    - Клик по задаче: модалка с деталями и редактированием
  - Must NOT: DnD колонок (пока). Оптимистичные обновления UI при DnD.
  - **Тесты**: `frontend/src/pages/__tests__/Kanban.test.tsx` — RTL + msw: отображение колонок, создание задачи, открытие модалки
  Parallelization: Wave 4 | Blocked by: 6,16 | Blocks: 21
  References: dnd-kit docs, TODO 6 (Kanban API)
  Acceptance criteria: Можно создать доску, добавить колонки, создать задачи, перетащить задачу в другую колонку. `bun run --cwd frontend test` → kanban тесты проходят.
  QA scenarios:
    - happy: create board → columns → tasks
    - happy: drag task to different column → API called → task in new column after refresh
    - happy: click task → edit modal → save
    - automated: RTL kanban tests
    Evidence: .omo/evidence/agented-notes/task-18-kanban-frontend.log
  Commit: Y | feat(frontend-kanban): add kanban board with drag-and-drop

- [x] 19. **Calendar page (FullCalendar)**
  What to do / Must NOT do:
  - `Calendar.tsx`:
    - Использовать `@fullcalendar/react` + `@fullcalendar/daygrid` + `@fullcalendar/interaction` (НЕ shadcn/ui Calendar — он только для пикера дат)
    - Вид: месяц (по умолчанию), неделя, день
    - Отображение событий (single + recurring)
    - Клик по дате → модалка создания события
    - Клик по событию → просмотр/редактирование
    - Для recurring: сервер возвращает уже развёрнутые вхождения
  - Цветовая кодировка событий
  - Must NOT: синхронизация с Google/Apple календарями. Reminder — только поле, без push.
  - **Тесты**: `frontend/src/pages/__tests__/Calendar.test.tsx` — RTL + msw: отображение событий, создание через модалку
  Parallelization: Wave 4 | Blocked by: 7,16 | Blocks: 21
  References: FullCalendar React docs
  Acceptance criteria: Calendar показывает события. Можно создать событие на определённую дату. `bun run --cwd frontend test` → calendar тесты проходят.
  QA scenarios:
    - happy: month view shows events
    - happy: create event via date click
    - happy: recurring event visible on correct dates
    - happy: edit and delete event
    - automated: RTL calendar tests
    Evidence: .omo/evidence/agented-notes/task-19-calendar-frontend.log
  Commit: Y | feat(frontend-calendar): add calendar page with FullCalendar

- [x] 20. **Auth pages (Login + Telegram Web App init)**
  What to do / Must NOT do:
  - `frontend/src/pages/Login.tsx`:
    - Если открыто в Telegram Web App: автоматическая авторизация через initData как raw string (POST /api/auth/telegram)
    - Если в браузере: кнопка "Login with Telegram" (Telegram Login Widget) или форма с вводом initData для разработки
    - После авторизации: сохранить accessToken в памяти (Zustand store), refreshToken в httpOnly cookie (устанавливается сервером через Set-Cookie)
    - initData передаётся как raw query string, НЕ как JSON (хеш считается над точной строкой)
  - `frontend/src/hooks/useAuth.ts` — хук для состояния авторизации, refresh token логика
  - `frontend/src/lib/telegram.ts` — инициализация TG SDK, получение initData
  - Компонент ProtectedRoute: если нет токена → redirect на /login
  - Must NOT: password-based auth. Только Telegram.
  Parallelization: Wave 4 | Blocked by: 4,16 | Blocks: —
  References: Telegram Web App initData docs, @telegram-apps/sdk
  Acceptance criteria: В браузере → LoginPage → кнопка Login with Telegram → после авторизации → redirect на /notes
  QA scenarios:
    - happy: TG Web App auto-auth flow
    - happy: browser manual auth flow
    - happy: token refresh on 401
    - failure: invalid initData → error message
    Evidence: .omo/evidence/agented-notes/task-20-auth-frontend.log
  Commit: Y | feat(frontend-auth): add Telegram login page and auth hooks

### Wave 5: DevOps + Polish

- [x] 21. **Dockerfile + docker-compose.yml + docker-entrypoint.sh + README**
  What to do / Must NOT do:
  - `Dockerfile`:
    - Multi-stage: build stage (Bun install + build frontend), runtime stage (distroless образ с Bun)
    - Копировать: собранный frontend в `frontend/dist/`, серверный код, `docker-entrypoint.sh`
    - ENTRYPOINT: `["/docker-entrypoint.sh"]`
    - CMD: `["bun", "run", "app/index.ts"]` (entrypoint вызывает миграции перед CMD)
    - VOLUME `/data` для SQLite базы
    - EXPOSE 3000 (HTTP) и 3100 (MCP опционально)
  - `docker-entrypoint.sh`:
    - Запускает `bun run db:migrate` перед стартом приложения
    - Обрабатывает SIGTERM (graceful shutdown: закрыть БД, завершить HTTP сервер)
  - `docker-compose.yml`:
    - Сервис `agented-notes`: build ., ports 3000:3000, volumes ./data:/data, env_file .env
    - `docker compose up` — единственная команда для запуска
  - `README.md`:
    - Описание проекта
    - Быстрый старт: ручной (`bun install && bun run db:migrate && bun run app/index.ts`) и Docker
    - Переменные окружения
    - CLI аргументы (MCP режимы)
    - Пример подключения MCP в claude_desktop_config.json / mcp.json
  - Must NOT: сложные скрипты деплоя, Kubernetes, nginx, reverse proxy
  Parallelization: Wave 5 | Blocked by: 11-15, 17-20 | Blocks: —
  References: Bun Docker docs, Docker best practices
  Acceptance criteria: `docker compose build` → success. `docker compose up` → сервер доступен на localhost:3000.
  QA scenarios:
    - happy: docker build passes
    - happy: docker compose up → curl localhost:3000 → 200
    - happy: SQLite persists across container restart (data volume)
    Evidence: .omo/evidence/agented-notes/task-21-docker.log
  Commit: Y | feat(devops): add Dockerfile, docker-compose, and README

- [x] 22. **Error handling, logging, input validation, security polish**
  What to do / Must NOT do:
  - Глобальный error handler в Hono (все ошибки → JSON { error: string, code: number })
  - Zod валидация всех входных данных API (z.object для каждого эндпоинта)
  - Логирование: `console.log` с JSON форматом + уровень (log/error/warn)
  - CORS middleware:
    - В dev режиме: разрешить origin `http://localhost:5173` (Vite dev server)
    - В production: не включать CORS (frontend и API на одном origin)
  - Rate limiting: ограничить `POST /api/auth/*` до 10 запросов в минуту (защита от brute force initData)
  - Graceful shutdown: обработка SIGTERM/SIGINT → закрыть HTTP сервер, закрыть SQLite, flush logs
  - MCP error formatting: JSON-RPC error коды (-32600 invalid params, -32603 internal error, -32000 server error)
  - Настроить скрипт `docker-build.sh` для сборки образа
  - Must NOT: sentry/datadog/log aggregation. Простой stdout. Без внешних зависимостей для rate limiting (in-process counter).
  Parallelization: Wave 5 | Blocked by: 4-9 | Blocks: —
  References: Hono middleware docs, Zod docs
  Acceptance criteria: Отправить невалидный JSON на POST /api/notes → 400 с описанием ошибки. GET /api/non-existent → 404.
  QA scenarios:
    - happy: valid request → 200
    - happy: invalid body → 400 with zod error
    - happy: 404 for unknown route
    Evidence: .omo/evidence/agented-notes/task-22-errors.log
  Commit: Y | feat(polish): add error handling, validation, logging, CORS

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. **Coverage audit** — `bun run --cwd app coverage` (≥80% сервисы), `bun run --cwd frontend coverage` (≥60% компоненты)
- [x] F2. **Code quality** — `bun run --cwd app check && bun run --cwd frontend check`, все lint правил
- [x] F3. **Integration smoke test** — curl все API endpoints, MCP STDIO и MCP HTTP, проверить ошибки
- [x] F4. **Docker e2e** — `docker compose up --build`, curl API, проверить graceful shutdown, SQLite persistence

## Commit strategy
- Conventional commits: `feat(<scope>): ...` для новых фич
- Один commit на todo (22 commits)
- Scopes: scaffold, db, config, auth, notes-svc, kanban-svc, events-svc, comments-svc, search, mcp-core, mcp-notes, mcp-todos, mcp-events, mcp-comments, mcp-search, frontend-scaffold, frontend-notes, frontend-kanban, frontend-calendar, frontend-auth, devops, polish

## Success criteria
1. `bun run app/index.ts` → HTTP сервер на порту 3000 с API
2. `bun run app/index.ts --mcp-stdio` → MCP STDIO сервер (читает JSON-RPC из stdin)
3. `bun run app/index.ts --mcp` → HTTP + MCP Streamable HTTP на `/mcp`
4. `curl POST /mcp` с X-API-Key → корректный JSON-RPC ответ
5. React SPA открывается в браузере и в Telegram Web App
6. Авторизация: TG initData (raw string) → 200 + Set-Cookie httpOnly refresh token
7. CRUD всех сущностей через REST API и через MCP tools
8. Service layer: API и MCP вызывают одни и те же сервисы (проверить импорты)
9. Kanban drag-and-drop через dnd-kit
10. Calendar показывает recurring события (FullCalendar)
11. Комментарии: pending → TTL 7 дней → агент обрабатывает → удаление
12. `docker compose up` → всё приложение; `docker stop` → graceful shutdown без повреждения БД
13. **Test coverage ≥80%** для сервисов (`bun run --cwd app coverage`)
14. **Test coverage ≥60%** для компонентов (`bun run --cwd frontend coverage`)
15. Все тесты проходят: `bun test --cwd app && bun run --cwd frontend test`
