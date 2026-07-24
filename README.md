# agented-notes

AI-augmented note-taking with Kanban, calendar, and full-text search.

## Tech Stack

| Layer          | Stack |
|----------------|-------|
| Runtime        | [Bun](https://bun.sh) 1.3+ |
| Backend        | [Hono](https://hono.dev) — fast HTTP framework |
| Database       | SQLite (via `bun:sqlite`) + [Drizzle ORM](https://orm.drizzle.team) |
| Frontend       | [React](https://react.dev) 19 + [shadcn/ui](https://ui.shadcn.com) + [Tailwind CSS](https://tailwindcss.com) |
| MCP            | [Model Context Protocol](https://modelcontextprotocol.io) — stdio + HTTP transports |
| Auth           | JWT (via `jose`) |

## Quick Start (Manual)

```bash
# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with your secrets (JWT_SECRET, TELEGRAM_BOT_TOKEN, MCP_API_KEY)

# Run database migrations (creates schema + FTS5 indexes)
bun run --cwd app db:migrate

# Start development servers (API + Vite frontend)
bun run dev

# Or start API-only
bun run --cwd app start      # HTTP on port 3000
bun run --cwd app start -- --mcp-stdio   # MCP stdio mode
bun run --cwd app start -- --mcp         # MCP HTTP mode on port 3100
```

## Docker

### Prerequisites

- [Docker](https://docs.docker.com/engine/install/) with Compose v2
- A `.env` file (copy from `.env.example` and fill in secrets)

### Quick Start

```bash
# Pull pre-built image from GHCR and start
docker compose up -d

# Or build locally (e.g. for development)
docker compose up --build -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

The API is available at `http://localhost:3000`.

### CI/CD — GitHub Container Registry

Образ автоматически собирается и пушится в `ghcr.io` через GitHub Actions:

| Триггер | Теги образа |
|---|---|
| Пуш в `master` | `ghcr.io/andrei-shal/agented-notes:latest`, `:<sha>` |
| Тег `v*` (например `v1.2.3`) | `:latest`, `:1.2.3`, `:1.2` |

```bash
# Стянуть готовый образ (не требует локальной сборки)
docker pull ghcr.io/andrei-shal/agented-notes:latest

# Запустить
docker run -p 3000:3000 -v ./data:/app/app/data --env-file .env ghcr.io/andrei-shal/agented-notes:latest
```

Workflow — `.github/workflows/docker.yml`.

### Data Persistence

The SQLite database is stored at `./data/notes.db` on the host and mounted into the container at `/app/app/data/`. The database is created automatically on first start via the migration entrypoint.

> **Tip for Linux hosts:** Pre-create the `./data/` directory if the container runs as a non-root user:
> ```bash
> mkdir -p ./data
> ```

### Image Structure

The Dockerfile uses a **multi-stage build**:

1. **Build stage** (`oven/bun:latest`) — installs all dependencies and builds the React frontend bundle via Vite.
2. **Runtime stage** (`oven/bun:alpine`) — installs runtime dependencies, copies the built frontend and app source.

### Manual Docker Build

```bash
docker build -t agented-notes .
docker run -p 3000:3000 -v ./data:/app/app/data --env-file .env agented-notes
```

## Environment Variables

| Variable              | Required | Default            | Description |
|-----------------------|----------|--------------------|-------------|
| `PORT`                | No       | `3000`             | HTTP server port |
| `JWT_SECRET`          | **Yes**  | —                  | At least 16 characters, used for JWT signing |
| `TELEGRAM_BOT_TOKEN`  | **Yes**  | —                  | Telegram bot API token |
| `MCP_API_KEY`         | **Yes**  | —                  | API key for MCP HTTP transport auth |
| `DATABASE_PATH`       | No       | `./data/notes.db`  | SQLite database file path |

All variables are read from the environment at startup. Use a `.env` file or pass them directly to the container.

## CLI Arguments

The application accepts CLI flags that override environment variables:

| Flag               | Effect |
|--------------------|--------|
| `--port <number>` | Override HTTP port |
| `--mcp-stdio`      | Enable MCP stdio transport (disables HTTP server) |
| `--mcp`            | Enable MCP HTTP transport on `/mcp` endpoint |
| `--mcp-port`       | Override MCP HTTP port (default: 3100) |

### MCP Modes

| Mode | Flag | Description |
|------|------|-------------|
| **none** (default) | *(no flag)* | HTTP API only; MCP disabled |
| **stdio** | `--mcp-stdio` | MCP over stdin/stdout (use for Claude Desktop integration). HTTP server is disabled. |
| **http** | `--mcp` | MCP over HTTP at `/mcp` endpoint. Requires `MCP_API_KEY` in `Authorization: Bearer` header. |

## MCP Client Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agented-notes": {
      "command": "bun",
      "args": [
        "run",
        "--cwd",
        "/full/path/to/agented-notes/app",
        "index.ts",
        "--mcp-stdio"
      ],
      "env": {
        "JWT_SECRET": "your-jwt-secret",
        "TELEGRAM_BOT_TOKEN": "your-telegram-token",
        "MCP_API_KEY": "your-mcp-api-key",
        "DATABASE_PATH": "/full/path/to/agented-notes/data/notes.db"
      }
    }
  }
}
```

### OpenCode / MCP-compatible Client (HTTP)

Add to your `mcp.json` or client config:

```json
{
  "mcpServers": {
    "agented-notes": {
      "url": "http://localhost:3100/mcp",
      "headers": {
        "Authorization": "Bearer your-mcp-api-key"
      }
    }
  }
}
```

## Project Structure

```
agented-notes/
├── app/                  # Backend (Hono API, DB, MCP server)
│   ├── api/             # HTTP route handlers
│   ├── db/              # Database schema, migrations, FTS5 setup
│   ├── lib/             # Shared utilities
│   ├── mcp/             # MCP server definitions + tools
│   ├── services/        # Business logic
│   └── index.ts         # Entry point
├── frontend/            # React SPA (Vite + shadcn + Tailwind)
│   └── src/             # Components, pages, stores
├── data/                # SQLite database (git-ignored)
├── .github/
│   └── workflows/
│       └── docker.yml   # GHCR build & push (main / tags)
├── docker-compose.yml   # Single-service Docker deployment
├── Dockerfile           # Multi-stage build
└── docker-entrypoint.sh # Runtime entrypoint (migrations + app start)
```

## Development

```bash
# Install dependencies
bun install

# Start both API and frontend in watch mode
bun run dev

# Run backend tests
bun run --cwd app test

# Type checking
bun run check
```

## Architecture

### Single-user

agented-notes is a **personal tool** designed for a single user. All notes, boards,
events, and comments are shared across all authenticated sessions — there is no
data isolation by user ID.

If multi-user support is needed in the future, each data table would require a
`user_id` foreign key and filtered queries in every service.

## Development Notes

The `.omo/` directory contains agent session artifacts, plans, and evidence
generated by OpenCode/OMO tooling. These files are excluded from the git
repository via `.gitignore`.

## License

MIT
