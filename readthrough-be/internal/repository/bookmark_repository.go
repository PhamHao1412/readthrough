package repository

import (
	"context"
	"readthrough-be/internal/entity"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type IBookmarkRepository interface {
	Create(ctx context.Context, bookmark *entity.Bookmark) error
	ListByBookID(ctx context.Context, userID uuid.UUID, bookID uuid.UUID) ([]entity.Bookmark, error)
	ListAllByUserID(ctx context.Context, userID uuid.UUID) ([]entity.Bookmark, error)
	GetByPage(ctx context.Context, userID uuid.UUID, bookID uuid.UUID, page int) (*entity.Bookmark, error)
	Delete(ctx context.Context, userID uuid.UUID, id uuid.UUID) error
	DeleteByPage(ctx context.Context, userID uuid.UUID, bookID uuid.UUID, page int) error
}

type BookmarkRepository struct {
	db *gorm.DB
}

func NewBookmarkRepository(db *gorm.DB) *BookmarkRepository {
	return &BookmarkRepository{db: db}
}

func (r *BookmarkRepository) Create(ctx context.Context, bookmark *entity.Bookmark) error {
	return r.db.WithContext(ctx).Create(bookmark).Error
}

func (r *BookmarkRepository) ListByBookID(ctx context.Context, userID uuid.UUID, bookID uuid.UUID) ([]entity.Bookmark, error) {
	var list []entity.Bookmark
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND book_id = ? AND deleted_at IS NULL", userID, bookID).
		Order("page_number asc, created_at desc").
		Find(&list).Error
	return list, err
}

func (r *BookmarkRepository) ListAllByUserID(ctx context.Context, userID uuid.UUID) ([]entity.Bookmark, error) {
	var list []entity.Bookmark
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND deleted_at IS NULL", userID).
		Order("created_at desc").
		Find(&list).Error
	return list, err
}

func (r *BookmarkRepository) GetByPage(ctx context.Context, userID uuid.UUID, bookID uuid.UUID, page int) (*entity.Bookmark, error) {
	var bm entity.Bookmark
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND book_id = ? AND page_number = ? AND deleted_at IS NULL", userID, bookID, page).
		First(&bm).Error
	if err != nil {
		return nil, err
	}
	return &bm, nil
}

func (r *BookmarkRepository) Delete(ctx context.Context, userID uuid.UUID, id uuid.UUID) error {
	return r.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", id, userID).
		Delete(&entity.Bookmark{}).Error
}

func (r *BookmarkRepository) DeleteByPage(ctx context.Context, userID uuid.UUID, bookID uuid.UUID, page int) error {
	return r.db.WithContext(ctx).
		Where("user_id = ? AND book_id = ? AND page_number = ?", userID, bookID, page).
		Delete(&entity.Bookmark{}).Error
}
