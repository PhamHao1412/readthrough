package entity

import "github.com/google/uuid"

type Bookmark struct {
	BaseEntity
	UserID     uuid.UUID `gorm:"column:user_id;type:uuid;not null;index" json:"user_id"`
	BookID     uuid.UUID `gorm:"column:book_id;type:uuid;not null;index" json:"book_id"`
	PageNumber int       `gorm:"column:page_number;not null" json:"page_number"`
	Title      string    `gorm:"column:title;type:text" json:"title"`
	Snippet    string    `gorm:"column:snippet;type:text" json:"snippet"`
}

func (Bookmark) TableName() string {
	return SchemaName() + "bookmarks"
}
