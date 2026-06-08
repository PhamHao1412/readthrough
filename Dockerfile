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

# ========================
# Stage 2: Final Image
# ========================
FROM alpine:3.19

WORKDIR /app

# Install runtime dependencies and download pre-built goose binary
RUN apk add --no-cache ca-certificates wget && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then GOOSE_ARCH="x86_64"; \
    elif [ "$ARCH" = "aarch64" ]; then GOOSE_ARCH="arm64"; \
    else GOOSE_ARCH="x86_64"; fi && \
    wget -O /usr/local/bin/goose https://github.com/pressly/goose/releases/download/v3.22.0/goose_linux_${GOOSE_ARCH} && \
    chmod +x /usr/local/bin/goose

# Copy binary from builder
COPY --from=be-builder /app/serverd ./serverd

# Copy migration files
COPY --from=be-builder /app/readthrough-be/data ./data

# Copy entrypoint script
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Tạo file .env trống để tránh lỗi crash của thư viện lit/env
RUN touch .env

EXPOSE 8080

ENTRYPOINT ["./entrypoint.sh"]

