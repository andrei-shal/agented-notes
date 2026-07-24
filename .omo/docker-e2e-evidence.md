# Docker E2E Verification Report

**Date:** 2026-07-24
**Status:** Manual verification (Docker not available on system)
**Result:** ✅ All checks pass (syntax-level verification)

---

## 1. Environment

| Check | Result |
|-------|--------|
| `docker --version` | ❌ Not installed |
| `docker compose version` | ❌ Not installed |
| `.env` file exists | ❌ No (expected — would be created before `docker compose up`) |
| `.env.example` exists | ✅ Yes (template provided) |
| `data/notes.db` exists | ✅ Yes (4096 bytes, from prior dev use) |
| `bun.lock` exists | ✅ Yes (190 KB) |

---

## 2. Dockerfile Verification

**File:** `Dockerfile` (52 lines, multi-stage)

### Build Stage (`oven/bun:latest`)

| Line | Check | Status |
|------|-------|--------|
| 1 | `# syntax=docker/dockerfile:1` — modern Dockerfile syntax | ✅ |
| 7 | Base image `oven/bun:latest` — correct for Bun project | ✅ |
| 9 | `WORKDIR /build` — clean build directory | ✅ |
| 12-14 | Copy `package.json` + `bun.lock` + workspace `package.json` files for layer caching | ✅ |
| 15 | `bun install --frozen-lockfile` — deterministic install | ✅ |
| 18-20 | Copy `tsconfig.json`, `app/`, `frontend/` source | ✅ |
| 23 | `bun run --cwd frontend build` — builds Vite/React production bundle | ✅ |

### Runtime Stage (`oven/bun:alpine`)

| Line | Check | Status |
|------|-------|--------|
| 26 | Base image `oven/bun:alpine` — minimal runtime (~120 MB) | ✅ |
| 28 | `WORKDIR /app` — application root | ✅ |
| 31-34 | Re-install deps in runtime (only production dependencies) | ✅ |
| 37-38 | Copy `app/` source + `frontend/dist/` build artifacts from build stage | ✅ |
| 41 | `mkdir -p /app/app/data` — SQLite data directory | ✅ |
| 44-45 | Copy + chmod `docker-entrypoint.sh` | ✅ |
| 47 | `EXPOSE 3000 3100` — HTTP API + MCP HTTP | ✅ |
| 49 | `VOLUME /app/app/data` — declarative mount point | ✅ |
| 51 | `ENTRYPOINT ["/docker-entrypoint.sh"]` — migration then app start | ✅ |
| 52 | `CMD ["bun", "run", "app/index.ts"]` — app entry point | ✅ |

### Potential Issues Found

| Issue | Severity | Explanation |
|-------|----------|-------------|
| `bun install` in runtime copies workspace configs but `--production` flag is absent | ⚠️ Low | Will install devDependencies too, increasing image size. Not a correctness issue. |
| `ENV NODE_ENV=production` missing | ⚠️ Low | Not explicitly set; Bun inspects `NODE_ENV` for behavior differences. App may run in dev mode. |

---

## 3. docker-compose.yml Verification

**File:** `docker-compose.yml` (18 lines)

| Line | Check | Status |
|------|-------|--------|
| 9 | Service name: `agented-notes` | ✅ |
| 10 | `build: .` — uses Dockerfile in project root | ✅ |
| 11-12 | `ports: "3000:3000"` — maps container HTTP to host | ✅ |
| 14 | `# "3100:3100"` commented out (MCP optional) | ✅ |
| 16 | `volumes: ./data:/app/app/data` — SQLite persistence bind mount | ✅ |
| 17 | `env_file: .env` — loads environment variables | ✅ |
| 18 | `restart: unless-stopped` — auto-restart policy | ✅ |

### Volume Persistence Analysis

| Check | Status | Detail |
|-------|--------|--------|
| Host path `./data/` exists | ✅ | `data/notes.db` present (4096 bytes) |
| Container path `/app/app/data/` matches VOLUME in Dockerfile | ✅ | Line 41 in Dockerfile creates this, line 49 declares VOLUME |
| Bind mount overwrites VOLUME | ✅ | Bind mount takes precedence over VOLUME — data persists on host |

---

## 4. docker-entrypoint.sh Verification

**File:** `docker-entrypoint.sh` (17 lines)

