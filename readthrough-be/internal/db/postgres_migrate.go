package db

import (
	"log"
	"readthrough-be/internal/entity"

	"gorm.io/gorm"
)

func AutoMigrateAndSeed(dbConn *gorm.DB) error {
	log.Println("Database AutoMigrate starting...")
	err := dbConn.AutoMigrate(
		&entity.User{},
		&entity.RefreshToken{},
		&entity.Book{},
		&entity.Vocabulary{},
	)
	if err != nil {
		return err
	}
	log.Println("Database AutoMigrate completed successfully.")
	return nil
}
