package entity

import "github.com/google/uuid"

type Vocabulary struct {
	BaseEntity
	UserID          uuid.UUID `gorm:"column:user_id;type:uuid;index" json:"user_id"`
	BookID          uuid.UUID `gorm:"column:book_id;type:uuid;not null;index" json:"book_id"`
	OriginalText    string    `gorm:"column:original_text;type:text;not null" json:"original_text"`
	TranslatedText  string    `gorm:"column:translated_text;type:text;not null" json:"translated_text"`
	IPA             string    `gorm:"column:ipa;type:text" json:"ipa"`
	PartOfSpeech    string    `gorm:"column:part_of_speech;type:text" json:"part_of_speech"`
	ContextSentence string    `gorm:"column:context_sentence;type:text" json:"context_sentence"`
	AudioURL        string    `gorm:"column:audio_url;type:text" json:"audio_url"`
}

func (Vocabulary) TableName() string {
	return SchemaName() + "vocabularies"
}
