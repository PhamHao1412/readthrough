-- +goose Up
CREATE TABLE IF NOT EXISTS vocabularies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id         UUID NOT NULL,
    original_text   TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at      TIMESTAMP,
    CONSTRAINT fk_vocabularies_book FOREIGN KEY (book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vocabularies_deleted_at ON vocabularies (deleted_at);
CREATE INDEX IF NOT EXISTS idx_vocabularies_book_id ON vocabularies (book_id);

-- +goose Down
DROP TABLE IF EXISTS vocabularies;
