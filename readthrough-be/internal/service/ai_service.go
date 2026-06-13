package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"readthrough-be/internal/entity"
	"readthrough-be/internal/repository"
	"strings"
	"time"
)

type IAIService interface {
	Explain(ctx context.Context, text string, contextSentence string, bookTitle string, bookAuthor string, pageNumber int) (string, error)
}

type AIService struct {
	apiKey            string
	model             string
	client            *http.Client
	aiExplanationRepo repository.IAIExplanationRepository
}

func NewAIService(apiKey, model string, aiExplanationRepo repository.IAIExplanationRepository) *AIService {
	if model == "" {
		model = "gpt-4o-mini"
	}
	return &AIService{
		apiKey: apiKey,
		model:  model,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		aiExplanationRepo: aiExplanationRepo,
	}
}

func (s *AIService) Explain(ctx context.Context, text string, contextSentence string, bookTitle string, bookAuthor string, pageNumber int) (string, error) {
	if s.apiKey == "" {
		return "", fmt.Errorf("openai API key is not configured")
	}

	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return "", nil
	}

	// Check DB cache instead of RAM cache
	cached, err := s.aiExplanationRepo.Get(ctx, trimmed, strings.TrimSpace(contextSentence))
	if err == nil && cached != nil {
		log.Printf("[AIService] Return DB-cached explanation for: %q", trimmed)
		return cached.Explanation, nil
	}

	var contextPart string
	if contextSentence != "" && contextSentence != trimmed {
		contextPart = fmt.Sprintf("Câu chứa từ này: \"%s\"", strings.TrimSpace(contextSentence))
	}

	var bookPart string
	if bookTitle != "" {
		if bookAuthor != "" && bookAuthor != "Tác giả ẩn danh" && bookAuthor != "Anonymous Author" {
			bookPart = fmt.Sprintf("Sách: \"%s\" (Tác giả: %s)", bookTitle, bookAuthor)
		} else {
			bookPart = fmt.Sprintf("Sách: \"%s\"", bookTitle)
		}
		if pageNumber > 0 {
			bookPart += fmt.Sprintf(", Trang: %d", pageNumber)
		}
	}

	prompt := fmt.Sprintf(`Bạn là một giáo viên dạy tiếng Anh nhiệt tình và chuyên nghiệp. Hãy phân tích từ/cụm từ sau bằng tiếng Việt:
---
Từ/cụm từ: "%[1]s"
%[2]s
%[3]s
---

BẮT BUỘC: Bạn phải ưu tiên giải nghĩa và phân tích chính xác theo ngữ cảnh của câu chứa từ này (nếu có ngữ cảnh). Hãy chỉ ra sắc thái nghĩa cụ thể trong ngữ cảnh này khác hoặc giống như thế nào với nghĩa thông dụng nhất của từ.

Yêu cầu nghiêm ngặt về định dạng (BẮT BUỘC):
1. BẮT ĐẦU câu trả lời NGAY LẬP TỨC bằng nội dung phân tích (bắt đầu bằng tiêu đề ### 1). TUYỆT ĐỐI không có lời chào hỏi, giới thiệu xã giao hay dẫn dắt ban đầu (ví dụ: KHÔNG viết "Tuyệt vời...", "Chào mừng...", "Với vai trò...").
2. KẾT THÚC câu trả lời trực tiếp ở mục số 4. TUYỆT ĐỐI không có lời chúc, lời cảm ơn hay lời chào tạm biệt ở cuối (ví dụ: KHÔNG viết "Hy vọng...", "Chúc các bạn...", "Nếu có câu hỏi...").
3. QUY TẮC XUỐNG DÒNG KÉP (QUAN TRỌNG): Luôn sử dụng 2 dấu xuống dòng (double newlines / \n\n) để phân tách giữa 4 tiêu đề chính. Tuy nhiên, đối với các mục bên trong danh sách (dấu gạch đầu dòng -), viết liền kề nhau chỉ bằng 1 dấu xuống dòng đơn (\n).
4. TUYỆT ĐỐI không chèn thêm dòng trống (\n\n) hoặc bất kỳ dấu gạch đầu dòng trống rỗng nào (như "- " không có nội dung) ở giữa các mục danh sách.
5. Giải thích súc tích nhưng đầy đủ, đi thẳng vào ý chính và BẮT BUỘC phải cung cấp đầy đủ ví dụ + dịch nghĩa sau dấu -> ở mục 3 và mục 4.

Định dạng kết quả dưới dạng Markdown gồm 4 phần sau (ngăn cách nhau bằng 2 dấu xuống dòng):

### 1. Dịch nghĩa tự nhiên (Translation)

[Dịch nghĩa của từ/cụm từ sang tiếng Việt một cách trôi chảy và phù hợp nhất với ngữ cảnh câu chứa nó. Nêu rõ từ loại và giải thích sắc thái nghĩa cụ thể trong ngữ cảnh này (ví dụ: nghĩa bóng, thành ngữ, hay nghĩa chuyên ngành)]

### 2. Cấu trúc Ngữ pháp & Ngữ cảnh (Grammar & Context Breakdown)

[Phân tích ngắn gọn vị trí, vai trò ngữ pháp của từ/cụm từ trong câu chứa nó. Giải thích tại sao trong ngữ cảnh này từ lại mang ý nghĩa đó]

### 3. Ví dụ áp dụng & Từ vựng liên quan (Examples & Vocabulary)

- **Ví dụ thực tế 1**: "[Câu ví dụ tiếng Anh áp dụng từ/cụm từ gốc này]" -> "[Dịch nghĩa của câu ví dụ sang tiếng Việt]"
- **Ví dụ thực tế 2**: "[Câu ví dụ tiếng Anh thứ hai áp dụng từ/cụm từ gốc này]" -> "[Dịch nghĩa của câu ví dụ sang tiếng Việt]"
- **[Cụm từ/Từ liên quan]**: [Ý nghĩa cụm từ hoặc từ phái sinh hay đi kèm với từ gốc] (Ví dụ: "[Câu ví dụ]" -> "[Dịch nghĩa]")

### 4. Cách diễn đạt thay thế (Alternative Phrasing)

Nếu đoạn phân tích trên là một từ đơn hoặc cụm từ ngắn, hãy cung cấp các từ đồng nghĩa (synonyms) kèm giải nghĩa tiếng Việt và BẮT BUỘC phải có ví dụ minh họa bằng tiếng Anh lẫn dịch nghĩa tiếng Việt. Ví dụ:
- **[Từ đồng nghĩa 1]**: [Ý nghĩa tiếng Việt] (Ví dụ: "[Câu ví dụ tiếng Anh]" -> "[Dịch nghĩa của câu ví dụ]")
- **[Từ đồng nghĩa 2]**: [Ý nghĩa tiếng Việt] (Ví dụ: "[Câu ví dụ tiếng Anh]" -> "[Dịch nghĩa của câu ví dụ]")

Nếu đoạn phân tích trên là một câu hoặc đoạn văn đầy đủ, hãy cung cấp các cách viết lại câu (alternative phrasing) kèm dịch nghĩa tương ứng bằng tiếng Việt. Ví dụ:
- "[Cách viết lại câu 1]" -> "[Dịch nghĩa]"
- "[Cách viết lại câu 2]" -> "[Dịch nghĩa]"`, trimmed, contextPart, bookPart)

	// Build request body
	reqBody := map[string]interface{}{
		"model": s.model,
		"messages": []map[string]interface{}{
			{
				"role":    "user",
				"content": prompt,
			},
		},
		"temperature": 0.2,
	}

	jsonBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	apiURL := "https://api.openai.com/v1/chat/completions"

	var resp *http.Response
	var body []byte
	maxAttempts := 3
	backoff := 500 * time.Millisecond

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBuffer(jsonBytes))
		if err != nil {
			return "", err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", s.apiKey))

		resp, err = s.client.Do(req)
		if err != nil {
			if attempt == maxAttempts {
				return "", err
			}
			log.Printf("[AIService] Attempt %d failed with network error: %v. Retrying in %v...", attempt, err, backoff)
			time.Sleep(backoff)
			backoff *= 2
			continue
		}

		body, err = io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			if attempt == maxAttempts {
				return "", err
			}
			log.Printf("[AIService] Attempt %d failed to read response body: %v. Retrying in %v...", attempt, err, backoff)
			time.Sleep(backoff)
			backoff *= 2
			continue
		}

		// Retry on 503 (Service Unavailable / High demand) or 429 (Too Many Requests / Rate limit)
		if resp.StatusCode == http.StatusServiceUnavailable || resp.StatusCode == http.StatusTooManyRequests {
			if attempt < maxAttempts {
				log.Printf("[AIService] Attempt %d failed with status %d (Temporary Error). Retrying in %v...", attempt, resp.StatusCode, backoff)
				time.Sleep(backoff)
				backoff *= 2
				continue
			}
		}

		if resp.StatusCode != http.StatusOK {
			log.Printf("[AIService] OpenAI API error (status %d): %s", resp.StatusCode, string(body))
			return "", fmt.Errorf("openai api returned status %d: %s", resp.StatusCode, string(body))
		}

		break
	}

	// Parse Response
	type openAIMessage struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	type openAIChoice struct {
		Index        int           `json:"index"`
		Message      openAIMessage `json:"message"`
		FinishReason string        `json:"finish_reason"`
	}
	type openAIResponse struct {
		ID      string         `json:"id"`
		Object  string         `json:"object"`
		Created int64          `json:"created"`
		Model   string         `json:"model"`
		Choices []openAIChoice `json:"choices"`
	}

	var openAIResp openAIResponse
	if err := json.Unmarshal(body, &openAIResp); err != nil {
		return "", err
	}

	if len(openAIResp.Choices) > 0 {
		explanation := openAIResp.Choices[0].Message.Content

		// Save the result to DB cache
		newExp := &entity.AIExplanation{
			Word:            trimmed,
			ContextSentence: strings.TrimSpace(contextSentence),
			Explanation:     explanation,
		}
		if err := s.aiExplanationRepo.Create(ctx, newExp); err != nil {
			log.Printf("[AIService] Failed to cache explanation in DB: %v", err)
		}

		return explanation, nil
	}

	return "", fmt.Errorf("failed to extract explanation from OpenAI response")
}
