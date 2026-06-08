package repository

import (
	"context"
	"readthrough-be/internal/entity"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type IBookRepository interface {
	Create(ctx context.Context, book *entity.Book) error
	List(ctx context.Context, userID uuid.UUID, search string) ([]entity.Book, error)
	GetByID(ctx context.Context, id uuid.UUID, userID uuid.UUID) (*entity.Book, error)
	UpdateProgress(ctx context.Context, id uuid.UUID, userID uuid.UUID, page int, cfi string, totalPages int) error
}

type BookRepository struct {
	db *gorm.DB
}

func NewBookRepository(db *gorm.DB) *BookRepository {
	return &BookRepository{db: db}
}

func (r *BookRepository) Create(ctx context.Context, book *entity.Book) error {
	return r.db.WithContext(ctx).Create(book).Error
}

func (r *BookRepository) List(ctx context.Context, userID uuid.UUID, search string) ([]entity.Book, error) {
	var list []entity.Book
	query := r.db.WithContext(ctx).Where("user_id = ? AND deleted_at IS NULL", userID)
	if search != "" {
		// Use a sub-query group for search text filters to maintain user_id isolation
		query = query.Where("title ILIKE ? OR author ILIKE ?", "%"+search+"%", "%"+search+"%")
	}
	err := query.Order("updated_at desc").Find(&list).Error
	return list, err
}

func (r *BookRepository) GetByID(ctx context.Context, id uuid.UUID, userID uuid.UUID) (*entity.Book, error) {
	var book entity.Book
	err := r.db.WithContext(ctx).First(&book, "id = ? AND user_id = ?", id, userID).Error
	if err != nil {
		return nil, err
	}
	return &book, nil
}

func (r *BookRepository) UpdateProgress(ctx context.Context, id uuid.UUID, userID uuid.UUID, page int, cfi string, totalPages int) error {
	updates := map[string]interface{}{
		"current_page": page,
	}
	if cfi != "" {
		updates["epub_cfi"] = cfi
	}
	if totalPages > 0 {
		updates["total_pages"] = totalPages
	}
	return r.db.WithContext(ctx).Model(&entity.Book{}).Where("id = ? AND user_id = ?", id, userID).Updates(updates).Error
}
