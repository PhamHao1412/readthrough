package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
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

	prompt := fmt.Sprintf(`Bạn là một giáo viên dạy tiếng Anh nhiệt tình và chuyên nghiệp. Hãy phân tích đoạn văn/câu/từ sau bằng tiếng Việt:
---
"%s"
---

Yêu cầu nghiêm ngặt về định dạng (BẮT BUỘC):
1. BẮT ĐẦU câu trả lời NGAY LẬP TỨC bằng nội dung phân tích (bắt đầu bằng tiêu đề hoặc phần Dịch nghĩa). TUYỆT ĐỐI không có lời chào hỏi, giới thiệu xã giao hay dẫn dắt ban đầu (ví dụ: KHÔNG viết "Tuyệt vời...", "Chào mừng...", "Với vai trò...").
2. KẾT THÚC câu trả lời trực tiếp ở mục số 4. TUYỆT ĐỐI không có lời chúc, lời cảm ơn hay lời chào tạm biệt ở cuối (ví dụ: KHÔNG viết "Hy vọng...", "Chúc các bạn...", "Nếu có câu hỏi...").
3. QUY TẮC XUỐNG DÒNG KÉP (QUAN TRỌNG): Luôn sử dụng 2 dấu xuống dòng (double newlines / \n\n) để phân tách giữa tất cả các phần, đặc biệt là giữa tiêu đề (ví dụ: "### 1. Dịch nghĩa...") và các dòng nội dung hoặc danh sách tiếp theo bên dưới nó. TUYỆT ĐỐI không viết liền kề tiêu đề và nội dung chỉ bằng 1 dấu xuống dòng (\n) đơn lẻ.
4. Giải thích súc tích, ngắn gọn, đi thẳng vào ý chính để tối ưu hóa tốc độ phản hồi.

Định dạng kết quả dưới dạng Markdown gồm 4 phần sau (ngăn cách nhau bằng 2 dấu xuống dòng):

### 1. Dịch nghĩa tự nhiên (Translation)

[Dịch nghĩa tự nhiên của câu/đoạn văn/từ sang tiếng Việt một cách trôi chảy nhất]

### 2. Cấu trúc Ngữ pháp (Grammar Breakdown)

[Phân tích ngắn gọn cấu trúc ngữ pháp quan trọng hoặc từ loại, cách dùng của từ/câu này]

### 3. Từ vựng & Thành ngữ (Vocabulary & Idioms)

[Giải nghĩa ngắn gọn các từ/cụm từ quan trọng kèm ví dụ ngắn]

### 4. Viết lại câu (Alternative Phrasing)

[1-2 cách diễn đạt khác bằng tiếng Anh đơn giản hoặc trang trọng hơn để dễ ghi nhớ]`, trimmed)

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

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("[AIService] Gemini API error (status %d): %s", resp.StatusCode, string(body))
		return "", fmt.Errorf("gemini api returned status %d: %s", resp.StatusCode, string(body))
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
