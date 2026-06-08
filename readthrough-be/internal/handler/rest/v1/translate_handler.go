package v1

import (
	"net/http"
	"readthrough-be/internal/handler/rest/dto"
	"readthrough-be/internal/model"
	"readthrough-be/internal/service"

	"github.com/gin-gonic/gin"
)

type TranslateHandler struct {
	translateSvc service.ITranslateService
}

func NewTranslateHandler(translateSvc service.ITranslateService) *TranslateHandler {
	return &TranslateHandler{translateSvc: translateSvc}
}

func (h *TranslateHandler) Translate(c *gin.Context) {
	var req model.TranslateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	translated, err := h.translateSvc.Translate(c.Request.Context(), req.Text)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	resp := model.TranslateResponse{
		TranslatedText: translated,
	}

	c.JSON(http.StatusOK, dto.ResponseOK(resp))
}
