package main

import (
	"log"
	"os"
	"readthrough-be/cmd/serverd/route"
	"readthrough-be/internal/app"
	"readthrough-be/internal/db"
	"readthrough-be/internal/entity"
	v1 "readthrough-be/internal/handler/rest/v1"
	"readthrough-be/internal/middleware"
	"readthrough-be/internal/repository"
	"readthrough-be/internal/service"
	"readthrough-be/internal/storage"
	"readthrough-be/pkg/logger"
	"readthrough-be/pkg/security"
	"strings"
	"time"

	"readthrough-be/pkg/env"

	"github.com/gin-gonic/gin"
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

	if cfg.Port == "" {
		cfg.Port = "8080"
	}

	log.Printf("app config: %+v", cfg)

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

	// Storage setup (Cloudflare R2 or Local fallback)
	var store storage.Storage
	if cfg.R2AccessKeyID != "" && cfg.R2SecretAccessKey != "" && cfg.R2AccountID != "" && cfg.R2BucketName != "" {
		r2Store, err := storage.NewR2Storage(cfg.R2AccessKeyID, cfg.R2SecretAccessKey, cfg.R2AccountID, cfg.R2BucketName)
		if err != nil {
			log.Fatalf("failed to initialize R2 storage: %v", err)
		}
		store = r2Store
		log.Println("Storage initialized: Cloudflare R2")
	} else {
		store = storage.NewLocalStorage(cfg.UploadDir)
		log.Println("Storage initialized: Local Filesystem")
	}

	// Repositories
	baseRepo := repository.NewBaseRepository(dbConn)
	bookRepo := repository.NewBookRepository(dbConn)
	vocabRepo := repository.NewVocabularyRepository(dbConn)
	userRepo := repository.NewUserRepository(dbConn)
	tokenRepo := repository.NewRefreshTokenRepository(dbConn)

	aiExplanationRepo := repository.NewAIExplanationRepository(dbConn)

	// Services
	bookSvc := service.NewBookService(baseRepo, bookRepo, store)
	translateSvc := service.NewTranslateService()

	aiSvc := service.NewAIService(cfg.OpenAIApiKey, cfg.OpenAIModel, aiExplanationRepo)
	vocabSvc := service.NewVocabularyService(vocabRepo)
	authSvc := service.NewAuthService(userRepo, tokenRepo)

	// Handlers
	bookHandler := v1.NewBookHandler(bookSvc)
	translateHandler := v1.NewTranslateHandler(translateSvc)
	aiHandler := v1.NewAIHandler(aiSvc)
	healthHandler := v1.NewHealthHandler(dbConn)
	vocabHandler := v1.NewVocabularyHandler(vocabSvc)
	authHandler := v1.NewAuthHandler(authSvc)

	// Rate Limiter Setup
	limiter := middleware.NewRateLimiter(cfg.RateLimitCapacity, cfg.RateLimitRate, 1*time.Hour)

	// AI Credit Whitelist Setup
	var whitelistIDs []string
	if cfg.AIWhitelistUserIDs != "" {
		whitelistIDs = strings.Split(cfg.AIWhitelistUserIDs, ",")
	}
	aiCreditManager := middleware.NewAICreditManager(whitelistIDs)

	// Router setup
	route.V1Router(r, bookHandler, translateHandler, healthHandler, vocabHandler, authHandler, aiHandler, limiter, aiCreditManager)

	log.Printf("%s service running at :%s", cfg.AppName, cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("failed to start server: %v", err)
	}
}
