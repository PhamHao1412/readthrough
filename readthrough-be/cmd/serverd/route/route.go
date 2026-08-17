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
	bookmarkHandler *v1.BookmarkHandler,
	limiter *middleware.RateLimiter,
	aiCreditManager *middleware.AICreditManager,
) {
	// CORS Middleware
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, X-User-Id, Range")
		c.Writer.Header().Set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
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
			books.POST("/presign", bookHandler.PresignUpload)
			books.POST("/:id/finalize", bookHandler.FinalizeUpload)
			books.GET("", bookHandler.List)
			books.GET("/:id", bookHandler.GetByID)
			books.GET("/:id/content", bookHandler.GetContent)
			books.GET("/:id/download-url", bookHandler.GetDownloadURL)
			books.DELETE("/:id", bookHandler.Delete)
			books.PUT("/:id/progress", bookHandler.UpdateProgress)
			books.PUT("/:id/content", bookHandler.UpdateContent)

			// Bookmarks under book
			books.GET("/:id/bookmarks", bookmarkHandler.ListByBook)
			books.POST("/:id/bookmarks", bookmarkHandler.Add)
			books.DELETE("/:id/bookmarks/:bookmark_id", bookmarkHandler.Delete)
		}

		// Bookmarks Routes (Protected - all user's bookmarks)
		bookmarks := api.Group("/bookmarks", middleware.AuthMiddleware())
		{
			bookmarks.GET("", bookmarkHandler.ListAll)
			bookmarks.DELETE("/:id", bookmarkHandler.Delete)
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
