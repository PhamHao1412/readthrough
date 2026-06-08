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
