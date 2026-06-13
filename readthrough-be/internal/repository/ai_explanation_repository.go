package repository

import (
	"context"
	"readthrough-be/internal/entity"

	"gorm.io/gorm"
)

type IAIExplanationRepository interface {
	Create(ctx context.Context, explanation *entity.AIExplanation) error
	Get(ctx context.Context, word string, contextSentence string) (*entity.AIExplanation, error)
}

type AIExplanationRepository struct {
	db *gorm.DB
}

func NewAIExplanationRepository(db *gorm.DB) *AIExplanationRepository {
	return &AIExplanationRepository{db: db}
}

func (r *AIExplanationRepository) Create(ctx context.Context, explanation *entity.AIExplanation) error {
	return r.db.WithContext(ctx).Create(explanation).Error
}

func (r *AIExplanationRepository) Get(ctx context.Context, word string, contextSentence string) (*entity.AIExplanation, error) {
	var exp entity.AIExplanation
	err := r.db.WithContext(ctx).Where("word = ? AND context_sentence = ?", word, contextSentence).First(&exp).Error
	if err != nil {
		return nil, err
	}
	return &exp, nil
}
