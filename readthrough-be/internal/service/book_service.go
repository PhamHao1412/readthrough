package service

import (
	"context"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"readthrough-be/internal/entity"
	"readthrough-be/internal/repository"
	"strings"

	"github.com/google/uuid"
)

type IBookService interface {
	UploadBook(ctx context.Context, userID uuid.UUID, file *multipart.FileHeader, title string, author string) (*entity.Book, error)
	ListBooks(ctx context.Context, userID uuid.UUID, search string) ([]entity.Book, error)
	GetBookByID(ctx context.Context, id uuid.UUID, userID uuid.UUID) (*entity.Book, error)
	UpdateProgress(ctx context.Context, id uuid.UUID, userID uuid.UUID, page int, cfi string, totalPages int) error
}

type BookService struct {
	baseRepo repository.IBaseRepository
	bookRepo repository.IBookRepository
}

func NewBookService(baseRepo repository.IBaseRepository, bookRepo repository.IBookRepository) *BookService {
	return &BookService{
		baseRepo: baseRepo,
		bookRepo: bookRepo,
	}
}

func (s *BookService) UploadBook(ctx context.Context, userID uuid.UUID, fileHeader *multipart.FileHeader, title string, author string) (*entity.Book, error) {
	// Create uploads dir if it doesn't exist
	uploadDir := "uploads"
	if _, err := os.Stat(uploadDir); os.IsNotExist(err) {
		if err := os.MkdirAll(uploadDir, 0755); err != nil {
			return nil, err
		}
	}

	// Generate UUID filename
	bookID := uuid.New()
	fileExt := strings.ToLower(filepath.Ext(fileHeader.Filename))
	cleanExt := strings.TrimPrefix(fileExt, ".")

	fileName := bookID.String() + fileExt
	filePath := filepath.Join(uploadDir, fileName)

	// Save to disk
	src, err := fileHeader.Open()
	if err != nil {
		return nil, err
	}
	defer src.Close()

	dst, err := os.Create(filePath)
	if err != nil {
		return nil, err
	}
	defer dst.Close()

	if _, err = io.Copy(dst, src); err != nil {
		return nil, err
	}

	// Default values
	if title == "" {
		title = fileHeader.Filename
		// strip extension
		if idx := strings.LastIndex(title, "."); idx != -1 {
			title = title[:idx]
		}
	}
	if author == "" {
		author = "Anonymous Author"
	}

	book := &entity.Book{
		BaseEntity: entity.BaseEntity{
			ID: bookID,
		},
		UserID:      userID,
		Title:       title,
		Author:      author,
		FilePath:    filePath,
		FileType:    cleanExt,
		FileSize:    fileHeader.Size,
		CurrentPage: 1,
		EpubCFI:     "",
		TotalPages:  0,
	}

	if err := s.bookRepo.Create(ctx, book); err != nil {
		// Clean up file if DB insert fails
		os.Remove(filePath)
		return nil, err
	}

	return book, nil
}

func (s *BookService) ListBooks(ctx context.Context, userID uuid.UUID, search string) ([]entity.Book, error) {
	return s.bookRepo.List(ctx, userID, search)
}

func (s *BookService) GetBookByID(ctx context.Context, id uuid.UUID, userID uuid.UUID) (*entity.Book, error) {
	return s.bookRepo.GetByID(ctx, id, userID)
}

func (s *BookService) UpdateProgress(ctx context.Context, id uuid.UUID, userID uuid.UUID, page int, cfi string, totalPages int) error {
	return s.bookRepo.UpdateProgress(ctx, id, userID, page, cfi, totalPages)
}
