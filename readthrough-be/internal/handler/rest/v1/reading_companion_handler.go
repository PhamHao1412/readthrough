package v1

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"readthrough-be/internal/handler/rest/dto"
	"readthrough-be/internal/middleware"
	"readthrough-be/internal/model"
	"readthrough-be/internal/service"

	"github.com/gin-gonic/gin"
)

type ReadingCompanionHandler struct {
	companionSvc    service.IReadingCompanionService
	aiCreditManager *middleware.AICreditManager
}

func NewReadingCompanionHandler(companionSvc service.IReadingCompanionService, aiCreditManager *middleware.AICreditManager) *ReadingCompanionHandler {
	return &ReadingCompanionHandler{
		companionSvc:    companionSvc,
		aiCreditManager: aiCreditManager,
	}
}

func (h *ReadingCompanionHandler) CompanionAction(c *gin.Context) {
	var req model.ReadingCompanionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	hasCache, err := h.companionSvc.HasCache(c.Request.Context(), req.BookID, req.SectionTitle, req.Action, req.Content)
	if err != nil {
		log.Printf("[ReadingCompanionHandler] HasCache check error: %v", err)
	}

	if !hasCache && h.aiCreditManager != nil {
		if !h.aiCreditManager.AllowAI(c) {
			errLimit := errors.New("ai credit limit exceeded")
			c.JSON(http.StatusPaymentRequired, dto.Response{
				Succeeded: false,
				Title:     "ai credit limit exceeded",
				Message:   "AI reading companion credit limit exceeded. Contact admin or upgrade to premium.",
				SttCode:   http.StatusPaymentRequired,
				Errors:    []string{errLimit.Error()},
			})
			return
		}
	}

	resp, err := h.companionSvc.ProcessAction(c.Request.Context(), &req)
	if err != nil {
		log.Printf("[ReadingCompanionHandler] ProcessAction error: %v", err)
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(resp))
}

func (h *ReadingCompanionHandler) CompanionActionStream(c *gin.Context) {
	var req model.ReadingCompanionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	hasCache, err := h.companionSvc.HasCache(c.Request.Context(), req.BookID, req.SectionTitle, req.Action+"_stream", req.Content)
	if err != nil {
		log.Printf("[ReadingCompanionHandler] HasCache stream check error: %v", err)
	}

	if !hasCache && h.aiCreditManager != nil {
		if !h.aiCreditManager.AllowAI(c) {
			errLimit := errors.New("ai credit limit exceeded")
			c.JSON(http.StatusPaymentRequired, dto.Response{
				Succeeded: false,
				Title:     "ai credit limit exceeded",
				Message:   "AI reading companion credit limit exceeded. Contact admin or upgrade to premium.",
				SttCode:   http.StatusPaymentRequired,
				Errors:    []string{errLimit.Error()},
			})
			return
		}
	}

	ch := make(chan string, 20)

	// Set headers for Server-Sent Events (SSE)
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")
	c.Header("X-Accel-Buffering", "no")

	go func() {
		err := h.companionSvc.ProcessActionStream(c.Request.Context(), &req, ch)
		if err != nil {
			log.Printf("[ReadingCompanionHandler] Stream error: %v", err)
		}
	}()

	c.Stream(func(w io.Writer) bool {
		if token, ok := <-ch; ok {
			eventBytes, err := json.Marshal(map[string]string{"content": token})
			if err != nil {
				return false
			}
			_, err = w.Write([]byte(fmt.Sprintf("data: %s\n\n", string(eventBytes))))
			return err == nil
		}
		return false
	})
}

func (h *ReadingCompanionHandler) CheckCache(c *gin.Context) {
	var req model.ReadingCompanionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	cachedContent, err := h.companionSvc.GetCachedStream(c.Request.Context(), req.BookID, req.SectionTitle, req.Action, req.Content)
	if err != nil {
		log.Printf("[ReadingCompanionHandler] CheckCache error: %v", err)
	}

	c.JSON(http.StatusOK, dto.ResponseOK(gin.H{
		"has_cache": cachedContent != "",
		"content":   cachedContent,
		"action":    req.Action,
	}))
}
