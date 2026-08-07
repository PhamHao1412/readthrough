import React, { useState, useRef, useEffect, useCallback } from 'react';
import { UploadCloud, Search, BookOpen, FileText, FileDown, Plus, AlertCircle, CheckCircle, Loader2, Trash2, Sparkles, X } from 'lucide-react';
import { Book } from './BookReader';
import { PasteMarkdownModal } from './PasteMarkdownModal';

interface BookListProps {
  books: Book[];
  onSelectBook: (book: Book) => void;
  onUploadSuccess: () => void;
  onDeleteBook: (id: string) => void;
}

export const BookList: React.FC<BookListProps> = ({
  books,
  onSelectBook,
  onUploadSuccess,
  onDeleteBook,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [isPasteModalOpen, setIsPasteModalOpen] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [localProgress, setLocalProgress] = useState<Record<string, number>>({});

  // ── Polling for uploading books ────────────────────────────────────────────
  // When any book has upload_status="uploading", poll its status every 2s
  // so the UI reflects progress without a full page reload.
  const hasUploading = books.some(b => b.upload_status === 'uploading');

  const pollUploadingBooks = useCallback(async () => {
    const uploadingBooks = books.filter(b => b.upload_status === 'uploading');
    if (uploadingBooks.length === 0) return;
    onUploadSuccess();
  }, [books, onUploadSuccess]);

  useEffect(() => {
    if (!hasUploading) return;
    const timer = setInterval(pollUploadingBooks, 2000);
    return () => clearInterval(timer);
  }, [hasUploading, pollUploadingBooks]);
  // ──────────────────────────────────────────────────────────────────────────

  const handleUpload = async (file: File) => {
    if (!file) return;
    const fileExt = file.name.split('.').pop()?.toLowerCase();
    if (fileExt !== 'pdf' && fileExt !== 'epub' && fileExt !== 'txt' && fileExt !== 'md') {
      setError('Unsupported file format. Only .pdf, .epub, .txt, or .md files are allowed.');
      return;
    }

    setError('');
    setSuccess('');

    const titleWithoutExt = file.name.substring(0, file.name.lastIndexOf('.'));
    const token = localStorage.getItem('readthrough_access_token');
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    try {
      // ── Step 1: Request presigned URL & create book record in DB (instant) ─
      const presignRes = await fetch('/api/v1/books/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          filename: file.name,
          file_size: file.size,
          content_type: file.type || 'application/octet-stream',
          title: titleWithoutExt,
          author: 'Anonymous Author',
        }),
      });

      if (!presignRes.ok) {
        const data = await presignRes.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to initiate upload.');
      }

      const presignData = await presignRes.json();
      const { book, upload_url: uploadUrl, is_presigned: isPresigned } = presignData.data;

      // Immediately refresh the book list so the card appears with "Processing..." status
      onUploadSuccess();

      if (isPresigned && uploadUrl) {
        // ── Step 2: Background upload to R2 (non-blocking) ─────────────────
        setLocalProgress(prev => ({ ...prev, [book.id]: 0 }));

        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 100);
            setLocalProgress(prev => ({ ...prev, [book.id]: pct }));
          }
        });

        xhr.onload = async () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              // ── Step 3: Tell server upload is done ──────────────────────────
              const finalizeRes = await fetch(`/api/v1/books/${book.id}/finalize`, {
                method: 'POST',
                headers: authHeaders,
              });
              if (finalizeRes.ok) {
                onUploadSuccess();
                setSuccess(`Successfully uploaded "${titleWithoutExt}"`);
                setTimeout(() => setSuccess(''), 4000);
              } else {
                setError(`Failed to finalize "${titleWithoutExt}".`);
              }
            } catch (err: any) {
              setError(`Finalize error for "${titleWithoutExt}".`);
            }
          } else {
            setError(`R2 upload failed (${xhr.status}).`);
          }
          setLocalProgress(prev => {
            const next = { ...prev };
            delete next[book.id];
            return next;
          });
        };

        xhr.onerror = () => {
          setError(`Network error uploading "${titleWithoutExt}".`);
          setLocalProgress(prev => {
            const next = { ...prev };
            delete next[book.id];
            return next;
          });
        };

        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.send(file);

      } else {
        // ── Fallback: Local storage multipart upload (background) ────────────
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', titleWithoutExt);
        formData.append('author', 'Anonymous Author');

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/v1/books/upload');
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.onload = () => {
          onUploadSuccess();
        };
        xhr.send(formData);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during upload.');
    }
  };

  const handlePasteSave = async (content: string, title: string, author: string) => {
    const file = new File([content], `${title}.md`, { type: 'text/markdown' });

    setUploading(true);
    setUploadProgress(0);
    setError('');
    setSuccess('');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);
    formData.append('author', author);

    try {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
      });

      const uploadPromise = new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            let msg = 'Save failed.';
            try { msg = JSON.parse(xhr.responseText).message || msg; } catch { }
            reject(new Error(msg));
          }
        };
        xhr.onerror = () => reject(new Error('Server connection error.'));
      });

      xhr.open('POST', '/api/v1/books/upload');
      const token = localStorage.getItem('readthrough_access_token');
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      xhr.send(formData);
      await uploadPromise;

      setSuccess(`Successfully created and saved "${title}"`);
      onUploadSuccess();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'An error occurred during save.');
      throw err;
    } finally {
      setUploading(false);
    }
  };

  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.[0]) handleUpload(e.dataTransfer.files[0]);
  };

  const filteredBooks = books.filter(b =>
    b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (b.author && b.author.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="booklist-wrapper">
      {/* Search + Upload Bar */}
      <div className="booklist-topbar">
        <div className="search-wrapper">
          <span className="search-icon">
            <Search size={17} />
          </span>
          <input
            type="text"
            className="search-input"
            placeholder="Search books, documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <button
          className="upload-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <Plus size={17} />
          Upload file
        </button>
        <button
          className="paste-btn"
          onClick={() => setIsPasteModalOpen(true)}
          disabled={uploading}
        >
          <Sparkles size={17} />
          Paste Markdown
        </button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => e.target.files && handleUpload(e.target.files[0])}
          style={{ display: 'none' }}
          accept=".pdf,.epub,.txt,.md"
        />
      </div>

      {/* Alerts */}
      {error && (
        <div className="alert alert-error">
          <AlertCircle size={17} />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="alert alert-success">
          <CheckCircle size={17} />
          <span>{success}</span>
        </div>
      )}

      {/* Upload Progress */}
      {uploading && (
        <div className="upload-progress">
          <div className="upload-progress-header">
            <span>
              <Loader2 size={14} style={{ animation: 'spin 0.7s linear infinite', color: 'var(--accent)' }} />
              Uploading file to server...
            </span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}

      {/* Books grid or empty state */}
      {filteredBooks.length === 0 ? (
        <div
          className="empty-state"
          onDragOver={onDragOver}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="empty-state-icon">
            <UploadCloud size={64} />
          </div>
          <h3>Library is empty</h3>
          <p>Drag and drop .pdf, .epub, .txt, or .md files here or click to start uploading.</p>
        </div>
      ) : (
        <div className="books-grid">
          {filteredBooks.map((book) => {
            const isUploading = book.upload_status === 'uploading';
            const isFailed   = book.upload_status === 'failed';
            const cloudPct   = localProgress[book.id] ?? (book.upload_progress ?? 0);
            const progressPercent = book.total_pages > 0 && book.file_type !== 'md'
              ? Math.round((book.current_page / book.total_pages) * 100)
              : (book.epub_cfi || book.file_type === 'md') ? 50 : 0;

            return (
              <div
                key={book.id}
                className={`book-card type-${book.file_type}${isUploading ? ' book-card--uploading' : ''}${isFailed ? ' book-card--failed' : ''}`}
                onClick={() => !isUploading && !isFailed && onSelectBook(book)}
                style={{ cursor: isUploading || isFailed ? 'default' : 'pointer' }}
              >
                <button
                  className="delete-book-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteBook(book.id);
                  }}
                  title="Delete book"
                >
                  <Trash2 size={15} />
                </button>
                <div className="book-card-top">
                  <div className={`book-type-icon ${book.file_type}`}>
                    {isUploading ? (
                      <UploadCloud size={22} style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
                    ) : isFailed ? (
                      <X size={22} />
                    ) : book.file_type === 'pdf' ? (
                      <FileDown size={22} />
                    ) : book.file_type === 'epub' ? (
                      <BookOpen size={22} />
                    ) : book.file_type === 'md' ? (
                      <Sparkles size={22} />
                    ) : (
                      <FileText size={22} />
                    )}
                  </div>
                  <div className="book-info">
                    <div className="book-title">{book.title}</div>
                    <div className="book-author">{book.author || 'Anonymous Author'}</div>
                  </div>
                </div>

                <div className="book-card-footer">
                  <div className="book-meta">
                    <span>{book.file_type.toUpperCase()} • {formatSize(book.file_size)}</span>
                    <span>
                      {isUploading
                        ? `Processing... ${cloudPct}%`
                        : isFailed
                          ? 'Upload failed'
                          : book.total_pages > 0 && book.file_type !== 'epub' && book.file_type !== 'md'
                            ? `Page ${book.current_page}/${book.total_pages}`
                            : book.file_type === 'epub' || book.file_type === 'md'
                              ? book.file_type.toUpperCase()
                              : 'Unread'}
                    </span>
                  </div>
                  <div className="progress-track">
                    {isUploading ? (
                      <div
                        className="progress-fill upload-progress-fill"
                        style={{ width: `${cloudPct}%`, transition: 'width 0.4s ease' }}
                      />
                    ) : isFailed ? (
                      <div className="progress-fill failed-progress-fill" style={{ width: '100%' }} />
                    ) : (
                      <div
                        className={`progress-fill ${book.file_type}`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <PasteMarkdownModal
        isOpen={isPasteModalOpen}
        onClose={() => setIsPasteModalOpen(false)}
        onSave={handlePasteSave}
      />
    </div>
  );
};
