package middleware

import (
	"errors"
	"net/http"
	"readthrough-be/internal/handler/rest/dto"
	"readthrough-be/pkg/security"
	"strings"

	"github.com/gin-gonic/gin"
)

func AuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(errors.New("authorization required")))
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if !(len(parts) == 2 && parts[0] == "Bearer") {
			c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(errors.New("authorization header format must be Bearer <token>")))
			c.Abort()
			return
		}

		tokenStr := parts[1]
		userID, err := security.ValidateAccessToken(tokenStr)
		if err != nil {
			c.JSON(http.StatusUnauthorized, dto.ResponseUnauthorized(errors.New("session expired or invalid")))
			c.Abort()
			return
		}

		c.Set("userID", userID)
		c.Next()
	}
}
