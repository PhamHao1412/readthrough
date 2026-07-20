package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"path/filepath"
	"readthrough-be/internal/entity"
	"readthrough-be/internal/repository"
	"readthrough-be/internal/storage"
	"strings"

	"github.com/google/uuid"
)

type IBookService interface {
	UploadBook(ctx context.Context, userID uuid.UUID, file *multipart.FileHeader, title string, author string) (*entity.Book, error)
	ListBooks(ctx context.Context, userID uuid.UUID, search string) ([]entity.Book, error)
	GetBookByID(ctx context.Context, id uuid.UUID, userID uuid.UUID) (*entity.Book, error)
	DownloadBook(ctx context.Context, key string) (io.ReadCloser, int64, string, error)
	GetBookDownloadURL(ctx context.Context, key string) (string, bool, error)
	DeleteBook(ctx context.Context, id uuid.UUID, userID uuid.UUID) error
	UpdateProgress(ctx context.Context, id uuid.UUID, userID uuid.UUID, page int, cfi string, totalPages int) error
	UpdateBookContent(ctx context.Context, id uuid.UUID, userID uuid.UUID, content string) error
}

type BookService struct {
	baseRepo repository.IBaseRepository
	bookRepo repository.IBookRepository
	store    storage.Storage
}

func NewBookService(baseRepo repository.IBaseRepository, bookRepo repository.IBookRepository, store storage.Storage) *BookService {
	return &BookService{
		baseRepo: baseRepo,
		bookRepo: bookRepo,
		store:    store,
	}
}

func (s *BookService) UploadBook(ctx context.Context, userID uuid.UUID, fileHeader *multipart.FileHeader, title string, author string) (*entity.Book, error) {
	// Generate UUID filename
	bookID := uuid.New()
	fileExt := strings.ToLower(filepath.Ext(fileHeader.Filename))
	cleanExt := strings.TrimPrefix(fileExt, ".")

	fileName := bookID.String() + fileExt

	// Save to storage
	src, err := fileHeader.Open()
	if err != nil {
		return nil, err
	}
	defer src.Close()

	contentBytes, err := io.ReadAll(src)
	if err != nil {
		return nil, err
	}

	actualReadSize := int64(len(contentBytes))
	fmt.Printf("[UploadBookDebug] fileHeader.Size: %d, actualReadSize: %d, Filename: %s\n", fileHeader.Size, actualReadSize, fileHeader.Filename)

	contentType := fileHeader.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	contentReader := bytes.NewReader(contentBytes)
	filePath, err := s.store.Upload(ctx, fileName, contentReader, actualReadSize, contentType)
	if err != nil {
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
		s.store.Delete(ctx, fileName)
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

func (s *BookService) DownloadBook(ctx context.Context, key string) (io.ReadCloser, int64, string, error) {
	return s.store.Download(ctx, key)
}

func (s *BookService) GetBookDownloadURL(ctx context.Context, key string) (string, bool, error) {
	return s.store.GetPresignedURL(ctx, key)
}

func (s *BookService) UpdateProgress(ctx context.Context, id uuid.UUID, userID uuid.UUID, page int, cfi string, totalPages int) error {
	return s.bookRepo.UpdateProgress(ctx, id, userID, page, cfi, totalPages)
}

func (s *BookService) DeleteBook(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	book, err := s.bookRepo.GetByID(ctx, id, userID)
	if err != nil {
		return err
	}

	// 1. Delete from database (soft-delete)
	if err := s.bookRepo.Delete(ctx, id, userID); err != nil {
		return err
	}

	// 2. Delete from storage (R2/Local)
	fileName := filepath.Base(book.FilePath)
	_ = s.store.Delete(ctx, fileName) // ignore error to avoid failing the DB operation

	return nil
}

func (s *BookService) UpdateBookContent(ctx context.Context, id uuid.UUID, userID uuid.UUID, content string) error {
	book, err := s.bookRepo.GetByID(ctx, id, userID)
	if err != nil {
		return err
	}

	fileName := filepath.Base(book.FilePath)
	contentReader := strings.NewReader(content)
	contentSize := int64(len(content))

	contentType := "text/plain"
	if book.FileType == "md" {
		contentType = "text/markdown"
	} else if book.FileType == "pdf" {
		contentType = "application/pdf"
	} else if book.FileType == "epub" {
		contentType = "application/epub+zip"
	}

	_, err = s.store.Upload(ctx, fileName, contentReader, contentSize, contentType)
	if err != nil {
		return err
	}

	return s.bookRepo.UpdateSize(ctx, id, userID, contentSize)
}
