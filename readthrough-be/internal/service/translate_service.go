package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"readthrough-be/internal/model"
	"strings"
	"time"
)

type ITranslateService interface {
	Translate(ctx context.Context, text string) (model.TranslateResponse, error)
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

func (s *TranslateService) Translate(ctx context.Context, text string) (model.TranslateResponse, error) {
	var resp model.TranslateResponse
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return resp, nil
	}

	// 1. Dịch từ tiếng Anh sang tiếng Việt
	translated := ""
	var err error
	translated, err = s.translateGoogle(ctx, trimmed)
	if err != nil || translated == "" {
		// Fallback to MyMemory
		translated, err = s.translateMyMemory(ctx, trimmed)
	}

	if err != nil {
		return resp, err
	}
	resp.TranslatedText = translated

	// 2. Kiểm tra nếu là từ đơn để lấy thông tin từ điển
	// Từ đơn không chứa khoảng trắng và không quá dài
	isWord := !strings.Contains(trimmed, " ") && len(trimmed) > 0 && len(trimmed) < 30
	if isWord {
		phonetic, audioUrl, partsOfSpeech, err := s.fetchDictionary(ctx, trimmed)
		if err == nil {
			resp.IsWord = true
			resp.Phonetic = phonetic
			resp.AudioURL = audioUrl
			resp.PartsOfSpeech = partsOfSpeech
		}
	}

	return resp, nil
}

func (s *TranslateService) fetchDictionary(ctx context.Context, word string) (string, string, []model.PartOfSpeechInfo, error) {
	cleaned := strings.TrimFunc(word, func(r rune) bool {
		return r == '.' || r == ',' || r == '?' || r == '!' || r == ';' || r == ':' || r == '"' || r == '\'' || r == '(' || r == ')'
	})

	apiURL := fmt.Sprintf("https://api.dictionaryapi.dev/api/v2/entries/en/%s", url.PathEscape(cleaned))
	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return "", "", nil, err
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return "", "", nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", nil, fmt.Errorf("dictionary api returned: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", nil, err
	}

	type dictPhonetic struct {
		Text  string `json:"text"`
		Audio string `json:"audio"`
	}

	type dictDefinition struct {
		Definition string `json:"definition"`
		Example    string `json:"example"`
	}

	type dictMeaning struct {
		PartOfSpeech string           `json:"partOfSpeech"`
		Definitions  []dictDefinition `json:"definitions"`
	}

	type dictEntry struct {
		Word      string         `json:"word"`
		Phonetic  string         `json:"phonetic"`
		Phonetics []dictPhonetic `json:"phonetics"`
		Meanings  []dictMeaning  `json:"meanings"`
	}

	var entries []dictEntry
	if err := json.Unmarshal(body, &entries); err != nil {
		return "", "", nil, err
	}

	if len(entries) == 0 {
		return "", "", nil, fmt.Errorf("no dictionary entry found")
	}

	entry := entries[0]
	phonetic := entry.Phonetic
	audioUrl := ""

	for _, p := range entry.Phonetics {
		if p.Audio != "" {
			audioUrl = p.Audio
			break
		}
	}
	if phonetic == "" {
		for _, p := range entry.Phonetics {
			if p.Text != "" {
				phonetic = p.Text
				break
			}
		}
	}

	var partsOfSpeech []model.PartOfSpeechInfo
	for _, m := range entry.Meanings {
		var definitions []model.DefinitionInfo
		limit := 3
		if len(m.Definitions) < limit {
			limit = len(m.Definitions)
		}
		for i := 0; i < limit; i++ {
			d := m.Definitions[i]
			definitions = append(definitions, model.DefinitionInfo{
				Definition: d.Definition,
				Example:    d.Example,
			})
		}
		partsOfSpeech = append(partsOfSpeech, model.PartOfSpeechInfo{
			PartOfSpeech: m.PartOfSpeech,
			Definitions:  definitions,
		})
	}

	return phonetic, audioUrl, partsOfSpeech, nil
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
