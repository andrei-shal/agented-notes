---
slug: agented-notes
status: awaiting-approval
intent: clear
pending-action: write .omo/plans/agented-notes.md
approach: Monolith (Bun/Hono + React SPA + Drizzle SQLite + MCP Server)
review_required: false
---

# Draft: agented-notes

## Components (topology ledger)
| id | outcome | status | evidence |
|----|---------|--------|----------|
| C1 | Bun/Hono HTTP server (API + static files) | active | Interview decision #1 |
| C2 | React 19 SPA (shadcn/ui, Tailwind) | active | Interview decision #2 |
| C3 | Drizzle ORM + SQLite database | active | Interview decision #3 |
| C4 | MCP Server (STDIO + Streamable HTTP) | active | Interview decision #4, Oracle review fix |
| C5 | Auth layer (JWT + Telegram initData) | active | Interview decisions #5, #6 |
| C6 | Comment processing pipeline (pending → AI → deleted) | active | Interview decisions #7 |
| C7 | Kanban board for todos | active | Interview decision #11 |
| C8 | Calendar engine (events, reminders, recurrence) | active | Interview decision #10 |
| C9 | Analytics module | active | Interview decision #13 |
| C10 | Docker deployment | active | Interview decision #12 |

## Open assumptions (announced defaults)
| assumption | adopted default | rationale | reversible? |
|-----------|----------------|-----------|-------------|
| SPA bundler | Vite | Стандарт для React 19 + shadcn/ui | Yes |
| CSS framework | Tailwind CSS 4 | shadcn/ui built on Tailwind | Yes |
| SQLite driver | better-sqlite3 (via bun:sqlite или Drizzle) | Лучшая производительность для Bun | Yes |
| Recurring events format | RRULE (rfc5545) | Стандарт для календарей | Yes |
| Kanban column model | Board → Column → Task | Гибкая кастомизация колонок | Yes |
| Markdown rendering | react-markdown + rehype | Стандарт для React | Yes |
| Telegram SDK | @telegram-apps/sdk | Официальный SDK | Yes |
| API key format | X-API-Key header, SHA256 хеш в .env | Простая защита MCP SSE | Yes |
| JWT lib | jose (Bun-compatible) | Нативная Bun поддержка | Yes |
| Test framework | Bun:test | Встроен в Bun | Yes |

## Findings (cited - path:lines)
- Репозиторий пуст (только git init, ни одного коммита) — greenfield проект.

## Decisions (with rationale)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **TypeScript + Bun + Hono** | Единый язык на бэк и фронт, быстрый рантайм, встроенный test runner и SQLite. Hono лёгкий, совместим с Bun. |
| D2 | **React 19 + shadcn/ui + Tailwind** | shadcn/ui даёт готовые компоненты с отличной a11y. Telegram Web Apps — JS-окружение, React подходит. |
| D3 | **Drizzle ORM** | Type-safe, лёгкий, отличная SQLite поддержка, миграции из коробки. |
| D4 | **MCP STDIO + Streamable HTTP** | STDIO для локальных агентов (Codex CLI), HTTP/Streamable для удалённых. Используем `@modelcontextprotocol/server` v1.x (не устаревший SSE). |
| D5 | **JWT access/refresh (httpOnly куки)** | Stateless, стандарт для SPA, refresh токен в httpOnly куке для безопасности. |
| D6 | **Telegram initData validation** | Стандартный и безопасный метод для Telegram Web Apps. |
| D7 | **Markdown + #tag** | Простой формат, хэштеги парсятся прямо из текста. |
| D8 | **Полноценный календарь (RRULE)** | Recurring events с RRULE — стандарт RFC 5545. |
| D9 | **Kanban доски** | Гибкая система с кастомными колонками. |
| D10 | **ENV + CLI args** | CLI args удобны для MCP: `--mcp-stdio` и `--mcp --mcp-port 3100`. |
| D11 | **CRUD + поиск + аналитика** | Полный набор MCP инструментов для агента. |
| D12 | **MCP Streamable HTTP с API-ключом** | Защита сетевого MCP от несанкционированного доступа через X-API-Key header. |
| D13 | **Внешний MCP клиент** | Агент сам опрашивает pending-комментарии через MCP инструменты. |

## Scope IN
- API сервер (Hono + Bun) с маршрутами: заметки, todo, события, комментарии, хэштеги, аналитика, авторизация
- React SPA с роутингом: страница заметок, kanban доска, календарь, комментарии
- MCP сервер (STDIO + Streamable HTTP) с инструментами: CRUD всех сущностей, поиск, аналитика, pending-комментарии
- Авторизация: JWT (access в JSON, refresh в httpOnly cookie) для браузера + initData для Telegram + API-ключ для MCP HTTP
- Telegram Web App совместимость (mini app, initData, theme params)
- База данных SQLite через Drizzle ORM с миграциями
- Dockerfile + docker-compose.yml + инструкция для ручного деплоя
- Комментарии к заметкам с конвейером (pending → processed → auto-delete)

## Scope OUT (Must NOT have)
- Мультитенантность / регистрация других пользователей (только single-user)
- Отдельный микросервис или очередь сообщений (всё в монолите)
- Встроенный AI / LLM вызов (агент внешний, через MCP)
- WebSocket / real-time синхронизация (REST + ручное обновление)
- Мобильное приложение (кроме Telegram Web App)
- Cloud-провайдеры / S3 / внешние зависимости (кроме SQLite)

## High-accuracy review results
- Momus (Plan Critic): **CONDITIONAL PASS** — 3 major issues (DRY, FTS5, matrix) + 4 minor
- Oracle (Architecture): **CONDITIONAL** — 1 HIGH (MCP SDK SSE → Streamable HTTP) + 3 medium
- **Все issues исправлены в плане.** Статус: READY FOR APPROVAL.

## Open questions
_Все forks решены через интервью. Review issues исправлены._

## Approval gate
status: approved
<!-- Plan утверждён пользователем. Готов к execution. -->
