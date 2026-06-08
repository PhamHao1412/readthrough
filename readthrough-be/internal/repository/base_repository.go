package repository

import "gorm.io/gorm"

type IBaseRepository interface {
	CreateTx(tx *gorm.DB, entity interface{}) error
}

type BaseRepository struct {
	db *gorm.DB
}

func NewBaseRepository(db *gorm.DB) *BaseRepository {
	return &BaseRepository{db: db}
}

func (b *BaseRepository) CreateTx(tx *gorm.DB, entity interface{}) error {
	return tx.Create(entity).Error
}