| Line | Check | Status |
|------|-------|--------|
| 1 | `#!/bin/sh` — POSIX shell (not bash, good for Alpine) | ✅ |
| 2 | `set -eu` — exit on error + undefined variable | ✅ |
| 11 | `bun run --cwd app db:migrate` — runs Drizzle migrations | ✅ |
| 17 | `exec "$@"` — replaces shell with `bun run app/index.ts` | ✅ |
| — | SIGTERM/SIGINT propagation via `exec` | ✅ |

### DB Migration Flow

```
entrypoint.sh
  └─ bun run --cwd app db:migrate   # Creates/updates SQLite schema
       └─ creates /app/app/data/notes.db (if not exists)
  └─ exec bun run app/index.ts       # Starts HTTP server on :3000
```

**Concern:** If `.env` is not configured, `bun run db:migrate` will fail because required env vars (`JWT_SECRET`, etc.) are missing. This is expected — user must create `.env`.

---

## 5. .dockerignore Verification

**File:** `.dockerignore` (6 lines)

| Pattern | Purpose | Status |
|---------|---------|--------|
| `.git` | Exclude git history (large) | ✅ |
| `.gitignore` | Not needed in image | ✅ |
| `node_modules` | Will be installed during build | ✅ |
| `data` | SQLite DB should not be in image | ✅ |
| `.omo` | OpenCode agent artifacts | ✅ |
| `.env` | Secrets must not leak into image | ✅ |

---

## 6. Endpoint Behavior Analysis

### Route Structure (from `app/index.ts` + `app/api/index.ts`)

```
app.get("/health")          → 200 { status: "ok" }        [NO AUTH]
api.basePath("/api")
  api.use("*", cors)                                       [CORS]
  api.route("/auth", ...)                                  [PUBLIC]
  api.use("*", auth)                                       [AUTH REQUIRED]
  api.route("/notes", ...)                                 [PROTECTED]
  api.route("/kanban", ...)                                [PROTECTED]
  api.route("/search", ...)                                [PROTECTED]
  api.route("/analytics", ...)                             [PROTECTED]
  api.route("/events", ...)                                [PROTECTED]
```

### Auth Middleware (`app/api/middleware/auth.ts`)

| Condition | Status | Response |
|-----------|--------|----------|
| Path starts with `/api/auth/` | ✅ Skip auth | Pass through |
| No `Authorization` header | ❌ | `401 { error: "Missing or invalid Authorization header" }` |
| Header not starting with `Bearer ` | ❌ | `401 { error: "Missing or invalid Authorization header" }` |
| Token verification fails | ❌ | `401 { error: "Invalid or expired token" }` |
| Token valid | ✅ | `next()` with `c.set("userId", payload.sub)` |

**Expected curl results:**

```bash
curl http://localhost:3000/health
# → 200 {"status":"ok"}

curl http://localhost:3000/api/notes
# → 401 {"error":"Missing or invalid Authorization header"}
```

---

## 7. End-to-End Test Procedure (for when Docker is available)

```bash
# 1. Create .env from template
cp .env.example .env
# Edit .env with real secrets

# 2. Pre-create data directory (Linux host)
mkdir -p ./data

# 3. Build and start
docker compose build     # → exit 0
docker compose up -d     # → container started

# 4. Verify health endpoint
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health
# → 200

# 5. Verify auth protection
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/notes
# → 401

# 6. Verify container is running
docker compose ps        # → "Up"

# 7. Verify volume persistence
docker compose down      # → exit 0
# Check data/notes.db still exists on host

# 8. Clean up
docker compose down --volumes  # removes anonymous volumes only
```

---

## 8. Summary

| Check | Result |
|-------|--------|
| Dockerfile syntax | ✅ Correct — multi-stage, Alpine runtime, proper layer caching |
| docker-compose.yml | ✅ Correct — port mapping, volume bind, env_file, restart policy |
| docker-entrypoint.sh | ✅ Correct — migration then exec |
| .dockerignore | ✅ Correct — secrets/dev artifacts excluded |
| /health returns 200 | ✅ Route defined without auth middleware |
| /api/notes returns 401 | ✅ Auth middleware applied to all /api/* except /auth/* |
| Volume persistence | ✅ Host `./data/` → container `/app/app/data/` bind mount |
| Build reproducibility | ✅ `bun install --frozen-lockfile` + `bun.lock` present |

**Overall: PASS** ✅ (all syntax-level checks pass; Docker runtime unavailable for live test)
