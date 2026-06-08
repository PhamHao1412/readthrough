package main

import (
	"log"
	"os"
	"readthrough-be/cmd/serverd/route"
	"readthrough-be/internal/app"
	"readthrough-be/internal/db"
	"readthrough-be/internal/entity"
	v1 "readthrough-be/internal/handler/rest/v1"
	"readthrough-be/internal/repository"
	"readthrough-be/internal/service"
	"readthrough-be/pkg/logger"
	"readthrough-be/pkg/security"

	"github.com/gin-gonic/gin"
	"github.com/viebiz/lit/env"
)

func main() {
	gin.ForceConsoleColor()
	r := gin.Default()
	r.Use(gin.Recovery())

	// Read app config
	cfg, err := env.ReadAppConfig[app.Config]()
	if err != nil {
		log.Fatalf("failed to read app config: %v", err)
	}

	entity.SetConfig(&cfg)
	logger.Init(&cfg)

	// Allow OS environment variables to override config (e.g. on Render, Railway, etc. where .env is empty/missing)
	if envVal := os.Getenv("PORT"); envVal != "" {
		cfg.Port = envVal
	}
	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	if envVal := os.Getenv("ENV"); envVal != "" {
		cfg.Env = envVal
	}
	if envVal := os.Getenv("APP_NAME"); envVal != "" {
		cfg.AppName = envVal
	}
	if envVal := os.Getenv("DB_SCHEMA_NAME"); envVal != "" {
		cfg.DBSchemaName = envVal
	}
	if envVal := os.Getenv("DB_URL"); envVal != "" {
		cfg.DbUrl = envVal
	}
	if envVal := os.Getenv("LOG_LEVEL"); envVal != "" {
		cfg.LogLevel = envVal
	}
	if envVal := os.Getenv("JWT_SECRET"); envVal != "" {
		cfg.JWTSecret = envVal
	}
	if envVal := os.Getenv("UPLOAD_DIR"); envVal != "" {
		cfg.UploadDir = envVal
	}

	// Re-initialize entity and logger config with overridden values
	entity.SetConfig(&cfg)
	logger.Init(&cfg)

	// Init JWT secret from config
	security.Init(cfg.JWTSecret)

	// Set upload directory (default: ./uploads)
	if cfg.UploadDir != "" {
		os.Setenv("UPLOAD_DIR", cfg.UploadDir)
	}

	// Connect to Database
	dbConn, err := db.Connect(cfg.DbUrl)
	if err != nil {
		log.Fatalf("failed to connect database: %v", err)
	}
	//
	//// Run GORM migrations
	//if err := db.AutoMigrateAndSeed(dbConn); err != nil {
	//	log.Fatalf("failed to auto migrate and seed database: %v", err)
	//}

	// Repositories
	baseRepo := repository.NewBaseRepository(dbConn)
	bookRepo := repository.NewBookRepository(dbConn)
	vocabRepo := repository.NewVocabularyRepository(dbConn)
	userRepo := repository.NewUserRepository(dbConn)
	tokenRepo := repository.NewRefreshTokenRepository(dbConn)

	// Services
	bookSvc := service.NewBookService(baseRepo, bookRepo)
	translateSvc := service.NewTranslateService()
	vocabSvc := service.NewVocabularyService(vocabRepo)
	authSvc := service.NewAuthService(userRepo, tokenRepo)

	// Handlers
	bookHandler := v1.NewBookHandler(bookSvc)
	translateHandler := v1.NewTranslateHandler(translateSvc)
	healthHandler := v1.NewHealthHandler()
	vocabHandler := v1.NewVocabularyHandler(vocabSvc)
	authHandler := v1.NewAuthHandler(authSvc)

	// Router setup
	route.V1Router(r, bookHandler, translateHandler, healthHandler, vocabHandler, authHandler)

	log.Printf("%s service running at :%s", cfg.AppName, cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("failed to start server: %v", err)
	}
}
