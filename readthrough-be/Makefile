.PHONY: help build run stop restart clean logs test migrate-up migrate-down dev
AUTHOR:= haopham1709
APP_NAME := readthrough-be
PORT := 8080

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dev: ## Run locally without Docker
	go run main.go

run: dev ## Alias for dev target to run backend


test: ## Run tests
	go test -v ./...

migrate-up: ## Run database migrations
	goose -dir data/migrations postgres "$(shell grep DB_URL .env | cut -d'=' -f2-)" up

migrate-down: ## Rollback database migrations
	goose -dir data/migrations postgres "$(shell grep DB_URL .env | cut -d'=' -f2-)" down
