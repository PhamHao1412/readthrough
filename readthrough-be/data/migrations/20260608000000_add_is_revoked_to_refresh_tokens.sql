-- +goose Up
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS is_revoked BOOLEAN DEFAULT FALSE;

-- +goose Down
ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS is_revoked;
