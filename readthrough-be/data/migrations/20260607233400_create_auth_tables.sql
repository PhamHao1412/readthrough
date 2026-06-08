-- +goose Up
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(100) NOT NULL UNIQUE,
    email         VARCHAR(100) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users (deleted_at);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL,
    token         VARCHAR(255) NOT NULL UNIQUE,
    expires_at    TIMESTAMP NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at    TIMESTAMP,
    CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_deleted_at ON refresh_tokens (deleted_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens (token);

ALTER TABLE books ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE books ADD CONSTRAINT fk_books_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE vocabularies ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE vocabularies ADD CONSTRAINT fk_vocabularies_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

-- +goose Down
ALTER TABLE vocabularies DROP CONSTRAINT IF EXISTS fk_vocabularies_user;
ALTER TABLE vocabularies DROP COLUMN IF EXISTS user_id;

ALTER TABLE books DROP CONSTRAINT IF EXISTS fk_books_user;
ALTER TABLE books DROP COLUMN IF EXISTS user_id;

DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;
