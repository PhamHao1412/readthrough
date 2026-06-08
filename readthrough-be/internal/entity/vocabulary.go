package entity

import "github.com/google/uuid"

type Vocabulary struct {
	BaseEntity
	UserID         uuid.UUID `gorm:"column:user_id;type:uuid;index" json:"user_id"`
	BookID         uuid.UUID `gorm:"column:book_id;type:uuid;not null;index" json:"book_id"`
	OriginalText   string    `gorm:"column:original_text;type:text;not null" json:"original_text"`
	TranslatedText string    `gorm:"column:translated_text;type:text;not null" json:"translated_text"`
}

func (Vocabulary) TableName() string {
	return SchemaName() + "vocabularies"
}
