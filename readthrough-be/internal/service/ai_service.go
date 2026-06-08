package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type IAIService interface {
	Explain(ctx context.Context, text string) (string, error)
}

type AIService struct {
	apiKey         string
	model          string
	apiVersion     string
	thinkingBudget int
	client         *http.Client
}

func NewAIService(apiKey, model, apiVersion string, thinkingBudget int) *AIService {
	return &AIService{
		apiKey:         apiKey,
		model:          model,
		apiVersion:     apiVersion,
		thinkingBudget: thinkingBudget,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (s *AIService) Explain(ctx context.Context, text string) (string, error) {
	if s.apiKey == "" {
		return "", fmt.Errorf("gemini API key is not configured")
	}

	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return "", nil
	}

	prompt := fmt.Sprintf(`Bạn là một giáo viên dạy tiếng Anh nhiệt tình và chuyên nghiệp. Hãy phân tích đoạn văn/câu sau bằng tiếng Việt để giúp người đọc hiểu rõ:
---
"%s"
---

Hãy định dạng kết quả dưới dạng Markdown đẹp mắt (sử dụng tiêu đề, danh sách, in đậm rõ ràng), cấu trúc phân tích gồm:

1. **Dịch nghĩa tự nhiên (Translation)**: Dịch nghĩa của câu/đoạn văn sang tiếng Việt một cách trôi chảy, tự nhiên nhất.
2. **Cấu trúc Ngữ pháp (Grammar Breakdown)**: Phân tích các cấu trúc ngữ pháp quan trọng, thì của động từ, mệnh đề hoặc cấu trúc đặc biệt được dùng.
3. **Từ vựng & Thành ngữ (Vocabulary & Idioms)**: Liệt kê các từ mới, cụm động từ (phrasal verbs), hoặc thành ngữ (idioms) xuất hiện kèm nghĩa và ví dụ ngắn.
4. **Viết lại câu (Alternative Phrasing)**: Viết lại câu này bằng tiếng Anh đơn giản hơn hoặc trang trọng hơn để người dùng dễ ghi nhớ.`, trimmed)

	generationConfig := map[string]interface{}{
		"temperature": 0.2,
	}

	// Only include thinkingConfig for models supporting reasoning (like gemini-2.5)
	if strings.Contains(s.model, "2.5") {
		generationConfig["thinkingConfig"] = map[string]interface{}{
			"thinkingBudget": s.thinkingBudget,
		}
	}

	// Build request body
	reqBody := map[string]interface{}{
		"contents": []map[string]interface{}{
			{
				"parts": []map[string]interface{}{
					{"text": prompt},
				},
			},
		},
		"generationConfig": generationConfig,
	}

	jsonBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	apiURL := fmt.Sprintf(
		"https://generativelanguage.googleapis.com/%s/models/%s:generateContent?key=%s",
		s.apiVersion,
		s.model,
		s.apiKey,
	)

	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBuffer(jsonBytes))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("gemini api returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	// Parse Response
	type geminiPart struct {
		Text string `json:"text"`
	}
	type geminiContent struct {
		Parts []geminiPart `json:"parts"`
	}
	type geminiCandidate struct {
		Content geminiContent `json:"content"`
	}
	type geminiResponse struct {
		Candidates []geminiCandidate `json:"candidates"`
	}

	var geminiResp geminiResponse
	if err := json.Unmarshal(body, &geminiResp); err != nil {
		return "", err
	}

	if len(geminiResp.Candidates) > 0 && len(geminiResp.Candidates[0].Content.Parts) > 0 {
		return geminiResp.Candidates[0].Content.Parts[0].Text, nil
	}

	return "", fmt.Errorf("failed to extract explanation from Gemini response")
}
