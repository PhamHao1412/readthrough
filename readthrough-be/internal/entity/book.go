package entity

import "github.com/google/uuid"

type Book struct {
	BaseEntity
	UserID      uuid.UUID `gorm:"column:user_id;type:uuid;index" json:"user_id"`
	Title       string    `gorm:"column:title;type:text;not null" json:"title"`
	Author      string    `gorm:"column:author;type:text;not null" json:"author"`
	FilePath    string    `gorm:"column:file_path;type:text;not null" json:"file_path"`
	FileType    string    `gorm:"column:file_type;type:varchar(10);not null" json:"file_type"`
	FileSize    int64     `gorm:"column:file_size;type:bigint;not null" json:"file_size"`
	CoverURL    string    `gorm:"column:cover_url;type:text" json:"cover_url,omitempty"`
	CurrentPage int       `gorm:"column:current_page;type:integer;not null;default:1" json:"current_page"`
	EpubCFI     string    `gorm:"column:epub_cfi;type:text;default:''" json:"epub_cfi"`
	TotalPages  int       `gorm:"column:total_pages;type:integer;not null;default:0" json:"total_pages"`
}

func (Book) TableName() string {
	return SchemaName() + "books"
}
