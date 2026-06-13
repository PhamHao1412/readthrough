package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"readthrough-be/internal/entity"
	"readthrough-be/internal/repository"
	"readthrough-be/internal/utils"
	"strings"
	"time"
)

type IAIService interface {
	Explain(ctx context.Context, text string, contextSentence string, bookTitle string, bookAuthor string, pageNumber int) (string, error)
	ExplainStream(ctx context.Context, text string, contextSentence string, bookTitle string, bookAuthor string, pageNumber int, ch chan<- string) error
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

	prompt := fmt.Sprintf(utils.ExplainPromptTemplate, trimmed, contextPart, bookPart)

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

func (s *AIService) ExplainStream(ctx context.Context, text string, contextSentence string, bookTitle string, bookAuthor string, pageNumber int, ch chan<- string) error {
	defer close(ch)

	if s.apiKey == "" {
		return fmt.Errorf("openai API key is not configured")
	}

	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil
	}

	// 1. Check DB Cache first
	cached, err := s.aiExplanationRepo.Get(ctx, trimmed, strings.TrimSpace(contextSentence))
	if err == nil && cached != nil {
		log.Printf("[AIService] Return DB-cached explanation for stream: %q", trimmed)
		ch <- "[CACHED]" + cached.Explanation
		return nil
	}

	// 2. Build prompt
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

	prompt := fmt.Sprintf(utils.ExplainPromptTemplate, trimmed, contextPart, bookPart)

	// 3. Build request body with stream: true
	reqBody := map[string]interface{}{
		"model": s.model,
		"messages": []map[string]interface{}{
			{
				"role":    "user",
				"content": prompt,
			},
		},
		"temperature": 0.2,
		"stream":      true,
	}

	jsonBytes, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}

	apiURL := "https://api.openai.com/v1/chat/completions"
	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBuffer(jsonBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", s.apiKey))

	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("openai api returned status %d: %s", resp.StatusCode, string(body))
	}

	// 4. Stream reading loop
	var fullTextBuilder strings.Builder
	reader := bufio.NewReader(resp.Body)

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			return err
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		// Parse stream chunk
		type chunkChoice struct {
			Delta struct {
				Content string `json:"content"`
			} `json:"delta"`
		}
		type chunkResponse struct {
			Choices []chunkChoice `json:"choices"`
		}

		var chunk chunkResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			log.Printf("[AIService] Failed to parse stream chunk: %v", err)
			continue
		}

		if len(chunk.Choices) > 0 {
			content := chunk.Choices[0].Delta.Content
			if content != "" {
				fullTextBuilder.WriteString(content)
				// Send content token to channel
				ch <- content
			}
		}
	}

	// 5. Cache completed explanation to DB
	explanation := fullTextBuilder.String()
	if strings.TrimSpace(explanation) != "" {
		newExp := &entity.AIExplanation{
			Word:            trimmed,
			ContextSentence: strings.TrimSpace(contextSentence),
			Explanation:     explanation,
		}
		if err := s.aiExplanationRepo.Create(ctx, newExp); err != nil {
			log.Printf("[AIService] Failed to cache explanation in DB: %v", err)
		}
	}

	return nil
}
