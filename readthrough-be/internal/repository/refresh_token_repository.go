package repository

import (
	"context"
	"readthrough-be/internal/entity"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type IRefreshTokenRepository interface {
	Create(ctx context.Context, token *entity.RefreshToken) error
	GetByToken(ctx context.Context, tokenStr string) (*entity.RefreshToken, error)
	DeleteByToken(ctx context.Context, tokenStr string) error
	DeleteByUserID(ctx context.Context, userID uuid.UUID) error
	Revoke(ctx context.Context, tokenStr string) error
	RevokeAll(ctx context.Context, userID uuid.UUID) error
}

type RefreshTokenRepository struct {
	db *gorm.DB
}

func NewRefreshTokenRepository(db *gorm.DB) *RefreshTokenRepository {
	return &RefreshTokenRepository{db: db}
}

func (r *RefreshTokenRepository) Create(ctx context.Context, token *entity.RefreshToken) error {
	return r.db.WithContext(ctx).Create(token).Error
}

func (r *RefreshTokenRepository) GetByToken(ctx context.Context, tokenStr string) (*entity.RefreshToken, error) {
	var token entity.RefreshToken
	err := r.db.WithContext(ctx).First(&token, "token = ? AND deleted_at IS NULL", tokenStr).Error
	if err != nil {
		return nil, err
	}
	return &token, nil
}

func (r *RefreshTokenRepository) DeleteByToken(ctx context.Context, tokenStr string) error {
	// Hard delete for refresh tokens to save DB space
	return r.db.WithContext(ctx).Unscoped().Where("token = ?", tokenStr).Delete(&entity.RefreshToken{}).Error
}

func (r *RefreshTokenRepository) DeleteByUserID(ctx context.Context, userID uuid.UUID) error {
	return r.db.WithContext(ctx).Unscoped().Where("user_id = ?", userID).Delete(&entity.RefreshToken{}).Error
}

func (r *RefreshTokenRepository) Revoke(ctx context.Context, tokenStr string) error {
	return r.db.WithContext(ctx).Model(&entity.RefreshToken{}).Where("token = ?", tokenStr).Update("is_revoked", true).Error
}

func (r *RefreshTokenRepository) RevokeAll(ctx context.Context, userID uuid.UUID) error {
	return r.db.WithContext(ctx).Model(&entity.RefreshToken{}).Where("user_id = ?", userID).Update("is_revoked", true).Error
}
