package repository

import (
	"context"
	"readthrough-be/internal/entity"

	"gorm.io/gorm"
)

type IAICompanionRepository interface {
	Create(ctx context.Context, companion *entity.AICompanion) error
	Get(ctx context.Context, bookID, sectionTitle, action, contentHash string) (*entity.AICompanion, error)
}

type AICompanionRepository struct {
	db *gorm.DB
}

func NewAICompanionRepository(db *gorm.DB) *AICompanionRepository {
	return &AICompanionRepository{db: db}
}

func (r *AICompanionRepository) Create(ctx context.Context, companion *entity.AICompanion) error {
	return r.db.WithContext(ctx).Create(companion).Error
}

func (r *AICompanionRepository) Get(ctx context.Context, bookID, sectionTitle, action, contentHash string) (*entity.AICompanion, error) {
	var item entity.AICompanion
	if contentHash != "" {
		// 1. Try exact content hash match first
		err := r.db.WithContext(ctx).
			Where("book_id = ? AND section_title = ? AND action = ? AND content_hash = ?", bookID, sectionTitle, action, contentHash).
			Order("created_at desc").First(&item).Error
		if err == nil {
			return &item, nil
		}
	}
	// 2. Fallback to latest analysis for the same book, section title, and action (guarantees cross-device sync)
	err := r.db.WithContext(ctx).
		Where("book_id = ? AND section_title = ? AND action = ?", bookID, sectionTitle, action).
		Order("created_at desc").First(&item).Error
	if err != nil {
		return nil, err
	}
	return &item, nil
}
