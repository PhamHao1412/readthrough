package v1

import (
	"net/http"
	"readthrough-be/internal/handler/rest/dto"
	"readthrough-be/internal/model"
	"readthrough-be/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type BookmarkHandler struct {
	bookmarkSvc service.IBookmarkService
}

func NewBookmarkHandler(bookmarkSvc service.IBookmarkService) *BookmarkHandler {
	return &BookmarkHandler{bookmarkSvc: bookmarkSvc}
}

func (h *BookmarkHandler) Add(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(nil))
		return
	}
	userID := userIDVal.(uuid.UUID)

	bookIDStr := c.Param("id")
	bookID, err := uuid.Parse(bookIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	var req model.CreateBookmarkRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	page := req.Page
	if page < 1 && req.PageNumber >= 1 {
		page = req.PageNumber
	}
	if page < 1 {
		page = 1
	}

	bm, err := h.bookmarkSvc.AddBookmark(c.Request.Context(), userID, bookID, page, req.Title, req.Snippet)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusCreated, dto.ResponseOK(bm).WithMessage("Bookmark added"))
}

func (h *BookmarkHandler) ListByBook(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(nil))
		return
	}
	userID := userIDVal.(uuid.UUID)

	bookIDStr := c.Param("id")
	bookID, err := uuid.Parse(bookIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	list, err := h.bookmarkSvc.ListBookmarksByBook(c.Request.Context(), userID, bookID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(list))
}

func (h *BookmarkHandler) ListAll(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(nil))
		return
	}
	userID := userIDVal.(uuid.UUID)

	list, err := h.bookmarkSvc.ListAllBookmarks(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(list))
}

func (h *BookmarkHandler) Delete(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(nil))
		return
	}
	userID := userIDVal.(uuid.UUID)

	bookmarkIDStr := c.Param("bookmark_id")
	if bookmarkIDStr == "" {
		bookmarkIDStr = c.Param("id")
	}

	bookmarkID, err := uuid.Parse(bookmarkIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	if err := h.bookmarkSvc.DeleteBookmark(c.Request.Context(), userID, bookmarkID); err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(gin.H{"deleted": true}).WithMessage("Bookmark removed"))
}
