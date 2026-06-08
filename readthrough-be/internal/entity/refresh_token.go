package entity

import (
	"time"

	"github.com/google/uuid"
)

type RefreshToken struct {
	BaseEntity
	UserID    uuid.UUID `gorm:"column:user_id;type:uuid;not null;index" json:"user_id"`
	Token     string    `gorm:"column:token;type:varchar(255);not null;uniqueIndex" json:"token"`
	ExpiresAt time.Time `gorm:"column:expires_at;type:timestamp;not null" json:"expires_at"`
	IsRevoked bool      `gorm:"column:is_revoked;type:boolean;default:false" json:"is_revoked"`
}

func (RefreshToken) TableName() string {
	return SchemaName() + "refresh_tokens"
}
