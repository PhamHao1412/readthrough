import React, { useState, useRef } from 'react';
import { UploadCloud, Search, BookOpen, FileText, FileDown, Plus, AlertCircle, CheckCircle, Loader2, Trash2 } from 'lucide-react';
import { Book } from './BookReader';

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    if (!file) return;
    const fileExt = file.name.split('.').pop()?.toLowerCase();
    if (fileExt !== 'pdf' && fileExt !== 'epub' && fileExt !== 'txt') {
      setError('Unsupported file format. Only .pdf, .epub, or .txt files are allowed.');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setError('');
    setSuccess('');

    const formData = new FormData();
    formData.append('file', file);
    const titleWithoutExt = file.name.substring(0, file.name.lastIndexOf('.'));
    formData.append('title', titleWithoutExt);
    formData.append('author', 'Anonymous Author');

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
            let msg = 'Upload failed.';
            try { msg = JSON.parse(xhr.responseText).message || msg; } catch {}
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

      setSuccess(`Successfully uploaded "${titleWithoutExt}"`);
      onUploadSuccess();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      setError(err.message || 'An error occurred during upload.');
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
          Upload new document
        </button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => e.target.files && handleUpload(e.target.files[0])}
          style={{ display: 'none' }}
          accept=".pdf,.epub,.txt"
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
          <p>Drag and drop .pdf, .epub, or .txt files here or click to start uploading.</p>
        </div>
      ) : (
        <div className="books-grid">
          {filteredBooks.map((book) => {
            const progressPercent = book.total_pages > 0
              ? Math.round((book.current_page / book.total_pages) * 100)
              : book.epub_cfi ? 50 : 0;

            return (
              <div
                key={book.id}
                className={`book-card type-${book.file_type}`}
                onClick={() => onSelectBook(book)}
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
                    {book.file_type === 'pdf' ? (
                      <FileDown size={22} />
                    ) : book.file_type === 'epub' ? (
                      <BookOpen size={22} />
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
                      {book.total_pages > 0 && book.file_type !== 'epub'
                        ? `Page ${book.current_page}/${book.total_pages}`
                        : book.file_type === 'epub'
                        ? 'EPUB'
                        : 'Unread'}
                    </span>
                  </div>
                  <div className="progress-track">
                    <div
                      className={`progress-fill ${book.file_type}`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
