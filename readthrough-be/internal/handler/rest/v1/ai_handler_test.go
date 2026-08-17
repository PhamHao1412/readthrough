package v1

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"readthrough-be/internal/middleware"
	"readthrough-be/internal/model"
	"readthrough-be/pkg/security"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type mockAIService struct {
	hasCacheFunc func(ctx context.Context, text string, contextSentence string) (bool, error)
}

func (m *mockAIService) Explain(ctx context.Context, text string, contextSentence string, bookTitle string, bookAuthor string, pageNumber int) (string, error) {
	return "mock explanation", nil
}

func (m *mockAIService) ExplainStream(ctx context.Context, text string, contextSentence string, bookTitle string, bookAuthor string, pageNumber int, ch chan<- string) error {
	ch <- "mock stream explanation"
	close(ch)
	return nil
}

func (m *mockAIService) HasCache(ctx context.Context, text string, contextSentence string) (bool, error) {
	if m.hasCacheFunc != nil {
		return m.hasCacheFunc(ctx, text, contextSentence)
	}
	return false, nil
}

// closeNotifyingRecorder wraps httptest.ResponseRecorder and implements http.CloseNotifier
// to prevent Gin c.Stream from panicking in unit tests.
type closeNotifyingRecorder struct {
	*httptest.ResponseRecorder
	closed chan bool
}

func newCloseNotifyingRecorder() *closeNotifyingRecorder {
	return &closeNotifyingRecorder{
		ResponseRecorder: httptest.NewRecorder(),
		closed:           make(chan bool, 1),
	}
}

func (c *closeNotifyingRecorder) CloseNotify() <-chan bool {
	return c.closed
}

func TestAIHandler_Explain_LimitAndCacheBypass(t *testing.T) {
	gin.SetMode(gin.TestMode)
	security.Init("test_secret_key_at_least_32_characters_long_12345")

	whitelistedUUID := uuid.New().String()
	normalUUID := uuid.New().String()

	t.Run("Anonymous User - Without Cache - Limit Exceeded", func(t *testing.T) {
		manager := middleware.NewAICreditManager([]string{whitelistedUUID})
		mockSvc := &mockAIService{
			hasCacheFunc: func(ctx context.Context, text string, contextSentence string) (bool, error) {
				return false, nil // No cache
			},
		}

		handler := NewAIHandler(mockSvc, manager)
		r := gin.New()
		r.POST("/explain", handler.Explain)

		// First call - OK
		w1 := newCloseNotifyingRecorder()
		reqBody, _ := json.Marshal(model.ExplainRequest{Text: "hello", ContextSentence: "hello world"})
		req1, _ := http.NewRequest(http.MethodPost, "/explain", bytes.NewBuffer(reqBody))
		req1.RemoteAddr = "1.2.3.4:1234"
		r.ServeHTTP(w1, req1)
		if w1.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d", w1.Code)
		}

		// Second call with same IP - Blocked
		w2 := newCloseNotifyingRecorder()
		req2, _ := http.NewRequest(http.MethodPost, "/explain", bytes.NewBuffer(reqBody))
		req2.RemoteAddr = "1.2.3.4:1234"
		r.ServeHTTP(w2, req2)
		if w2.Code != http.StatusPaymentRequired {
			t.Fatalf("Expected 402, got %d", w2.Code)
		}
	})

	t.Run("Anonymous User - With Cache - Bypass Limit", func(t *testing.T) {
		manager := middleware.NewAICreditManager([]string{whitelistedUUID})
		mockSvc := &mockAIService{
			hasCacheFunc: func(ctx context.Context, text string, contextSentence string) (bool, error) {
				return true, nil // Cache exists
			},
		}

		handler := NewAIHandler(mockSvc, manager)
		r := gin.New()
		r.POST("/explain", handler.Explain)

		// Both calls should succeed because cache exists, bypassing limit
		for i := 0; i < 3; i++ {
			w := newCloseNotifyingRecorder()
			reqBody, _ := json.Marshal(model.ExplainRequest{Text: "hello", ContextSentence: "hello world"})
			req, _ := http.NewRequest(http.MethodPost, "/explain", bytes.NewBuffer(reqBody))
			req.RemoteAddr = "1.2.3.5:1234"
			r.ServeHTTP(w, req)
			if w.Code != http.StatusOK {
				t.Fatalf("Expected 200 on call %d, got %d", i+1, w.Code)
			}
		}
	})

	t.Run("Normal User - Without Cache - Limit Exceeded", func(t *testing.T) {
		manager := middleware.NewAICreditManager([]string{whitelistedUUID})
		mockSvc := &mockAIService{
			hasCacheFunc: func(ctx context.Context, text string, contextSentence string) (bool, error) {
				return false, nil // No cache
			},
		}

		handler := NewAIHandler(mockSvc, manager)
		r := gin.New()
		r.POST("/explain", handler.Explain)

		normalUserID, _ := uuid.Parse(normalUUID)
		token, _ := security.GenerateAccessToken(normalUserID)

		// First call - OK
		w1 := newCloseNotifyingRecorder()
		reqBody, _ := json.Marshal(model.ExplainRequest{Text: "hello", ContextSentence: "hello world"})
		req1, _ := http.NewRequest(http.MethodPost, "/explain", bytes.NewBuffer(reqBody))
		req1.Header.Set("Authorization", "Bearer "+token)
		r.ServeHTTP(w1, req1)
		if w1.Code != http.StatusOK {
			t.Fatalf("Expected 200, got %d", w1.Code)
		}

		// Second call - Blocked
		w2 := newCloseNotifyingRecorder()
		req2, _ := http.NewRequest(http.MethodPost, "/explain", bytes.NewBuffer(reqBody))
		req2.Header.Set("Authorization", "Bearer "+token)
		r.ServeHTTP(w2, req2)
		if w2.Code != http.StatusPaymentRequired {
			t.Fatalf("Expected 402, got %d", w2.Code)
		}
	})

	t.Run("Normal User - With Cache - Bypass Limit", func(t *testing.T) {
		manager := middleware.NewAICreditManager([]string{whitelistedUUID})
		mockSvc := &mockAIService{
			hasCacheFunc: func(ctx context.Context, text string, contextSentence string) (bool, error) {
				return true, nil // Cache exists
			},
		}

		handler := NewAIHandler(mockSvc, manager)
		r := gin.New()
		r.POST("/explain", handler.Explain)

		normalUserID, _ := uuid.Parse(normalUUID)
		token, _ := security.GenerateAccessToken(normalUserID)

		// Both calls should succeed
		for i := 0; i < 3; i++ {
			w := newCloseNotifyingRecorder()
			reqBody, _ := json.Marshal(model.ExplainRequest{Text: "hello", ContextSentence: "hello world"})
			req, _ := http.NewRequest(http.MethodPost, "/explain", bytes.NewBuffer(reqBody))
			req.Header.Set("Authorization", "Bearer "+token)
			r.ServeHTTP(w, req)
			if w.Code != http.StatusOK {
				t.Fatalf("Expected 200 on call %d, got %d", i+1, w.Code)
			}
		}
	})
}
