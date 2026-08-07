-- +goose Up
-- Set search_path so the unqualified table name resolves to the correct schema.
-- The app uses DB_SCHEMA_NAME env var (currently "readful" in production).
SET search_path TO readful, public;

ALTER TABLE books
    ADD COLUMN IF NOT EXISTS upload_status   VARCHAR(20)  NOT NULL DEFAULT 'ready',
    ADD COLUMN IF NOT EXISTS upload_progress INTEGER      NOT NULL DEFAULT 0;

-- +goose Down
SET search_path TO readful, public;

ALTER TABLE books
    DROP COLUMN IF EXISTS upload_status,
    DROP COLUMN IF EXISTS upload_progress;
