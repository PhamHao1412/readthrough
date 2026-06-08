package repository

import (
	"context"
	"readthrough-be/internal/entity"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type IVocabularyRepository interface {
	Create(ctx context.Context, vocab *entity.Vocabulary) error
	Update(ctx context.Context, vocab *entity.Vocabulary) error
	List(ctx context.Context, bookID uuid.UUID, userID uuid.UUID, search string) ([]entity.Vocabulary, error)
	Delete(ctx context.Context, id uuid.UUID, userID uuid.UUID) error
	GetByWord(ctx context.Context, bookID uuid.UUID, userID uuid.UUID, word string) (*entity.Vocabulary, error)
}

type VocabularyRepository struct {
	db *gorm.DB
}

func NewVocabularyRepository(db *gorm.DB) *VocabularyRepository {
	return &VocabularyRepository{db: db}
}

func (r *VocabularyRepository) Create(ctx context.Context, vocab *entity.Vocabulary) error {
	return r.db.WithContext(ctx).Create(vocab).Error
}

func (r *VocabularyRepository) Update(ctx context.Context, vocab *entity.Vocabulary) error {
	return r.db.WithContext(ctx).Save(vocab).Error
}

func (r *VocabularyRepository) List(ctx context.Context, bookID uuid.UUID, userID uuid.UUID, search string) ([]entity.Vocabulary, error) {
	var list []entity.Vocabulary
	query := r.db.WithContext(ctx).Where("user_id = ? AND deleted_at IS NULL", userID)

	if bookID != uuid.Nil {
		query = query.Where("book_id = ?", bookID)
	}

	if search != "" {
		query = query.Where("original_text ILIKE ? OR translated_text ILIKE ?", "%"+search+"%", "%"+search+"%")
	}

	err := query.Order("created_at desc").Find(&list).Error
	return list, err
}

func (r *VocabularyRepository) Delete(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	return r.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, userID).Delete(&entity.Vocabulary{}).Error
}

func (r *VocabularyRepository) GetByWord(ctx context.Context, bookID uuid.UUID, userID uuid.UUID, word string) (*entity.Vocabulary, error) {
	var vocab entity.Vocabulary
	err := r.db.WithContext(ctx).Where("book_id = ? AND user_id = ? AND original_text = ? AND deleted_at IS NULL", bookID, userID, word).First(&vocab).Error
	if err != nil {
		return nil, err
	}
	return &vocab, nil
}
