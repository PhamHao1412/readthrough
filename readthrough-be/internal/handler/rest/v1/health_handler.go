package v1

import (
	"net/http"
	"readthrough-be/internal/handler/rest/dto"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type HealthHandler struct {
	db *gorm.DB
}

func NewHealthHandler(db *gorm.DB) *HealthHandler {
	return &HealthHandler{db: db}
}

type DBHealth struct {
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

type HealthReport struct {
	Status   string   `json:"status"`
	Database DBHealth `json:"database"`
}

func (h *HealthHandler) HealthCheck(c *gin.Context) {
	dbStatus := "UP"
	var dbError string

	if h.db != nil {
		sqlDB, err := h.db.DB()
		if err != nil {
			dbStatus = "DOWN"
			dbError = err.Error()
		} else {
			err = sqlDB.Ping()
			if err != nil {
				dbStatus = "DOWN"
				dbError = err.Error()
			}
		}
	} else {
		dbStatus = "DOWN"
		dbError = "database connection is nil"
	}

	report := HealthReport{
		Status: "UP",
		Database: DBHealth{
			Status: dbStatus,
			Error:  dbError,
		},
	}

	if dbStatus == "DOWN" {
		report.Status = "DOWN"
		c.JSON(http.StatusServiceUnavailable, dto.Response{
			Succeeded: false,
			Title:     "service unavailable",
			Message:   "Service is unhealthy",
			SttCode:   http.StatusServiceUnavailable,
			Data:      report,
		})
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(report).WithMessage("Service is healthy"))
}
