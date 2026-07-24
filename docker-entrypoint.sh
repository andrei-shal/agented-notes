#!/bin/sh
set -eu

# ---------------------------------------------------------------------------
# agented-notes — Docker entrypoint
# ---------------------------------------------------------------------------

# Run database migrations before starting the application.
# This ensures the SQLite schema and FTS5 virtual tables are up to date.
echo "==> Running database migrations..."
bun run --cwd app db:migrate

# Start the application, replacing the shell process so that
# signals (SIGTERM, SIGINT) are delivered directly to the bun process.
# The application handles graceful shutdown internally (close DB, stop HTTP).
echo "==> Starting application..."
exec "$@"
