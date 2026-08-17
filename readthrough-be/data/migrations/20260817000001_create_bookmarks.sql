-- +goose Up
SET search_path TO readful, public;

CREATE TABLE IF NOT EXISTS bookmarks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL,
    book_id       UUID NOT NULL,
    page_number   INTEGER NOT NULL,
    title         TEXT DEFAULT '',
    snippet       TEXT DEFAULT '',
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at    TIMESTAMP,
    CONSTRAINT fk_bookmarks_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_bookmarks_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON bookmarks (user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_book_id ON bookmarks (book_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_deleted_at ON bookmarks (deleted_at);

-- +goose Down
SET search_path TO readful, public;
DROP TABLE IF EXISTS bookmarks;
