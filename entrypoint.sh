#!/bin/sh
set -e

echo "=== Starting readthrough ==="

# Run migrations if DB.URL is set
if [ -n "$DB_URL" ]; then
    echo ">>> Running database migrations..."
    goose -dir /app/data/migrations postgres "$DB_URL" up
    echo ">>> Migrations done!"
else
    echo ">>> WARNING: DB_URL not set, skipping migrations"
fi

echo ">>> Starting backend server..."
exec /app/serverd
