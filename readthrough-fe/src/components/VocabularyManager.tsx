import React, { useEffect, useState, useCallback } from 'react';
import { Search, Trash2, Copy, Check, BookOpen, Sparkles, AlertTriangle } from 'lucide-react';
import { Book } from './BookReader';
import { useAuth } from '../context/AuthContext';

export interface VocabularyItem {
  id: string;
  book_id: string;
  original_text: string;
  translated_text: string;
  created_at: string;
}

interface VocabularyManagerProps {
  books: Book[];
  onSelectBook: (book: Book) => void;
}

export const VocabularyManager: React.FC<VocabularyManagerProps> = ({ books, onSelectBook }) => {
  const { fetchWithAuth } = useAuth();
  const [vocabList, setVocabList] = useState<VocabularyItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterBookId, setFilterBookId] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchVocabularies = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let url = '/api/v1/vocabularies';
      const params = new URLSearchParams();
      if (filterBookId !== 'all') {
        params.append('book_id', filterBookId);
      }
      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }
      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const res = await fetchWithAuth(url);
      if (res.ok) {
        const json = await res.json();
        if (json.succeeded && Array.isArray(json.data)) {
          setVocabList(json.data);
        } else {
          throw new Error(json.message || 'Failed to fetch vocabulary list.');
        }
      } else {
        throw new Error('Failed to fetch vocabulary list.');
      }
    } catch (e: any) {
      setError(e.message || 'Server connection error.');
    } finally {
      setLoading(false);
    }
  }, [filterBookId, searchQuery]);

  useEffect(() => {
    fetchVocabularies();
  }, [fetchVocabularies]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to remove this vocabulary item?')) return;
    try {
      const res = await fetchWithAuth(`/api/v1/vocabularies/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setVocabList(prev => prev.filter(item => item.id !== id));
      } else {
        alert('Failed to delete vocabulary item.');
      }
    } catch (e) {
      console.error(e);
      alert('An error occurred connecting to the server.');
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getBookTitle = (bookId: string) => {
    const book = books.find(b => b.id === bookId);
    return book ? book.title : 'Unknown document';
  };

  const handleGoToBook = (bookId: string) => {
    const book = books.find(b => b.id === bookId);
    if (book) {
      onSelectBook(book);
    }
  };

  return (
    <div className="vocab-manager">
      {/* Controls: Search and Book Filter */}
      <div className="vocab-filters">
        <div className="search-input-wrapper">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Search vocabulary or translation..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="filter-select-wrapper">
          <BookOpen size={16} className="filter-icon" />
          <select value={filterBookId} onChange={e => setFilterBookId(e.target.value)}>
            <option value="all">All Documents</option>
            {books.map(b => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading state */}
      {loading && vocabList.length === 0 ? (
        <div className="loading-state">
          <div className="spinner" />
          <span>Opening your vocabulary notebook...</span>
        </div>
      ) : error ? (
        <div className="error-state">
          <AlertTriangle size={32} />
          <p>{error}</p>
        </div>
      ) : vocabList.length === 0 ? (
        <div className="vocab-empty">
          <div className="vocab-empty-icon">
            <Sparkles size={32} />
          </div>
          <h3>Vocabulary notebook is empty</h3>
          <p>
            {searchQuery || filterBookId !== 'all'
              ? 'No matching vocabulary items found.'
              : 'Highlight words while reading and click the star button to save them here.'}
          </p>
        </div>
      ) : (
        <div className="vocab-grid">
          {vocabList.map(item => (
            <div key={item.id} className="vocab-card">
              <div className="vocab-card-header">
                <span className="vocab-source-book" onClick={() => handleGoToBook(item.book_id)} title="Open this book">
                  <BookOpen size={12} />
                  <span>{getBookTitle(item.book_id)}</span>
                </span>
                <button
                  className="vocab-delete-btn"
                  onClick={() => handleDelete(item.id)}
                  title="Remove from notebook"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="vocab-card-body">
                <div className="vocab-word-section">
                  <span className="vocab-label">Original</span>
                  <p className="vocab-word">"{item.original_text}"</p>
                </div>

                <div className="vocab-divider" />

                <div className="vocab-translation-section">
                  <span className="vocab-label">Translation</span>
                  <p className="vocab-translation">{item.translated_text}</p>
                </div>
              </div>

              <div className="vocab-card-footer">
                <span className="vocab-date">
                  Saved: {new Date(item.created_at).toLocaleDateString('en-US')}
                </span>
                <button
                  className={`vocab-copy-btn ${copiedId === item.id ? 'copied' : ''}`}
                  onClick={() => handleCopy(item.translated_text, item.id)}
                >
                  {copiedId === item.id ? (
                    <>
                      <Check size={12} />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
