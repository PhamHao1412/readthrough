-- +goose Up
-- 1. Create users table
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

-- 2. Create books table
CREATE TABLE IF NOT EXISTS books (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL,
    title         TEXT NOT NULL,
    author        TEXT NOT NULL DEFAULT 'Tác giả ẩn danh',
    file_path     TEXT NOT NULL,
    file_type     VARCHAR(10) NOT NULL,
    file_size     BIGINT NOT NULL,
    cover_url     TEXT,
    current_page  INTEGER NOT NULL DEFAULT 1,
    epub_cfi      TEXT DEFAULT '',
    total_pages   INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at    TIMESTAMP,
    CONSTRAINT fk_books_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_books_deleted_at ON books (deleted_at);

-- 3. Create vocabularies table
CREATE TABLE IF NOT EXISTS vocabularies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    book_id         UUID NOT NULL,
    original_text   TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at      TIMESTAMP,
    CONSTRAINT fk_vocabularies_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_vocabularies_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_vocabularies_deleted_at ON vocabularies (deleted_at);
CREATE INDEX IF NOT EXISTS idx_vocabularies_book_id ON vocabularies (book_id);

-- 4. Create refresh_tokens table
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL,
    token         VARCHAR(255) NOT NULL UNIQUE,
    is_revoked    BOOLEAN DEFAULT FALSE,
    expires_at    TIMESTAMP NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at    TIMESTAMP,
    CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_deleted_at ON refresh_tokens (deleted_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens (token);

-- +goose Down
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS vocabularies;
DROP TABLE IF EXISTS books;
DROP TABLE IF EXISTS users;
