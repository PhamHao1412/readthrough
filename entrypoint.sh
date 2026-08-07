#!/bin/sh
set -e

echo "=== Starting readthrough ==="

# Run migrations if DB_URL is set
if [ -n "$DB_URL" ]; then
    echo ">>> Running database migrations..."
    # Point goose version-tracking table to the app schema (e.g. "readful").
    # Previous runs stored goose_db_version in "public" — by switching to the
    # correct schema, goose sees all migrations as not-yet-run and applies them
    # again (safely, because every CREATE/ALTER uses IF NOT EXISTS).
    # PGOPTIONS ensures every SQL statement also resolves table names inside
    # the correct schema.
    SCHEMA="${DB_SCHEMA_NAME:-public}"
    export PGOPTIONS="-c search_path=${SCHEMA},public"
    goose -dir /app/data/migrations -table "${SCHEMA}.goose_db_version" postgres "$DB_URL" up
    echo ">>> Migrations done!"
else
    echo ">>> WARNING: DB_URL not set, skipping migrations"
fi

echo ">>> Starting backend server..."
exec /app/serverd
