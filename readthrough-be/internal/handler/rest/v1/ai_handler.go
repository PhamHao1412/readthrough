package v1

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
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

	ch := make(chan string, 10)

	// Set headers for Server-Sent Events (SSE)
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")

	go func() {
		err := h.aiSvc.ExplainStream(c.Request.Context(), req.Text, req.ContextSentence, req.BookTitle, req.BookAuthor, req.PageNumber, ch)
		if err != nil {
			log.Printf("[AIHandler] Stream error: %v", err)
		}
	}()

	c.Stream(func(w io.Writer) bool {
		if token, ok := <-ch; ok {
			eventBytes, err := json.Marshal(map[string]string{"content": token})
			if err != nil {
				log.Printf("[AIHandler] Failed to marshal token: %v", err)
				return false
			}
			_, err = w.Write([]byte(fmt.Sprintf("data: %s\n\n", string(eventBytes))))
			if err != nil {
				log.Printf("[AIHandler] Failed to write token stream: %v", err)
				return false
			}
			return true
		}
		return false
	})
}
