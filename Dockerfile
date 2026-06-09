# ========================
# Stage 1: Build Backend
# ========================
FROM golang:1.25-alpine AS be-builder

WORKDIR /app/readthrough-be

# Download Go modules (cached layer using BuildKit cache mounts)
COPY readthrough-be/go.mod readthrough-be/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

# Copy backend source
COPY readthrough-be/ ./

# Build app binary using BuildKit cache mounts for Go build cache
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=linux go build -o /app/serverd .

# Build goose binary directly using Go toolchain (multi-arch support, avoids runtime download)
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=linux go install github.com/pressly/goose/v3/cmd/goose@v3.22.0

# ========================
# Stage 2: Final Image
# ========================
FROM alpine:3.19

WORKDIR /app

# Install runtime dependencies (only ca-certificates needed)
RUN apk add --no-cache ca-certificates

# Copy binary from builder
COPY --from=be-builder /app/serverd ./serverd
COPY --from=be-builder /go/bin/goose /usr/local/bin/goose

# Copy migration files
COPY --from=be-builder /app/readthrough-be/data ./data

# Copy entrypoint script and prepare env
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh && touch .env

EXPOSE 8080

ENTRYPOINT ["./entrypoint.sh"]


