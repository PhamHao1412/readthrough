package route

import (
	"net/http"
	v1 "readthrough-be/internal/handler/rest/v1"
	"readthrough-be/internal/middleware"

	"github.com/gin-gonic/gin"
)

func V1Router(
	r *gin.Engine,
	bookHandler *v1.BookHandler,
	translateHandler *v1.TranslateHandler,
	healthHandler *v1.HealthHandler,
	vocabHandler *v1.VocabularyHandler,
	authHandler *v1.AuthHandler,
	aiHandler *v1.AIHandler,
	limiter *middleware.RateLimiter,
	aiCreditManager *middleware.AICreditManager,
) {
	// CORS Middleware
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, X-User-Id")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}

		c.Next()
	})

	// API Endpoints Group
	api := r.Group("/api/v1")
	api.Use(middleware.RateLimitMiddleware(limiter))
	api.Use(middleware.AICreditMiddleware(aiCreditManager))
	{
		api.GET("/health", healthHandler.HealthCheck)
		api.POST("/translate", translateHandler.Translate)
		api.POST("/explain", aiHandler.Explain)

		// Auth Routes (Public)
		auth := api.Group("/auth")
		{
			auth.POST("/signup", authHandler.SignUp)
			auth.POST("/login", authHandler.Login)
			auth.POST("/refresh", authHandler.Refresh)
			auth.POST("/logout", authHandler.Logout)
			auth.GET("/me", middleware.AuthMiddleware(), authHandler.GetMe)
		}

		// Books Routes (Protected)
		books := api.Group("/books", middleware.AuthMiddleware())
		{
			books.POST("/upload", bookHandler.Upload)
			books.GET("", bookHandler.List)
			books.GET("/:id", bookHandler.GetByID)
			books.GET("/:id/content", bookHandler.GetContent)
			books.GET("/:id/download-url", bookHandler.GetDownloadURL)
			books.DELETE("/:id", bookHandler.Delete)
			books.PUT("/:id/progress", bookHandler.UpdateProgress)
			books.PUT("/:id/content", bookHandler.UpdateContent)
		}

		// Vocabularies Routes (Protected)
		vocabularies := api.Group("/vocabularies", middleware.AuthMiddleware())
		{
			vocabularies.POST("", vocabHandler.Save)
			vocabularies.GET("", vocabHandler.List)
			vocabularies.DELETE("/:id", vocabHandler.Delete)
		}
	}
}
