-- +goose Up
CREATE TABLE IF NOT EXISTS ai_explanations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    word             TEXT NOT NULL,
    context_sentence TEXT NOT NULL DEFAULT '',
    explanation      TEXT NOT NULL,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at       TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_explanations_word_context ON ai_explanations (word, context_sentence) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS ai_explanations;
