package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type ITranslateService interface {
	Translate(ctx context.Context, text string) (string, error)
}

type TranslateService struct {
	client *http.Client
}

func NewTranslateService() *TranslateService {
	return &TranslateService{
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (s *TranslateService) Translate(ctx context.Context, text string) (string, error) {
	if strings.TrimSpace(text) == "" {
		return "", nil
	}

	// 1. Try Google Translate Free API first
	translated, err := s.translateGoogle(ctx, text)
	if err == nil && translated != "" {
		return translated, nil
	}

	// 2. Fallback to MyMemory API if Google fails
	return s.translateMyMemory(ctx, text)
}

func (s *TranslateService) translateGoogle(ctx context.Context, text string) (string, error) {
	apiURL := fmt.Sprintf(
		"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=%s",
		url.QueryEscape(text),
	)

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return "", err
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("google translate returned status: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var raw []interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return "", err
	}

	if len(raw) > 0 {
		firstLevel, ok := raw[0].([]interface{})
		if !ok {
			return "", fmt.Errorf("invalid google translate response format")
		}

		var translatedParts []string
		for _, part := range firstLevel {
			partArray, ok := part.([]interface{})
			if ok && len(partArray) > 0 {
				if str, ok := partArray[0].(string); ok {
					translatedParts = append(translatedParts, str)
				}
			}
		}

		if len(translatedParts) > 0 {
			return strings.Join(translatedParts, ""), nil
		}
	}

	return "", fmt.Errorf("failed to extract translation from response")
}

func (s *TranslateService) translateMyMemory(ctx context.Context, text string) (string, error) {
	apiURL := fmt.Sprintf(
		"https://api.mymemory.translated.net/get?q=%s&langpair=en|vi",
		url.QueryEscape(text),
	)

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return "", err
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("mymemory returned status: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var resData struct {
		ResponseData struct {
			TranslatedText string `json:"translatedText"`
		} `json:"responseData"`
		ResponseStatus int `json:"responseStatus"`
	}

	if err := json.Unmarshal(body, &resData); err != nil {
		return "", err
	}

	if resData.ResponseStatus == 200 && resData.ResponseData.TranslatedText != "" {
		return resData.ResponseData.TranslatedText, nil
	}

	return "", fmt.Errorf("mymemory failed with status %d", resData.ResponseStatus)
}
