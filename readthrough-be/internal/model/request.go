package model

type UpdateProgressRequest struct {
	CurrentPage int    `json:"current_page" binding:"required"`
	EpubCFI     string `json:"epub_cfi"`
	TotalPages  int    `json:"total_pages"`
}

type TranslateRequest struct {
	Text string `json:"text" binding:"required"`
}

type SaveVocabularyRequest struct {
	BookID         string `json:"book_id" binding:"required,uuid"`
	OriginalText   string `json:"original_text" binding:"required"`
	TranslatedText string `json:"translated_text" binding:"required"`
}

type SignUpRequest struct {
	Username string `json:"username" binding:"required,min=3,max=30"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}

type LogoutRequest struct {
	RefreshToken string `json:"refresh_token" binding:"required"`
}
