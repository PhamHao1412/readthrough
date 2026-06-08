package service

import (
	"context"
	"readthrough-be/internal/entity"
	"readthrough-be/internal/repository"
	"strings"

	"github.com/google/uuid"
)

type IVocabularyService interface {
	SaveVocabulary(ctx context.Context, bookID uuid.UUID, userID uuid.UUID, originalText string, translatedText string, ipa string, partOfSpeech string, contextSentence string, audioURL string) (*entity.Vocabulary, error)
	ListVocabulary(ctx context.Context, bookID uuid.UUID, userID uuid.UUID, search string) ([]entity.Vocabulary, error)
	DeleteVocabulary(ctx context.Context, id uuid.UUID, userID uuid.UUID) error
	GetVocabularyByWord(ctx context.Context, bookID uuid.UUID, userID uuid.UUID, word string) (*entity.Vocabulary, error)
}

type VocabularyService struct {
	vocabRepo repository.IVocabularyRepository
}

func NewVocabularyService(vocabRepo repository.IVocabularyRepository) *VocabularyService {
	return &VocabularyService{
		vocabRepo: vocabRepo,
	}
}

func (s *VocabularyService) SaveVocabulary(ctx context.Context, bookID uuid.UUID, userID uuid.UUID, originalText string, translatedText string, ipa string, partOfSpeech string, contextSentence string, audioURL string) (*entity.Vocabulary, error) {
	originalText = strings.TrimSpace(originalText)
	translatedText = strings.TrimSpace(translatedText)
	ipa = strings.TrimSpace(ipa)
	partOfSpeech = strings.TrimSpace(partOfSpeech)
	contextSentence = strings.TrimSpace(contextSentence)
	audioURL = strings.TrimSpace(audioURL)

	// Check if already exists
	existing, err := s.vocabRepo.GetByWord(ctx, bookID, userID, originalText)
	if err == nil && existing != nil {
		existing.TranslatedText = translatedText
		existing.IPA = ipa
		existing.PartOfSpeech = partOfSpeech
		existing.ContextSentence = contextSentence
		existing.AudioURL = audioURL
		if err := s.vocabRepo.Update(ctx, existing); err != nil {
			return nil, err
		}
		return existing, nil
	}

	vocab := &entity.Vocabulary{
		UserID:          userID,
		BookID:          bookID,
		OriginalText:    originalText,
		TranslatedText:  translatedText,
		IPA:             ipa,
		PartOfSpeech:    partOfSpeech,
		ContextSentence: contextSentence,
		AudioURL:        audioURL,
	}

	if err := s.vocabRepo.Create(ctx, vocab); err != nil {
		return nil, err
	}
	return vocab, nil
}

func (s *VocabularyService) ListVocabulary(ctx context.Context, bookID uuid.UUID, userID uuid.UUID, search string) ([]entity.Vocabulary, error) {
	return s.vocabRepo.List(ctx, bookID, userID, search)
}

func (s *VocabularyService) DeleteVocabulary(ctx context.Context, id uuid.UUID, userID uuid.UUID) error {
	return s.vocabRepo.Delete(ctx, id, userID)
}

func (s *VocabularyService) GetVocabularyByWord(ctx context.Context, bookID uuid.UUID, userID uuid.UUID, word string) (*entity.Vocabulary, error) {
	return s.vocabRepo.GetByWord(ctx, bookID, userID, word)
}
