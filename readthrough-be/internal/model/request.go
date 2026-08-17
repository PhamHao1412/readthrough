package model

type UpdateProgressRequest struct {
	CurrentPage int    `json:"current_page" binding:"required"`
	EpubCFI     string `json:"epub_cfi"`
	TotalPages  int    `json:"total_pages"`
}

type UpdateBookContentRequest struct {
	Content string `json:"content" binding:"required"`
}

type TranslateRequest struct {
	Text string `json:"text" binding:"required"`
}

type ExplainRequest struct {
	Text            string `json:"text" binding:"required"`
	ContextSentence string `json:"context_sentence"`
	BookTitle       string `json:"book_title"`
	BookAuthor      string `json:"book_author"`
	PageNumber      int    `json:"page_number"`
}

type SaveVocabularyRequest struct {
	BookID          string `json:"book_id" binding:"required,uuid"`
	OriginalText    string `json:"original_text" binding:"required"`
	TranslatedText  string `json:"translated_text" binding:"required"`
	IPA             string `json:"ipa"`
	PartOfSpeech    string `json:"part_of_speech"`
	ContextSentence string `json:"context_sentence"`
	AudioURL        string `json:"audio_url"`
}

type CreateBookmarkRequest struct {
	Page       int    `json:"page"`
	PageNumber int    `json:"page_number"`
	Title      string `json:"title"`
	Snippet    string `json:"snippet"`
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

// PresignUploadRequest is the JSON body for POST /books/presign.
// The server creates a book record and returns a presigned PUT URL for the
// browser to upload the file directly to R2.
type PresignUploadRequest struct {
	Filename    string `json:"filename"     binding:"required"`
	FileSize    int64  `json:"file_size"    binding:"required,min=1"`
	ContentType string `json:"content_type"`
	Title       string `json:"title"`
	Author      string `json:"author"`
}
