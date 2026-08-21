-- +goose Up
CREATE TABLE IF NOT EXISTS ai_companions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id       TEXT NOT NULL,
    section_title TEXT NOT NULL,
    action        VARCHAR(32) NOT NULL,
    content_hash  VARCHAR(64) NOT NULL,
    response_json TEXT NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_companions_lookup ON ai_companions (book_id, section_title, action) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS ai_companions;
