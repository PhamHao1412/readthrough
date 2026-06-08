#!/bin/sh
set -e

echo "=== Starting readthrough ==="

# Run migrations if DB.URL is set
if [ -n "$DB_URL" ]; then
    echo ">>> Running database migrations..."
    
    # Prepare connection URL containing search_path for goose
    MIGRATE_URL="$DB_URL"
    if echo "$MIGRATE_URL" | grep -Fq "?"; then
        # If query parameters already exist, append using &
        if ! echo "$MIGRATE_URL" | grep -Fq "search_path="; then
            MIGRATE_URL="${MIGRATE_URL}&search_path=readful"
        fi
    else
        # If no query parameters exist, append using ?
        MIGRATE_URL="${MIGRATE_URL}?search_path=readful"
    fi

    # Run goose migrations in the readful schema
    goose -dir /app/data/migrations postgres "$MIGRATE_URL" up
    echo ">>> Migrations done!"
else
    echo ">>> WARNING: DB_URL not set, skipping migrations"
fi

echo ">>> Starting backend server..."
exec /app/serverd
