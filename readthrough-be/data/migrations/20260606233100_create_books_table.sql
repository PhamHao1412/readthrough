-- +goose Up
CREATE TABLE IF NOT EXISTS books (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    deleted_at    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_books_deleted_at ON books (deleted_at);

-- +goose Down
DROP TABLE IF EXISTS books;
