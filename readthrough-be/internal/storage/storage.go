package storage

import (
	"context"
	"io"
)

// Storage defines the interface for file operations.
type Storage interface {
	Upload(ctx context.Context, key string, r io.Reader, size int64, contentType string) (string, error)
	Download(ctx context.Context, key string) (io.ReadCloser, int64, string, error)
	// DownloadRange fetches a byte range of the file. rangeHeader is the raw
	// value of the HTTP Range header (e.g. "bytes=0-65535"). Returns the
	// partial body, the byte range returned (Content-Range value), the full
	// file size, the content type, and the HTTP status (200 or 206).
	DownloadRange(ctx context.Context, key string, rangeHeader string) (io.ReadCloser, string, int64, string, int, error)
	Delete(ctx context.Context, key string) error
	GetPresignedURL(ctx context.Context, key string) (string, bool, error)
	// GetLocalPath returns the absolute filesystem path for the given key.
	// Returns ("", false, nil) if the storage backend is not local (e.g. R2/S3).
	GetLocalPath(ctx context.Context, key string) (path string, ok bool, err error)
}
