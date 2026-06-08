package v1

import (
	"net/http"
	"readthrough-be/internal/handler/rest/dto"

	"github.com/gin-gonic/gin"
)

type HealthHandler struct{}

func NewHealthHandler() *HealthHandler {
	return &HealthHandler{}
}

func (h *HealthHandler) HealthCheck(c *gin.Context) {
	c.JSON(http.StatusOK, dto.ResponseOK(dto.H{
		"status": "UP",
	}).WithMessage("Service is healthy"))
}
