package service

import (
	"context"
	"errors"
	"readthrough-be/internal/entity"
	"readthrough-be/internal/repository"
	"readthrough-be/pkg/security"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type IAuthService interface {
	SignUp(ctx context.Context, username, email, password string) (*entity.User, error)
	Login(ctx context.Context, emailOrUsername, password string) (string, string, error)
	Refresh(ctx context.Context, oldRefreshTokenStr string) (string, string, error)
	Logout(ctx context.Context, refreshTokenStr string) error
	GetMe(ctx context.Context, userID uuid.UUID) (*entity.User, error)
}

type AuthService struct {
	userRepo  repository.IUserRepository
	tokenRepo repository.IRefreshTokenRepository
}

func NewAuthService(userRepo repository.IUserRepository, tokenRepo repository.IRefreshTokenRepository) *AuthService {
	return &AuthService{
		userRepo:  userRepo,
		tokenRepo: tokenRepo,
	}
}

func (s *AuthService) SignUp(ctx context.Context, username, email, password string) (*entity.User, error) {
	// Validate email / username duplication
	if u, _ := s.userRepo.GetByEmail(ctx, email); u != nil {
		return nil, errors.New("email already in use")
	}
	if u, _ := s.userRepo.GetByUsername(ctx, username); u != nil {
		return nil, errors.New("username already in use")
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	user := &entity.User{
		Username:     username,
		Email:        email,
		PasswordHash: string(hashedPassword),
	}

	if err := s.userRepo.Create(ctx, user); err != nil {
		return nil, err
	}

	return user, nil
}

func (s *AuthService) Login(ctx context.Context, emailOrUsername, password string) (string, string, error) {
	var user *entity.User
	var err error

	// Try fetching by email first
	user, err = s.userRepo.GetByEmail(ctx, emailOrUsername)
	if err != nil || user == nil {
		// If not found, try fetching by username
		user, err = s.userRepo.GetByUsername(ctx, emailOrUsername)
		if err != nil || user == nil {
			return "", "", errors.New("incorrect username or password")
		}
	}

	// Compare password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return "", "", errors.New("incorrect username or password")
	}

	// Generate access token (15 mins)
	accessToken, err := security.GenerateAccessToken(user.ID)
	if err != nil {
		return "", "", err
	}

	// Generate refresh token string
	refreshTokenStr, err := security.GenerateRefreshToken()
	if err != nil {
		return "", "", err
	}

	// Save refresh token to DB (expires in 30 days)
	expiresAt := time.Now().Add(30 * 24 * time.Hour)
	refreshToken := &entity.RefreshToken{
		UserID:    user.ID,
		Token:     refreshTokenStr,
		ExpiresAt: expiresAt,
	}

	if err := s.tokenRepo.Create(ctx, refreshToken); err != nil {
		return "", "", err
	}

	return accessToken, refreshTokenStr, nil
}

func (s *AuthService) Refresh(ctx context.Context, oldRefreshTokenStr string) (string, string, error) {
	// Retrieve old refresh token
	tokenEntity, err := s.tokenRepo.GetByToken(ctx, oldRefreshTokenStr)
	if err != nil || tokenEntity == nil {
		return "", "", errors.New("invalid refresh token")
	}

	// Check if already revoked (replay attack detection)
	if tokenEntity.IsRevoked {
		// Revoke all tokens for this user for security
		_ = s.tokenRepo.RevokeAll(ctx, tokenEntity.UserID)
		return "", "", errors.New("token expired or revoked")
	}

	// Check expiration
	if time.Now().After(tokenEntity.ExpiresAt) {
		_ = s.tokenRepo.Revoke(ctx, oldRefreshTokenStr) // Revoke expired token
		return "", "", errors.New("refresh token expired, please login again")
	}

	// Generate new access token
	newAccessToken, err := security.GenerateAccessToken(tokenEntity.UserID)
	if err != nil {
		return "", "", err
	}

	// Generate new refresh token (Token Rotation!)
	newRefreshTokenStr, err := security.GenerateRefreshToken()
	if err != nil {
		return "", "", err
	}

	// Revoke old refresh token (instead of hard delete, mark it as revoked for reuse detection)
	if err := s.tokenRepo.Revoke(ctx, oldRefreshTokenStr); err != nil {
		return "", "", err
	}

	// Save new refresh token (renew 30 days)
	expiresAt := time.Now().Add(30 * 24 * time.Hour)
	newRefreshToken := &entity.RefreshToken{
		UserID:    tokenEntity.UserID,
		Token:     newRefreshTokenStr,
		ExpiresAt: expiresAt,
		IsRevoked: false,
	}

	if err := s.tokenRepo.Create(ctx, newRefreshToken); err != nil {
		return "", "", err
	}

	return newAccessToken, newRefreshTokenStr, nil
}

func (s *AuthService) Logout(ctx context.Context, refreshTokenStr string) error {
	tokenEntity, err := s.tokenRepo.GetByToken(ctx, refreshTokenStr)
	if err != nil || tokenEntity == nil {
		// Token not found or already deleted/invalid, no action needed
		return nil
	}
	// Revoke all active refresh tokens for this user
	return s.tokenRepo.RevokeAll(ctx, tokenEntity.UserID)
}

func (s *AuthService) GetMe(ctx context.Context, userID uuid.UUID) (*entity.User, error) {
	return s.userRepo.GetByID(ctx, userID)
}
