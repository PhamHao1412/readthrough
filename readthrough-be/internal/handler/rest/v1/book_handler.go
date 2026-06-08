package v1

import (
	"net/http"
	"path/filepath"
	"readthrough-be/internal/handler/rest/dto"
	"readthrough-be/internal/model"
	"readthrough-be/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type BookHandler struct {
	bookSvc service.IBookService
}

func NewBookHandler(bookSvc service.IBookService) *BookHandler {
	return &BookHandler{bookSvc: bookSvc}
}

func (h *BookHandler) Upload(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(nil))
		return
	}
	userID := userIDVal.(uuid.UUID)

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	title := c.PostForm("title")
	author := c.PostForm("author")

	book, err := h.bookSvc.UploadBook(c.Request.Context(), userID, file, title, author)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusCreated, dto.ResponseOK(book).WithMessage("Document uploaded successfully"))
}

func (h *BookHandler) List(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(nil))
		return
	}
	userID := userIDVal.(uuid.UUID)

	search := c.Query("search")

	list, err := h.bookSvc.ListBooks(c.Request.Context(), userID, search)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(list))
}

func (h *BookHandler) GetByID(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(nil))
		return
	}
	userID := userIDVal.(uuid.UUID)

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	book, err := h.bookSvc.GetBookByID(c.Request.Context(), id, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, dto.ResponseNotFound(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(book))
}

func (h *BookHandler) GetContent(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(nil))
		return
	}
	userID := userIDVal.(uuid.UUID)

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	book, err := h.bookSvc.GetBookByID(c.Request.Context(), id, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, dto.ResponseNotFound(err))
		return
	}

	// Get file stream from storage using the base filename as key
	fileName := filepath.Base(book.FilePath)
	reader, size, contentType, err := h.bookSvc.DownloadBook(c.Request.Context(), fileName)
	if err != nil {
		c.JSON(http.StatusNotFound, dto.ResponseNotFound(err))
		return
	}
	defer reader.Close()

	c.Header("Cache-Control", "private, max-age=31536000, immutable")
	c.DataFromReader(http.StatusOK, size, contentType, reader, nil)
}

func (h *BookHandler) GetDownloadURL(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(nil))
		return
	}
	userID := userIDVal.(uuid.UUID)

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	book, err := h.bookSvc.GetBookByID(c.Request.Context(), id, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, dto.ResponseNotFound(err))
		return
	}

	fileName := filepath.Base(book.FilePath)
	urlStr, isPresigned, err := h.bookSvc.GetBookDownloadURL(c.Request.Context(), fileName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(gin.H{
		"url":          urlStr,
		"is_presigned": isPresigned,
	}))
}

func (h *BookHandler) UpdateProgress(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(nil))
		return
	}
	userID := userIDVal.(uuid.UUID)

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	var req model.UpdateProgressRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	err = h.bookSvc.UpdateProgress(c.Request.Context(), id, userID, req.CurrentPage, req.EpubCFI, req.TotalPages)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(true).WithMessage("Reading progress synchronized"))
}

func (h *BookHandler) Delete(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(nil))
		return
	}
	userID := userIDVal.(uuid.UUID)

	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	err = h.bookSvc.DeleteBook(c.Request.Context(), id, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(true).WithMessage("Document deleted successfully"))
}
