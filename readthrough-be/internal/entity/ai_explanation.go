package entity

type AIExplanation struct {
	BaseEntity
	Word            string `gorm:"column:word;type:text;not null" json:"word"`
	ContextSentence string `gorm:"column:context_sentence;type:text;not null;default:''" json:"context_sentence"`
	Explanation     string `gorm:"column:explanation;type:text;not null" json:"explanation"`
}

func (AIExplanation) TableName() string {
	return SchemaName() + "ai_explanations"
}
