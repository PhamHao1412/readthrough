package entity

import (
	"fmt"
	"readthrough-be/internal/app"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

var config *app.Config

type BaseEntity struct {
	ID        uuid.UUID       `gorm:"type:uuid;primaryKey;default:gen_random_uuid()" json:"id"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
	DeletedAt *gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

func (b *BaseEntity) BeforeCreate(tx *gorm.DB) error {
	if b.ID == uuid.Nil {
		b.ID = uuid.New()
	}
	return nil
}

func SetConfig(cfg *app.Config) {
	config = cfg
}

func SchemaName() string {
	if config == nil || config.DBSchemaName == "" {
		return ""
	}
	return fmt.Sprintf("%s.", config.DBSchemaName)
}
