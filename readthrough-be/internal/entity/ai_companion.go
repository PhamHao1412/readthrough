package entity

type AICompanion struct {
	BaseEntity
	BookID       string `gorm:"column:book_id;type:text;not null;index:idx_ai_companion_lookup" json:"book_id"`
	SectionTitle string `gorm:"column:section_title;type:text;not null;index:idx_ai_companion_lookup" json:"section_title"`
	Action       string `gorm:"column:action;type:varchar(32);not null;index:idx_ai_companion_lookup" json:"action"`
	ContentHash  string `gorm:"column:content_hash;type:varchar(64);not null" json:"content_hash"`
	ResponseJSON string `gorm:"column:response_json;type:text;not null" json:"response_json"`
}

func (AICompanion) TableName() string {
	return SchemaName() + "ai_companions"
}
