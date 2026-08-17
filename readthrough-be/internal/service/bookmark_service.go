package service

import (
	"context"
	"fmt"
	"readthrough-be/internal/entity"
	"readthrough-be/internal/repository"
	"strings"

	"github.com/google/uuid"
)

type IBookmarkService interface {
	AddBookmark(ctx context.Context, userID uuid.UUID, bookID uuid.UUID, page int, title string, snippet string) (*entity.Bookmark, error)
	ListBookmarksByBook(ctx context.Context, userID uuid.UUID, bookID uuid.UUID) ([]entity.Bookmark, error)
	ListAllBookmarks(ctx context.Context, userID uuid.UUID) ([]entity.Bookmark, error)
	DeleteBookmark(ctx context.Context, userID uuid.UUID, id uuid.UUID) error
	DeleteBookmarkByPage(ctx context.Context, userID uuid.UUID, bookID uuid.UUID, page int) error
}

type BookmarkService struct {
	bookmarkRepo repository.IBookmarkRepository
}

func NewBookmarkService(bookmarkRepo repository.IBookmarkRepository) *BookmarkService {
	return &BookmarkService{
		bookmarkRepo: bookmarkRepo,
	}
}

func (s *BookmarkService) AddBookmark(ctx context.Context, userID uuid.UUID, bookID uuid.UUID, page int, title string, snippet string) (*entity.Bookmark, error) {
	if page < 1 {
		page = 1
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = fmt.Sprintf("Trang %d", page)
	}

	// Check if already bookmarked on this page
	existing, err := s.bookmarkRepo.GetByPage(ctx, userID, bookID, page)
	if err == nil && existing != nil {
		existing.Title = title
		existing.Snippet = snippet
		return existing, nil
	}

	bm := &entity.Bookmark{
		UserID:     userID,
		BookID:     bookID,
		PageNumber: page,
		Title:      title,
		Snippet:    snippet,
	}

	if err := s.bookmarkRepo.Create(ctx, bm); err != nil {
		return nil, err
	}

	return bm, nil
}

func (s *BookmarkService) ListBookmarksByBook(ctx context.Context, userID uuid.UUID, bookID uuid.UUID) ([]entity.Bookmark, error) {
	return s.bookmarkRepo.ListByBookID(ctx, userID, bookID)
}

func (s *BookmarkService) ListAllBookmarks(ctx context.Context, userID uuid.UUID) ([]entity.Bookmark, error) {
	return s.bookmarkRepo.ListAllByUserID(ctx, userID)
}

func (s *BookmarkService) DeleteBookmark(ctx context.Context, userID uuid.UUID, id uuid.UUID) error {
	return s.bookmarkRepo.Delete(ctx, userID, id)
}

func (s *BookmarkService) DeleteBookmarkByPage(ctx context.Context, userID uuid.UUID, bookID uuid.UUID, page int) error {
	return s.bookmarkRepo.DeleteByPage(ctx, userID, bookID, page)
}
