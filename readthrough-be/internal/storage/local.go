package storage

import (
	"context"
	"io"
	"os"
	"path/filepath"
)

// LocalStorage implements the Storage interface using the local filesystem.
type LocalStorage struct {
	uploadDir string
}

// NewLocalStorage creates a new LocalStorage instance.
func NewLocalStorage(uploadDir string) *LocalStorage {
	if uploadDir == "" {
		uploadDir = "uploads"
	}
	return &LocalStorage{uploadDir: uploadDir}
}

// Upload saves a file to the local filesystem.
func (s *LocalStorage) Upload(ctx context.Context, key string, r io.Reader, size int64, contentType string) (string, error) {
	if _, err := os.Stat(s.uploadDir); os.IsNotExist(err) {
		if err := os.MkdirAll(s.uploadDir, 0755); err != nil {
			return "", err
		}
	}

	filePath := filepath.Join(s.uploadDir, key)
	dst, err := os.Create(filePath)
	if err != nil {
		return "", err
	}
	defer dst.Close()

	if _, err = io.Copy(dst, r); err != nil {
		return "", err
	}

	return filePath, nil
}

// Download opens a file from the local filesystem.
func (s *LocalStorage) Download(ctx context.Context, key string) (io.ReadCloser, int64, string, error) {
	filePath := filepath.Join(s.uploadDir, key)
	file, err := os.Open(filePath)
	if err != nil {
		return nil, 0, "", err
	}

	stat, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, 0, "", err
	}

	return file, stat.Size(), "application/octet-stream", nil
}

// Delete removes a file from the local filesystem.
func (s *LocalStorage) Delete(ctx context.Context, key string) error {
	filePath := filepath.Join(s.uploadDir, key)
	return os.Remove(filePath)
}

// GetPresignedURL returns empty values since LocalStorage does not support pre-signed URLs.
func (s *LocalStorage) GetPresignedURL(ctx context.Context, key string) (string, bool, error) {
	return "", false, nil
}
