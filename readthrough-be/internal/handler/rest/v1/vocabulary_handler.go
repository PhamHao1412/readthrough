package v1

import (
	"net/http"
	"readthrough-be/internal/handler/rest/dto"
	"readthrough-be/internal/model"
	"readthrough-be/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type VocabularyHandler struct {
	vocabSvc service.IVocabularyService
}

func NewVocabularyHandler(vocabSvc service.IVocabularyService) *VocabularyHandler {
	return &VocabularyHandler{vocabSvc: vocabSvc}
}

func (h *VocabularyHandler) Save(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(nil))
		return
	}
	userID := userIDVal.(uuid.UUID)

	var req model.SaveVocabularyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	bookID, err := uuid.Parse(req.BookID)
	if err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	vocab, err := h.vocabSvc.SaveVocabulary(c.Request.Context(), bookID, userID, req.OriginalText, req.TranslatedText, req.IPA, req.PartOfSpeech, req.ContextSentence, req.AudioURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusCreated, dto.ResponseOK(vocab).WithMessage("Vocabulary saved to notebook"))
}

func (h *VocabularyHandler) List(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(nil))
		return
	}
	userID := userIDVal.(uuid.UUID)

	bookIDStr := c.Query("book_id")
	var bookID uuid.UUID
	if bookIDStr != "" {
		var err error
		bookID, err = uuid.Parse(bookIDStr)
		if err != nil {
			c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
			return
		}
	}

	search := c.Query("search")

	list, err := h.vocabSvc.ListVocabulary(c.Request.Context(), bookID, userID, search)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(list))
}

func (h *VocabularyHandler) Delete(c *gin.Context) {
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

	err = h.vocabSvc.DeleteVocabulary(c.Request.Context(), id, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(true).WithMessage("Vocabulary removed from notebook"))
}
