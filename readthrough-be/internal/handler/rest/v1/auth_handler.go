package v1

import (
	"net/http"
	"readthrough-be/internal/handler/rest/dto"
	"readthrough-be/internal/model"
	"readthrough-be/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type AuthHandler struct {
	authSvc service.IAuthService
}

func NewAuthHandler(authSvc service.IAuthService) *AuthHandler {
	return &AuthHandler{authSvc: authSvc}
}

func (h *AuthHandler) SignUp(c *gin.Context) {
	var req model.SignUpRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	user, err := h.authSvc.SignUp(c.Request.Context(), req.Username, req.Email, req.Password)
	if err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	c.JSON(http.StatusCreated, dto.ResponseOK(user).WithMessage("Registration successful"))
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req model.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	accessToken, refreshToken, err := h.authSvc.Login(c.Request.Context(), req.Username, req.Password)
	if err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(dto.H{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
	}).WithMessage("Login successful"))
}

func (h *AuthHandler) Refresh(c *gin.Context) {
	var req model.RefreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	accessToken, refreshToken, err := h.authSvc.Refresh(c.Request.Context(), req.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(dto.H{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
	}).WithMessage("Token refreshed successfully"))
}

func (h *AuthHandler) Logout(c *gin.Context) {
	var req model.LogoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ResponseBadRequest(err))
		return
	}

	err := h.authSvc.Logout(c.Request.Context(), req.RefreshToken)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ResponseInternalServerError(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(true).WithMessage("Logout successful"))
}

func (h *AuthHandler) GetMe(c *gin.Context) {
	userIDVal, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(nil))
		return
	}

	userID := userIDVal.(uuid.UUID)
	user, err := h.authSvc.GetMe(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, dto.ResponseNotFound(err))
		return
	}

	c.JSON(http.StatusOK, dto.ResponseOK(user))
}
