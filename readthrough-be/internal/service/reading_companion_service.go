package service

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"readthrough-be/internal/entity"
	"readthrough-be/internal/model"
	"readthrough-be/internal/repository"
	"readthrough-be/internal/utils"
	"strings"
	"time"
)

type IReadingCompanionService interface {
	ProcessAction(ctx context.Context, req *model.ReadingCompanionRequest) (*model.ReadingCompanionResponse, error)
	ProcessActionStream(ctx context.Context, req *model.ReadingCompanionRequest, ch chan<- string) error
	HasCache(ctx context.Context, bookID, sectionTitle, action, content string) (bool, error)
}

type ReadingCompanionService struct {
	apiKey        string
	model         string
	summaryModel  string
	client        *http.Client
	companionRepo repository.IAICompanionRepository
}

func NewReadingCompanionService(apiKey, model, summaryModel string, companionRepo repository.IAICompanionRepository) *ReadingCompanionService {
	if model == "" {
		model = "gpt-5-nano"
	}
	if summaryModel == "" {
		summaryModel = "gpt-4o-mini"
	}
	return &ReadingCompanionService{
		apiKey:       apiKey,
		model:        model,
		summaryModel: summaryModel,
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
		companionRepo: companionRepo,
	}
}

func (s *ReadingCompanionService) getModelForAction(action string) string {
	if strings.ToLower(strings.TrimSpace(action)) == "summary" {
		if s.summaryModel != "" {
			return s.summaryModel
		}
		return "gpt-4o-mini"
	}
	if s.model != "" {
		return s.model
	}
	return "gpt-5-nano"
}

func hashContent(text string) string {
	h := sha256.New()
	h.Write([]byte(strings.TrimSpace(text)))
	return hex.EncodeToString(h.Sum(nil))
}

func (s *ReadingCompanionService) HasCache(ctx context.Context, bookID, sectionTitle, action, content string) (bool, error) {
	if s.companionRepo == nil {
		return false, nil
	}
	contentHash := hashContent(content)
	cached, err := s.companionRepo.Get(ctx, bookID, sectionTitle, action, contentHash)
	if err != nil {
		return false, nil
	}
	return cached != nil, nil
}

