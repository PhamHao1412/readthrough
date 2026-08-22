package v1

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"readthrough-be/internal/middleware"
	"readthrough-be/internal/model"
	"testing"

	"github.com/gin-gonic/gin"
)

type mockReadingCompanionService struct {
	processActionFunc func(ctx context.Context, req *model.ReadingCompanionRequest) (*model.ReadingCompanionResponse, error)
	hasCacheFunc      func(ctx context.Context, bookID, sectionTitle, action, content string) (bool, error)
}

func (m *mockReadingCompanionService) ProcessAction(ctx context.Context, req *model.ReadingCompanionRequest) (*model.ReadingCompanionResponse, error) {
	if m.processActionFunc != nil {
		return m.processActionFunc(ctx, req)
	}
	switch req.Action {
	case "summary":
		return &model.ReadingCompanionResponse{
			Action:       "summary",
			SectionTitle: req.SectionTitle,
			Summary: &model.SectionSummaryData{
				TLDR:         "A concise summary of the section.",
				KeyIdeas:     []string{"Key Idea 1", "Key Idea 2", "Key Idea 3"},
				MainTakeaway: "The main takeaway to remember.",
			},
			IsCached: false,
		}, nil
	case "explain":
		return &model.ReadingCompanionResponse{
			Action:       "explain",
			SectionTitle: req.SectionTitle,
			Explain: &model.SectionExplainData{
				Overview:            "Technical overview.",
				WhyItExists:         "Historical and engineering context.",
				TechnicalReasoning:  "Deep mechanics.",
				BackendApplications: "Production system architecture.",
				Tradeoffs:           "Latency vs throughput.",
				MarkdownContent:     "# Technical Explanation\n\nDeep dive into mechanics.",
			},
			IsCached: false,
		}, nil
	case "quiz":
		return &model.ReadingCompanionResponse{
			Action:       "quiz",
			SectionTitle: req.SectionTitle,
			Quiz: &model.SectionQuizData{
				Questions: []model.QuizQuestion{
					{
						ID:           1,
						Question:     "Why use WAL?",
						Options:      []string{"For faster disk sync", "For crash recovery", "For encryption", "For indexing"},
						CorrectIndex: 1,
						Explanation:  "WAL ensures atomicity and durability across sudden process crashes.",
					},
				},
			},
			IsCached: false,
		}, nil
	}
	return nil, nil
}

func (m *mockReadingCompanionService) ProcessActionStream(ctx context.Context, req *model.ReadingCompanionRequest, ch chan<- string) error {
	ch <- "mock stream chunk 1"
	ch <- " mock stream chunk 2"
	close(ch)
	return nil
}

func (m *mockReadingCompanionService) HasCache(ctx context.Context, bookID, sectionTitle, action, content string) (bool, error) {
	if m.hasCacheFunc != nil {
		return m.hasCacheFunc(ctx, bookID, sectionTitle, action, content)
	}
	return false, nil
}

func (m *mockReadingCompanionService) GetCachedStream(ctx context.Context, bookID, sectionTitle, action, content string) (string, error) {
	if action == "summary" {
		return "Cached summary content", nil
	}
	return "", nil
}

func TestReadingCompanionHandler_Summary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockSvc := &mockReadingCompanionService{}
	aiCreditManager := middleware.NewAICreditManager([]string{})
	handler := NewReadingCompanionHandler(mockSvc, aiCreditManager)

	r := gin.New()
	r.POST("/api/v1/ai/companion", handler.CompanionAction)

	reqBody, _ := json.Marshal(model.ReadingCompanionRequest{
		BookID:       "book-123",
		SectionTitle: "Chapter 1: Reliability",
		Content:      "Reliability means making systems work correctly even when things go wrong.",
		Action:       "summary",
		BookTitle:    "Designing Data-Intensive Applications",
	})

	req, _ := http.NewRequest(http.MethodPost, "/api/v1/ai/companion", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Succeeded bool                           `json:"succeeded"`
		Data      model.ReadingCompanionResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if !resp.Succeeded {
		t.Fatalf("expected succeeded = true")
	}
	if resp.Data.Summary == nil || resp.Data.Summary.TLDR == "" {
		t.Fatalf("expected summary data with TLDR")
	}
	if len(resp.Data.Summary.KeyIdeas) != 3 {
		t.Fatalf("expected 3 key ideas, got %d", len(resp.Data.Summary.KeyIdeas))
	}
}

func TestReadingCompanionHandler_Quiz(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockSvc := &mockReadingCompanionService{}
	aiCreditManager := middleware.NewAICreditManager([]string{})
	handler := NewReadingCompanionHandler(mockSvc, aiCreditManager)

	r := gin.New()
	r.POST("/api/v1/ai/companion", handler.CompanionAction)

	reqBody, _ := json.Marshal(model.ReadingCompanionRequest{
		BookID:       "book-123",
		SectionTitle: "Chapter 3: Storage and Retrieval",
		Content:      "Log-structured storage vs page-oriented storage engines.",
		Action:       "quiz",
		BookTitle:    "Designing Data-Intensive Applications",
	})

	req, _ := http.NewRequest(http.MethodPost, "/api/v1/ai/companion", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Succeeded bool                           `json:"succeeded"`
		Data      model.ReadingCompanionResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if resp.Data.Quiz == nil || len(resp.Data.Quiz.Questions) == 0 {
		t.Fatalf("expected quiz data with questions")
	}
	q := resp.Data.Quiz.Questions[0]
	if q.CorrectIndex != 1 {
		t.Fatalf("expected correct index 1, got %d", q.CorrectIndex)
	}
	if len(q.Options) != 4 {
		t.Fatalf("expected 4 options, got %d", len(q.Options))
	}
}

func TestReadingCompanionHandler_CheckCache(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mockSvc := &mockReadingCompanionService{}
	aiCreditManager := middleware.NewAICreditManager([]string{})
	handler := NewReadingCompanionHandler(mockSvc, aiCreditManager)

	r := gin.New()
	r.POST("/api/v1/ai/companion/check-cache", handler.CheckCache)

	reqBody, _ := json.Marshal(model.ReadingCompanionRequest{
		BookID:       "book-123",
		SectionTitle: "Chapter 1",
		Action:       "summary",
		Content:      "Some text content",
	})

	req, _ := http.NewRequest(http.MethodPost, "/api/v1/ai/companion/check-cache", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Succeeded bool `json:"succeeded"`
		Data      struct {
			HasCache bool   `json:"has_cache"`
			Content  string `json:"content"`
			Action   string `json:"action"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if !resp.Data.HasCache || resp.Data.Content != "Cached summary content" {
		t.Fatalf("expected has_cache=true and cached content, got %+v", resp.Data)
	}
}
