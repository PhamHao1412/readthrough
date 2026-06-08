package route

import (
	"net/http"
	"os"
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
	{
		api.GET("/health", healthHandler.HealthCheck)
		api.POST("/translate", translateHandler.Translate)

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
			books.PUT("/:id/progress", bookHandler.UpdateProgress)
		}

		// Vocabularies Routes (Protected)
		vocabularies := api.Group("/vocabularies", middleware.AuthMiddleware())
		{
			vocabularies.POST("", vocabHandler.Save)
			vocabularies.GET("", vocabHandler.List)
			vocabularies.DELETE("/:id", vocabHandler.Delete)
		}
	}

	// Serve Frontend compiled assets
	// Supports FRONTEND_DIST_PATH env var for Docker deployments
	distPath := os.Getenv("FRONTEND_DIST_PATH")
	if distPath == "" {
		distPath = "../readthrough-fe/dist" // local dev default
	}
	r.Static("/assets", distPath+"/assets")
	r.StaticFile("/", distPath+"/index.html")
	// Fallback: serve index.html for SPA routes
	r.NoRoute(func(c *gin.Context) {
		c.File(distPath + "/index.html")
	})
}