func (s *ReadingCompanionService) ProcessAction(ctx context.Context, req *model.ReadingCompanionRequest) (*model.ReadingCompanionResponse, error) {
	action := strings.ToLower(strings.TrimSpace(req.Action))
	if action != "summary" && action != "explain" && action != "quiz" {
		return nil, fmt.Errorf("invalid action: %s. Must be 'summary', 'explain', or 'quiz'", req.Action)
	}

	trimmedContent := strings.TrimSpace(req.Content)
	if trimmedContent == "" {
		return nil, fmt.Errorf("section content cannot be empty")
	}

	contentHash := hashContent(trimmedContent)

	// 1. Check DB Cache
	if s.companionRepo != nil {
		cached, err := s.companionRepo.Get(ctx, req.BookID, req.SectionTitle, action, contentHash)
		if err == nil && cached != nil {
			var resp model.ReadingCompanionResponse
			if jsonErr := json.Unmarshal([]byte(cached.ResponseJSON), &resp); jsonErr == nil {
				resp.IsCached = true
				log.Printf("[ReadingCompanion] DB Cache Hit for book=%s, section=%q, action=%s", req.BookID, req.SectionTitle, action)
				return &resp, nil
			}
		}
	}

	if s.apiKey == "" {
		return nil, fmt.Errorf("openai API key is not configured")
	}

	bookTitle := req.BookTitle
	if bookTitle == "" {
		bookTitle = "Document"
	}
	bookAuthor := req.BookAuthor
	if bookAuthor == "" {
		bookAuthor = "Author"
	}

	// 2. Select appropriate prompt template
	var prompt string
	switch action {
	case "summary":
		prompt = fmt.Sprintf(utils.SectionSummaryPromptTemplate, req.SectionTitle, bookTitle, bookAuthor, trimmedContent)
	case "explain":
		prompt = fmt.Sprintf(utils.SectionExplainPromptTemplate, req.SectionTitle, bookTitle, bookAuthor, trimmedContent)
	case "quiz":
		prompt = fmt.Sprintf(utils.SectionQuizPromptTemplate, req.SectionTitle, bookTitle, bookAuthor, trimmedContent)
	}

	chosenModel := s.getModelForAction(action)

	// 3. Prepare OpenAI Request Body
	reqBody := map[string]interface{}{
		"model": chosenModel,
		"messages": []map[string]interface{}{
			{
				"role":    "user",
				"content": prompt,
			},
		},
	}
	if !strings.Contains(chosenModel, "gpt-5") && !strings.HasPrefix(chosenModel, "o1") && !strings.HasPrefix(chosenModel, "o3") {
		reqBody["temperature"] = 0.2
		reqBody["response_format"] = map[string]string{
			"type": "json_object",
		}
	}

	jsonBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	apiURL := "https://api.openai.com/v1/chat/completions"
	maxAttempts := 3
	backoff := 500 * time.Millisecond
	var body []byte

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		httpReq, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBuffer(jsonBytes))
		if err != nil {
			return nil, err
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", s.apiKey))

		resp, err := s.client.Do(httpReq)
		if err != nil {
			if attempt == maxAttempts {
				return nil, err
			}
			log.Printf("[ReadingCompanion] Attempt %d failed: %v. Retrying in %v...", attempt, err, backoff)
			time.Sleep(backoff)
			backoff *= 2
			continue
		}

		body, err = io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			if attempt == maxAttempts {
				return nil, err
			}
			log.Printf("[ReadingCompanion] Failed to read body on attempt %d: %v. Retrying...", attempt, err)
			time.Sleep(backoff)
			backoff *= 2
			continue
		}

		if resp.StatusCode == http.StatusServiceUnavailable || resp.StatusCode == http.StatusTooManyRequests {
			if attempt < maxAttempts {
				log.Printf("[ReadingCompanion] OpenAI status %d on attempt %d. Retrying in %v...", resp.StatusCode, attempt, backoff)
				time.Sleep(backoff)
				backoff *= 2
				continue
			}
		}

		if resp.StatusCode != http.StatusOK {
			log.Printf("[ReadingCompanion] OpenAI error (status %d): %s", resp.StatusCode, string(body))
			return nil, fmt.Errorf("openai api returned status %d: %s", resp.StatusCode, string(body))
		}

		break
	}

	// 4. Parse OpenAI Chat Response
	type openAIMessage struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	type openAIChoice struct {
		Index   int           `json:"index"`
		Message openAIMessage `json:"message"`
	}
	type openAIResponse struct {
		Choices []openAIChoice `json:"choices"`
	}

	var openAIResp openAIResponse
	if err := json.Unmarshal(body, &openAIResp); err != nil {
		return nil, fmt.Errorf("failed to parse openai envelope: %w", err)
	}

	if len(openAIResp.Choices) == 0 {
		return nil, fmt.Errorf("empty choices from openai")
	}

	rawResult := strings.TrimSpace(openAIResp.Choices[0].Message.Content)
	if strings.HasPrefix(rawResult, "```") {
		lines := strings.Split(rawResult, "\n")
		if len(lines) >= 2 {
			if strings.HasPrefix(lines[0], "```") {
				lines = lines[1:]
			}
			if len(lines) > 0 && strings.HasPrefix(lines[len(lines)-1], "```") {
				lines = lines[:len(lines)-1]
			}
			rawResult = strings.Join(lines, "\n")
		}
	}

	finalResp := &model.ReadingCompanionResponse{
		Action:       action,
		SectionTitle: req.SectionTitle,
		IsCached:     false,
	}

	switch action {
	case "summary":
		var summaryData model.SectionSummaryData
		if err := json.Unmarshal([]byte(rawResult), &summaryData); err != nil {
			return nil, fmt.Errorf("failed to parse summary payload: %w (raw: %s)", err, rawResult)
		}
		finalResp.Summary = &summaryData

	case "explain":
		var explainData model.SectionExplainData
		if err := json.Unmarshal([]byte(rawResult), &explainData); err != nil {
			return nil, fmt.Errorf("failed to parse explain payload: %w (raw: %s)", err, rawResult)
		}
		finalResp.Explain = &explainData

	case "quiz":
		var quizData model.SectionQuizData
		if err := json.Unmarshal([]byte(rawResult), &quizData); err != nil {
			return nil, fmt.Errorf("failed to parse quiz payload: %w (raw: %s)", err, rawResult)
		}
		finalResp.Quiz = &quizData
	}

	// 5. Cache response in DB
	if s.companionRepo != nil {
		respBytes, err := json.Marshal(finalResp)
		if err == nil {
			cacheItem := &entity.AICompanion{
				BookID:       req.BookID,
				SectionTitle: req.SectionTitle,
				Action:       action,
				ContentHash:  contentHash,
				ResponseJSON: string(respBytes),
			}
			if createErr := s.companionRepo.Create(ctx, cacheItem); createErr != nil {
				log.Printf("[ReadingCompanion] Failed to save DB cache: %v", createErr)
			} else {
				log.Printf("[ReadingCompanion] Successfully saved DB cache for book=%s, section=%q, action=%s", req.BookID, req.SectionTitle, action)
			}
		}
	}

	return finalResp, nil
}

