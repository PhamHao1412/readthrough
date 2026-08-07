package service

import (
	"context"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"os"
	"path/filepath"
	"readthrough-be/internal/entity"
	"readthrough-be/internal/repository"
	"readthrough-be/internal/storage"
	"strings"

	"github.com/google/uuid"
)

type IBookService interface {
	// UploadBookAsync saves the file locally, inserts the book with status "uploading",
	// returns immediately (202), and uploads to cloud storage in a background goroutine.
	// Used as fallback when presigned PUT is not supported (e.g. local storage).
	UploadBookAsync(ctx context.Context, userID uuid.UUID, file *multipart.FileHeader, title, author string) (*entity.Book, error)
	// PresignUpload creates a book record (status "uploading") and returns a
	// presigned PUT URL for the browser to upload directly to cloud storage.
	// Returns (book, uploadURL, isPresigned, error). When isPresigned=false,
	// the caller should fall back to the normal multipart upload.
	PresignUpload(ctx context.Context, userID uuid.UUID, filename string, fileSize int64, contentType, title, author string) (*entity.Book, string, bool, error)
	// FinalizeUpload marks a book as ready after the client confirms the direct
	// upload to R2 has completed successfully.
	FinalizeUpload(ctx context.Context, bookID uuid.UUID, userID uuid.UUID) (*entity.Book, error)
	// GetUploadProgress returns the current upload progress (0-100) for a book.
	GetUploadProgress(bookID uuid.UUID) int
	// CleanupOrphanedUploads marks books stuck in "uploading" as "failed".
	// Call once on server startup.
	CleanupOrphanedUploads(ctx context.Context) error
	ListBooks(ctx context.Context, userID uuid.UUID, search string) ([]entity.Book, error)
	GetBookByID(ctx context.Context, id uuid.UUID, userID uuid.UUID) (*entity.Book, error)
	DownloadBook(ctx context.Context, key string) (io.ReadCloser, int64, string, error)
	DownloadBookRange(ctx context.Context, key string, rangeHeader string) (io.ReadCloser, string, int64, string, int, error)
	GetBookDownloadURL(ctx context.Context, key string) (string, bool, error)
	// GetLocalPath returns the absolute local filesystem path for a stored file.
	// Returns ("", false, nil) when the backend does not store files locally (e.g. R2).
	GetLocalPath(ctx context.Context, key string) (string, bool, error)
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

// UploadBookAsync accepts the multipart file, buffers it to a local temp file
// (fast), inserts the book record with upload_status="uploading", responds to the
// client immediately (202), then uploads to cloud storage in a goroutine.
func (s *BookService) UploadBookAsync(ctx context.Context, userID uuid.UUID, fileHeader *multipart.FileHeader, title, author string) (*entity.Book, error) {
	bookID := uuid.New()
	fileExt := strings.ToLower(filepath.Ext(fileHeader.Filename))
	cleanExt := strings.TrimPrefix(fileExt, ".")
	fileName := bookID.String() + fileExt

	// ── 1. Buffer to a local temp file (fast — avoids blocking on network) ───
	src, err := fileHeader.Open()
	if err != nil {
		return nil, fmt.Errorf("open upload: %w", err)
	}
	defer src.Close()

	tmpFile, err := os.CreateTemp("", "readthrough-upload-*"+fileExt)
	if err != nil {
		return nil, fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	if _, err := io.Copy(tmpFile, src); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return nil, fmt.Errorf("buffer upload: %w", err)
	}
	tmpFile.Close()

	// ── 2. Build book record ─────────────────────────────────────────────────
	if title == "" {
		title = fileHeader.Filename
		if idx := strings.LastIndex(title, "."); idx != -1 {
			title = title[:idx]
		}
	}
	if author == "" {
		author = "Anonymous Author"
	}

	contentType := fileHeader.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	book := &entity.Book{
		BaseEntity:     entity.BaseEntity{ID: bookID},
		UserID:         userID,
		Title:          title,
		Author:         author,
		FilePath:       fileName, // final path; storage will confirm
		FileType:       cleanExt,
		FileSize:       fileHeader.Size,
		CurrentPage:    1,
		UploadStatus:   "uploading",
		UploadProgress: 0,
	}

	// ── 3. Insert book immediately ───────────────────────────────────────────
	if err := s.bookRepo.Create(ctx, book); err != nil {
		os.Remove(tmpPath)
		return nil, fmt.Errorf("create book record: %w", err)
	}

	// ── 4. Background goroutine: upload to cloud, update progress ────────────
	go s.runUpload(bookID, tmpPath, fileName, fileHeader.Size, contentType)

	return book, nil
}

// runUpload is the background goroutine that transfers a temp file to cloud storage.
func (s *BookService) runUpload(bookID uuid.UUID, tmpPath, storageKey string, size int64, contentType string) {
	defer os.Remove(tmpPath) // always clean up the temp file

	ctx := context.Background()
	GlobalUploadTracker.Set(bookID, 0)
	defer GlobalUploadTracker.Delete(bookID)

	f, err := os.Open(tmpPath)
	if err != nil {
		log.Printf("[Upload] failed to open temp file for book %s: %v", bookID, err)
		_ = s.bookRepo.UpdateUploadStatus(ctx, bookID, "failed", 0)
		return
	}
	defer f.Close()

	pr := NewProgressReader(f, size, func(pct int) {
		GlobalUploadTracker.Set(bookID, pct)
		// Persist progress to DB every 10% to survive brief disconnects
		if pct%10 == 0 {
			_ = s.bookRepo.UpdateUploadStatus(ctx, bookID, "uploading", pct)
		}
	})

	filePath, err := s.store.Upload(ctx, storageKey, pr, size, contentType)
	if err != nil {
		log.Printf("[Upload] R2 upload failed for book %s: %v", bookID, err)
		_ = s.bookRepo.UpdateUploadStatus(ctx, bookID, "failed", 0)
		return
	}

	// Update status to ready and persist the final storage path
	if err := s.bookRepo.UpdateUploadStatus(ctx, bookID, "ready", 100); err != nil {
		log.Printf("[Upload] failed to mark book %s as ready: %v", bookID, err)
	}
	log.Printf("[Upload] book %s uploaded successfully to %s", bookID, filePath)
}

// GetUploadProgress returns the live upload progress (0-100) from in-memory tracker.
func (s *BookService) GetUploadProgress(bookID uuid.UUID) int {
	return GlobalUploadTracker.Get(bookID)
}

// PresignUpload creates a book DB record with status="uploading" and returns a
// presigned PUT URL the browser can use to upload directly to R2 (no server proxy).
// When the storage backend does not support presigned PUT (e.g. local), isPresigned
// is false and the caller should fall back to the normal multipart upload.
func (s *BookService) PresignUpload(
	ctx context.Context,
	userID uuid.UUID,
	filename string,
	fileSize int64,
	contentType string,
	title string,
	author string,
) (*entity.Book, string, bool, error) {
	bookID := uuid.New()
	fileExt := strings.ToLower(filepath.Ext(filename))
	cleanExt := strings.TrimPrefix(fileExt, ".")
	storageKey := bookID.String() + fileExt

	if title == "" {
		title = filename
		if idx := strings.LastIndex(title, "."); idx != -1 {
			title = title[:idx]
		}
	}
	if author == "" {
		author = "Anonymous Author"
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	// Try to get a presigned PUT URL from the storage backend.
	uploadURL, isPresigned, err := s.store.PresignPutObject(ctx, storageKey, contentType)
	if err != nil {
		return nil, "", false, fmt.Errorf("presign put: %w", err)
	}

	book := &entity.Book{
		BaseEntity:     entity.BaseEntity{ID: bookID},
		UserID:         userID,
		Title:          title,
		Author:         author,
		FilePath:       storageKey,
		FileType:       cleanExt,
		FileSize:       fileSize,
		CurrentPage:    1,
		UploadStatus:   "uploading",
		UploadProgress: 0,
	}

	if err := s.bookRepo.Create(ctx, book); err != nil {
		return nil, "", false, fmt.Errorf("create book record: %w", err)
	}

	return book, uploadURL, isPresigned, nil
}

// FinalizeUpload marks a book as ready after the browser confirms the direct
// R2 upload has completed. Returns the updated book.
func (s *BookService) FinalizeUpload(ctx context.Context, bookID uuid.UUID, userID uuid.UUID) (*entity.Book, error) {
	if err := s.bookRepo.UpdateUploadStatus(ctx, bookID, "ready", 100); err != nil {
		return nil, fmt.Errorf("finalize upload: %w", err)
	}
	log.Printf("[Upload] book %s finalized (direct R2 upload confirmed)", bookID)
	return s.bookRepo.GetByID(ctx, bookID, userID)
}

// CleanupOrphanedUploads marks books stuck in "uploading" as "failed".
// Should be called once at server startup.
func (s *BookService) CleanupOrphanedUploads(ctx context.Context) error {
	return s.bookRepo.MarkOrphanedUploadsFailed(ctx)
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

func (s *BookService) DownloadBookRange(ctx context.Context, key string, rangeHeader string) (io.ReadCloser, string, int64, string, int, error) {
	return s.store.DownloadRange(ctx, key, rangeHeader)
}

func (s *BookService) GetBookDownloadURL(ctx context.Context, key string) (string, bool, error) {
	return s.store.GetPresignedURL(ctx, key)
}

func (s *BookService) GetLocalPath(ctx context.Context, key string) (string, bool, error) {
	return s.store.GetLocalPath(ctx, key)
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
