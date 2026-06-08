-- +goose Up
ALTER TABLE vocabularies
ADD COLUMN IF NOT EXISTS ipa TEXT,
ADD COLUMN IF NOT EXISTS part_of_speech TEXT,
ADD COLUMN IF NOT EXISTS context_sentence TEXT,
ADD COLUMN IF NOT EXISTS audio_url TEXT;

-- +goose Down
ALTER TABLE vocabularies
DROP COLUMN IF EXISTS ipa,
DROP COLUMN IF EXISTS part_of_speech,
DROP COLUMN IF EXISTS context_sentence,
DROP COLUMN IF EXISTS audio_url;