func (s *ReadingCompanionService) ProcessActionStream(ctx context.Context, req *model.ReadingCompanionRequest, ch chan<- string) error {
	defer close(ch)

	if s.apiKey == "" {
		err := fmt.Errorf("openai API key is not configured")
		ch <- "[ERROR] " + err.Error()
		return err
	}

	action := strings.ToLower(strings.TrimSpace(req.Action))
	if action != "summary" && action != "explain" && action != "quiz" {
		action = "summary"
	}

	trimmedContent := strings.TrimSpace(req.Content)
	if trimmedContent == "" {
		return nil
	}

	contentHash := hashContent(trimmedContent)

	// 1. Check DB Cache
	if s.companionRepo != nil {
		cached, err := s.companionRepo.Get(ctx, req.BookID, req.SectionTitle, action+"_stream", contentHash)
		if err == nil && cached != nil && cached.ResponseJSON != "" {
			log.Printf("[ReadingCompanion] DB Cache Hit (Stream) for book=%s, section=%q, action=%s", req.BookID, req.SectionTitle, action)
			ch <- "[CACHED]" + cached.ResponseJSON
			return nil
		}
	}

	bookTitle := req.BookTitle
	if bookTitle == "" {
		bookTitle = "Document"
	}
	bookAuthor := req.BookAuthor
	if bookAuthor == "" {
		bookAuthor = "Author"
	}

	// 2. Select Stream Prompt
	var prompt string
	if req.IsChapter {
		switch action {
		case "summary":
			prompt = fmt.Sprintf(utils.ChapterSummaryStreamPromptTemplate, req.SectionTitle, bookTitle, bookAuthor, trimmedContent)
		case "explain":
			prompt = fmt.Sprintf(utils.ChapterExplainStreamPromptTemplate, req.SectionTitle, bookTitle, bookAuthor, trimmedContent)
		case "quiz":
			prompt = fmt.Sprintf(utils.ChapterQuizStreamPromptTemplate, req.SectionTitle, bookTitle, bookAuthor, trimmedContent)
		}
	} else {
		switch action {
		case "summary":
			prompt = fmt.Sprintf(utils.SectionSummaryStreamPromptTemplate, req.SectionTitle, bookTitle, bookAuthor, trimmedContent)
		case "explain":
			prompt = fmt.Sprintf(utils.SectionExplainStreamPromptTemplate, req.SectionTitle, bookTitle, bookAuthor, trimmedContent)
		case "quiz":
			prompt = fmt.Sprintf(utils.SectionQuizStreamPromptTemplate, req.SectionTitle, bookTitle, bookAuthor, trimmedContent)
		}
	}

	chosenModel := s.getModelForAction(action)

	// 3. Build Stream Request Body
	reqBody := map[string]interface{}{
		"model": chosenModel,
		"messages": []map[string]interface{}{
			{
				"role":    "user",
				"content": prompt,
			},
		},
		"stream": true,
	}

	jsonBytes, err := json.Marshal(reqBody)
	if err != nil {
		ch <- "[ERROR] " + err.Error()
		return err
	}

	apiURL := "https://api.openai.com/v1/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBuffer(jsonBytes))
	if err != nil {
		ch <- "[ERROR] " + err.Error()
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", fmt.Sprintf("Bearer %s", s.apiKey))

	resp, err := s.client.Do(httpReq)
	if err != nil {
		ch <- "[ERROR] " + err.Error()
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		var apiErr struct {
			Error struct {
				Message string `json:"message"`
				Type    string `json:"type"`
			} `json:"error"`
		}
		errMsg := string(body)
		if jsonErr := json.Unmarshal(body, &apiErr); jsonErr == nil && apiErr.Error.Message != "" {
			errMsg = apiErr.Error.Message
		}
		err := fmt.Errorf("OpenAI API error (%d): %s", resp.StatusCode, errMsg)
		ch <- "[ERROR] " + err.Error()
		return err
	}

	// 4. Stream Tokens
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
		if line == "" || !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

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
			continue
		}

		if len(chunk.Choices) > 0 {
			token := chunk.Choices[0].Delta.Content
			if token != "" {
				fullTextBuilder.WriteString(token)
				ch <- token
			}
		}
	}

	// 5. Cache completed markdown result in DB
	fullContent := fullTextBuilder.String()
	if strings.TrimSpace(fullContent) != "" && s.companionRepo != nil {
		cacheItem := &entity.AICompanion{
			BookID:       req.BookID,
			SectionTitle: req.SectionTitle,
			Action:       action + "_stream",
			ContentHash:  contentHash,
			ResponseJSON: fullContent,
		}
		if err := s.companionRepo.Create(ctx, cacheItem); err != nil {
			log.Printf("[ReadingCompanion] Failed to save stream DB cache: %v", err)
		}
	}

	return nil
}
