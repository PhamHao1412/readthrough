package v1

import (
	"net/http"
	"readthrough-be/internal/handler/rest/dto"
	"readthrough-be/internal/model"
	"readthrough-be/internal/service"

	"github.com/gin-gonic/gin"
)

type AIHandler struct {
	aiSvc service.IAIService
}

func NewAIHandler(aiSvc service.IAIService) *AIHandler {
	return &AIHandler{aiSvc: aiSvc}
}

func (h *AIHandler) Explain(c *gin.Context) {
	var req model.ExplainRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	explanation, err := h.aiSvc.Explain(c.Request.Context(), req.Text)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	resp := model.ExplainResponse{
		Explanation: explanation,
	}

	c.JSON(http.StatusOK, dto.ResponseOK(resp))
}
