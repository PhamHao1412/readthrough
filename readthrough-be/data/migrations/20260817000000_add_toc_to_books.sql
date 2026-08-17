-- +goose Up
-- Set search_path so the unqualified table name resolves to the correct schema.
SET search_path TO readful, public;

ALTER TABLE books
    ADD COLUMN IF NOT EXISTS toc TEXT DEFAULT '';

-- +goose Down
SET search_path TO readful, public;

ALTER TABLE books
    DROP COLUMN IF EXISTS toc;
