-- +goose Up
ALTER TABLE books
    ADD COLUMN IF NOT EXISTS upload_status   VARCHAR(20)  NOT NULL DEFAULT 'ready',
    ADD COLUMN IF NOT EXISTS upload_progress INTEGER      NOT NULL DEFAULT 0;

-- Backfill existing rows (they are already fully uploaded)
UPDATE books SET upload_status = 'ready', upload_progress = 100 WHERE upload_status = 'ready';

-- +goose Down
ALTER TABLE books
    DROP COLUMN IF EXISTS upload_status,
    DROP COLUMN IF EXISTS upload_progress;
