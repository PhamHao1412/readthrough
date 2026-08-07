package service

import (
	"io"
	"sync"

	"github.com/google/uuid"
)

// UploadProgressTracker stores in-memory upload progress for ongoing uploads.
// Key: book UUID → Value: percentage int (0-100).
// Intentionally in-process only: if the server restarts, orphaned "uploading"
// books are marked "failed" on startup via CleanupOrphanedUploads.
type UploadProgressTracker struct {
	m sync.Map
}

func (t *UploadProgressTracker) Set(id uuid.UUID, pct int) { t.m.Store(id, pct) }

func (t *UploadProgressTracker) Get(id uuid.UUID) int {
	v, ok := t.m.Load(id)
	if !ok {
		return 0
	}
	return v.(int)
}

func (t *UploadProgressTracker) Delete(id uuid.UUID) { t.m.Delete(id) }

// GlobalUploadTracker is the singleton progress store used by BookService.
var GlobalUploadTracker = &UploadProgressTracker{}

// ProgressReader wraps an io.Reader and fires onProgress(0-100) after each read.
type ProgressReader struct {
	r          io.Reader
	total      int64
	read       int64
	onProgress func(pct int)
}

func NewProgressReader(r io.Reader, total int64, onProgress func(pct int)) *ProgressReader {
	return &ProgressReader{r: r, total: total, onProgress: onProgress}
}

func (pr *ProgressReader) Read(p []byte) (n int, err error) {
	n, err = pr.r.Read(p)
	pr.read += int64(n)
	if pr.total > 0 && pr.onProgress != nil {
		pct := int(pr.read * 100 / pr.total)
		if pct > 100 {
			pct = 100
		}
		pr.onProgress(pct)
	}
	return
}
