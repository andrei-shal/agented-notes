# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# agented-notes — multi-stage Dockerfile
# ---------------------------------------------------------------------------

# ── Build stage ────────────────────────────────────────────────────────────
FROM oven/bun:latest AS build

WORKDIR /build

# Install all workspace dependencies (layer caching)
COPY package.json bun.lock ./
COPY app/package.json ./app/
COPY frontend/package.json ./frontend/
RUN bun install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY app/ ./app/
COPY frontend/ ./frontend/

# Build frontend production bundle
RUN bun run --cwd frontend build

# ── Runtime stage ──────────────────────────────────────────────────────────
FROM oven/bun:alpine

WORKDIR /app

# Install runtime dependencies (including drizzle-kit for migrations)
COPY package.json bun.lock ./
COPY app/package.json ./app/
COPY frontend/package.json ./frontend/
RUN bun install --frozen-lockfile

# Copy built artifacts from build stage
COPY --from=build /build/app ./app/
COPY --from=build /build/frontend/dist ./frontend/dist/

# Data directory for SQLite database (bind-mount point)
RUN mkdir -p /app/app/data

# Entrypoint
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000 3100

# Create non-root user
RUN addgroup --system bun && adduser --system --ingroup bun bun \
    && chown -R bun:bun /app
USER bun

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "run", "app/index.ts"]
