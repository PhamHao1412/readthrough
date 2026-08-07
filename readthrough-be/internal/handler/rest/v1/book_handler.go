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

	// UploadBookAsync: saves to temp, inserts DB with status="uploading",
	// returns immediately while a goroutine handles the actual cloud upload.
	book, err := h.bookSvc.UploadBookAsync(c.Request.Context(), userID, file, title, author)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	// 202 Accepted: request received, upload processing in background.
	c.JSON(http.StatusAccepted, dto.ResponseOK(book).WithMessage("Upload started. The document will be ready shortly."))
}

// PresignUpload creates a book record and returns a pre-signed PUT URL for the
// browser to upload the file directly to R2, bypassing the server entirely.
// When the storage backend does not support presigned PUT (local dev), is_presigned
// is false and the client should fall back to the normal multipart upload.
func (h *BookHandler) PresignUpload(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(nil))
		return
	}
	userID := userIDVal.(uuid.UUID)

	var req model.PresignUploadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	book, uploadURL, isPresigned, err := h.bookSvc.PresignUpload(
		c.Request.Context(), userID,
		req.Filename, req.FileSize, req.ContentType,
		req.Title, req.Author,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(gin.H{
		"book":         book,
		"upload_url":   uploadURL,
		"is_presigned": isPresigned,
	}))
}

// FinalizeUpload marks a book as ready after the browser has successfully PUT
// the file to R2 via the presigned URL.
func (h *BookHandler) FinalizeUpload(c *gin.Context) {
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

	book, err := h.bookSvc.FinalizeUpload(c.Request.Context(), id, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(book).WithMessage("Document is ready."))
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

	fileName := filepath.Base(book.FilePath)

	// ── Local storage: http.ServeFile handles Range / 206 natively ──────────
	if localPath, ok, _ := h.bookSvc.GetLocalPath(c.Request.Context(), fileName); ok {
		http.ServeFile(c.Writer, c.Request, localPath)
		return
	}

	// ── Cloud storage (R2/S3): proxy Range header to storage backend ─────────
	// PDF.js sends "Range: bytes=X-Y" for each page chunk. We forward that to
	// R2's GetObject which returns 206 Partial Content, then relay it back.
	rangeHeader := c.GetHeader("Range")
	body, contentRange, size, contentType, status, err := h.bookSvc.DownloadBookRange(c.Request.Context(), fileName, rangeHeader)
	if err != nil {
		c.JSON(http.StatusNotFound, dto.ResponseNotFound(err))
		return
	}
	defer body.Close()

	c.Header("Accept-Ranges", "bytes")
	c.Header("Cache-Control", "private, max-age=3600")
	if contentRange != "" {
		c.Header("Content-Range", contentRange)
	}
	c.DataFromReader(status, size, contentType, body, nil)
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

func (h *BookHandler) UpdateContent(c *gin.Context) {
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

	var req model.UpdateBookContentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	err = h.bookSvc.UpdateBookContent(c.Request.Context(), id, userID, req.Content)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(true).WithMessage("Document content updated successfully"))
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
