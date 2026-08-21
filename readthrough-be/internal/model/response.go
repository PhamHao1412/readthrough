package model

type DefinitionInfo struct {
	Definition string `json:"definition"`
	Example    string `json:"example,omitempty"`
}

type PartOfSpeechInfo struct {
	PartOfSpeech string           `json:"partOfSpeech"`
	Definitions  []DefinitionInfo `json:"definitions"`
}

type TranslateResponse struct {
	TranslatedText string             `json:"translatedText"`
	IsWord         bool               `json:"isWord"`
	Phonetic       string             `json:"phonetic"`
	AudioURL       string             `json:"audioUrl"`
	PartsOfSpeech  []PartOfSpeechInfo `json:"partsOfSpeech"`
}

type ExplainResponse struct {
	Explanation string `json:"explanation"`
}

type SectionSummaryData struct {
	TLDR         string   `json:"tldr"`
	KeyIdeas     []string `json:"key_ideas"`
	MainTakeaway string   `json:"main_takeaway"`
}

type SectionExplainData struct {
	Overview            string `json:"overview"`
	WhyItExists         string `json:"why_it_exists"`
	TechnicalReasoning  string `json:"technical_reasoning"`
	BackendApplications string `json:"backend_applications"`
	Tradeoffs           string `json:"tradeoffs"`
	MarkdownContent     string `json:"markdown_content"`
}

type QuizQuestion struct {
	ID           int      `json:"id"`
	Question     string   `json:"question"`
	Options      []string `json:"options"`
	CorrectIndex int      `json:"correct_index"`
	Explanation  string   `json:"explanation"`
}

type SectionQuizData struct {
	Questions []QuizQuestion `json:"questions"`
}

type ReadingCompanionResponse struct {
	Action       string              `json:"action"`
	SectionTitle string              `json:"section_title"`
	Summary      *SectionSummaryData `json:"summary,omitempty"`
	Explain      *SectionExplainData `json:"explain,omitempty"`
	Quiz         *SectionQuizData    `json:"quiz,omitempty"`
	IsCached     bool                `json:"is_cached"`
}
