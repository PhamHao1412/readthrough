# ========================
# Stage 1: Build Frontend
# ========================
FROM node:20-alpine AS fe-builder

WORKDIR /app/readthrough-fe

# Install dependencies
COPY readthrough-fe/package.json readthrough-fe/package-lock.json ./
RUN npm ci

# Copy source and build
COPY readthrough-fe/ ./
RUN npm run build

# ========================
# Stage 2: Build Backend
# ========================
FROM golang:1.25-alpine AS be-builder

WORKDIR /app/readthrough-be

# Install build dependencies
RUN apk add --no-cache gcc musl-dev

# Download Go modules (cached layer)
COPY readthrough-be/go.mod readthrough-be/go.sum ./
RUN go mod download

# Copy backend source
COPY readthrough-be/ ./

# Build app binary
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/serverd .

# Build goose migration tool
RUN CGO_ENABLED=0 GOOS=linux go install github.com/pressly/goose/v3/cmd/goose@v3.22.0

# ========================
# Stage 3: Final Image
# ========================
FROM alpine:3.19

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache ca-certificates

# Copy binary from builder
COPY --from=be-builder /app/serverd ./serverd

# Copy goose from builder
COPY --from=be-builder /root/go/bin/goose /usr/local/bin/goose

# Copy migration files
COPY --from=be-builder /app/readthrough-be/data ./data

# Copy built frontend assets
COPY --from=fe-builder /app/readthrough-fe/dist ./readthrough-fe/dist

# Copy entrypoint script
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["./entrypoint.sh"]
