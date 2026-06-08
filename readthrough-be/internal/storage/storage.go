package storage

import (
	"context"
	"io"
)

// Storage defines the interface for file operations.
type Storage interface {
	Upload(ctx context.Context, key string, r io.Reader, size int64, contentType string) (string, error)
	Download(ctx context.Context, key string) (io.ReadCloser, int64, string, error)
	Delete(ctx context.Context, key string) error
}
