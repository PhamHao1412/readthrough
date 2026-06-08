import React, { useEffect, useState, useCallback } from 'react';
import { Search, Trash2, Copy, Check, BookOpen, Sparkles, AlertTriangle, Volume2, ChevronDown, ChevronUp, Grid, Play, Shuffle, ArrowLeft, ArrowRight, RotateCw } from 'lucide-react';
import { Book } from './BookReader';
import { useAuth } from '../context/AuthContext';

export interface VocabularyItem {
  id: string;
  book_id: string;
  original_text: string;
  translated_text: string;
  ipa?: string;
  part_of_speech?: string;
  context_sentence?: string;
  audio_url?: string;
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

  // Advanced States
  const [activeTab, setActiveTab] = useState<'notebook' | 'flashcards'>('notebook');
  const [expandedContexts, setExpandedContexts] = useState<Record<string, boolean>>({});
  
  // Flashcards States
  const [studyList, setStudyList] = useState<VocabularyItem[]>([]);
  const [flashcardIndex, setFlashcardIndex] = useState<number>(0);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);

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
          // If we are currently studying, sync the study list too
          if (activeTab === 'flashcards') {
            setStudyList(json.data);
          }
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
  }, [filterBookId, searchQuery, activeTab]);

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
        setStudyList(prev => prev.filter(item => item.id !== id));
        // Reset index if out of bounds
        if (flashcardIndex >= Math.max(1, vocabList.length - 1)) {
          setFlashcardIndex(Math.max(0, vocabList.length - 2));
        }
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

  // Text-To-Speech Pronunciation Audio Playback
  const playWordAudio = (word: string, audioUrl?: string) => {
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      audio.play().catch(err => {
        console.warn('Network audio failed, falling back to Web Speech API:', err);
        speakWithBrowser(word);
      });
    } else {
      speakWithBrowser(word);
    }
  };

  const speakWithBrowser = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    } else {
      console.warn('Browser does not support Speech Synthesis');
    }
  };

  // Toggle Context expand/collapse
  const toggleContext = (id: string) => {
    setExpandedContexts(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Highlight word inside sentence
  const highlightWordInSentence = (sentence: string, word: string) => {
    if (!sentence || !word) return sentence;
    const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`\\b(${escapedWord})\\b`, 'gi');
    const parts = sentence.split(regex);
    return parts.map((part, index) => 
      regex.test(part) || part.toLowerCase() === word.toLowerCase() ? (
        <span key={index} className="vocab-context-highlight">{part}</span>
      ) : part
    );
  };

  // Render Part of Speech Badge
  const renderPartOfSpeechBadge = (pos?: string) => {
    if (!pos) return null;
    const cleanPos = pos.trim().toLowerCase();
    let badgeClass = 'vocab-badge';
    if (['noun', 'verb', 'adjective', 'adverb'].includes(cleanPos)) {
      badgeClass += ` vocab-badge-${cleanPos}`;
    }
    return <span className={badgeClass}>{pos}</span>;
  };

  // Flashcards navigation
  const startFlashcardStudy = () => {
    if (vocabList.length > 0) {
      setStudyList([...vocabList]);
      setFlashcardIndex(0);
      setIsFlipped(false);
      setActiveTab('flashcards');
    }
  };

  const nextFlashcard = () => {
    setIsFlipped(false);
    setTimeout(() => {
      setFlashcardIndex(prev => (prev + 1) % studyList.length);
    }, 150);
  };

  const prevFlashcard = () => {
    setIsFlipped(false);
    setTimeout(() => {
      setFlashcardIndex(prev => (prev - 1 + studyList.length) % studyList.length);
    }, 150);
  };

  const shuffleFlashcards = () => {
    setIsFlipped(false);
    setTimeout(() => {
      const shuffled = [...studyList].sort(() => Math.random() - 0.5);
      setStudyList(shuffled);
      setFlashcardIndex(0);
    }, 150);
  };

  return (
    <div className="vocab-manager">
      {/* Navigation Sub-Tabs */}
      <div className="vocab-manager-tabs">
        <button
          className={`vocab-manager-tab-btn ${activeTab === 'notebook' ? 'active' : ''}`}
          onClick={() => setActiveTab('notebook')}
        >
          <Grid size={16} />
          <span>Vocabulary Notebook</span>
        </button>
        <button
          className={`vocab-manager-tab-btn ${activeTab === 'flashcards' ? 'active' : ''}`}
          onClick={startFlashcardStudy}
          disabled={vocabList.length === 0}
          title={vocabList.length === 0 ? 'Save words to enable Flashcards' : 'Study Flashcards'}
        >
          <Play size={16} />
          <span>Flashcards ({vocabList.length})</span>
        </button>
      </div>

      {/* Filter and Search controls (shown in notebook tab only) */}
      {activeTab === 'notebook' && (
        <div className="vocab-filters">
          <div className="search-input-wrapper">
            <Search size={16} className="vocab-filter-icon" />
            <input
              type="text"
              placeholder="Search vocabulary or translation..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="filter-select-wrapper">
            <BookOpen size={16} className="vocab-filter-icon" />
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
      )}

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
      ) : activeTab === 'notebook' ? (
        /* Notebook Tab (Grid list view) */
        <div className="vocab-grid">
          {vocabList.map(item => (
            <div key={item.id} className="vocab-card">
              <div className="vocab-card-header">
                <div className="vocab-header-left">
                  <span className="vocab-source-book" onClick={() => handleGoToBook(item.book_id)} title="Read this book">
                    <BookOpen size={12} />
                    <span>{getBookTitle(item.book_id)}</span>
                  </span>
                  {renderPartOfSpeechBadge(item.part_of_speech)}
                </div>
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
                  <div className="vocab-word-row" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <p className="vocab-word" style={{ margin: 0 }}>"{item.original_text}"</p>
                    {item.ipa && <span className="vocab-ipa">[{item.ipa}]</span>}
                    <button
                      className="vocab-play-audio-btn"
                      onClick={() => playWordAudio(item.original_text, item.audio_url)}
                      title="Play pronunciation"
                    >
                      <Volume2 size={12} />
                    </button>
                  </div>
                </div>

                <div className="vocab-divider" />

                <div className="vocab-translation-section">
                  <span className="vocab-label">Translation</span>
                  <p className="vocab-translation">{item.translated_text}</p>
                </div>

                {/* Context Sentence toggle */}
                {item.context_sentence && (
                  <div className="vocab-context-section">
                    <button className="vocab-context-toggle" onClick={() => toggleContext(item.id)}>
                      {expandedContexts[item.id] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      <span>Context in Book</span>
                    </button>
                    {expandedContexts[item.id] && (
                      <p className="vocab-context-text">
                        {highlightWordInSentence(item.context_sentence, item.original_text)}
                      </p>
                    )}
                  </div>
                )}
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
      ) : (
        /* Flashcard Study Tab (Interactive 3D Flipping Card) */
        studyList.length > 0 && (
          <div className="flashcard-study-container">
            {/* Progress Bar & Counter */}
            <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <div className="flashcard-progress-bar-wrapper">
                <div
                  className="flashcard-progress-bar"
                  style={{ width: `${((flashcardIndex + 1) / studyList.length) * 100}%` }}
                />
              </div>
              <span className="flashcard-stats">
                {flashcardIndex + 1}/{studyList.length}
              </span>
            </div>

            {/* The 3D Flipping Card */}
            <div className="flashcard-card-wrapper" onClick={() => setIsFlipped(prev => !prev)}>
              <div className={`flashcard-card-inner ${isFlipped ? 'flipped' : ''}`}>
                
                {/* Front of Card */}
                <div className="flashcard-card-front">
                  <span className="vocab-source-book" style={{ position: 'absolute', top: '16px', left: '16px' }}>
                    <BookOpen size={12} />
                    <span>{getBookTitle(studyList[flashcardIndex].book_id)}</span>
                  </span>
                  
                  <h2 className="flashcard-word">
                    {studyList[flashcardIndex].original_text}
                  </h2>
                  
                  <div className="flashcard-ipa-row">
                    {studyList[flashcardIndex].part_of_speech && renderPartOfSpeechBadge(studyList[flashcardIndex].part_of_speech)}
                    {studyList[flashcardIndex].ipa && <span className="vocab-ipa" style={{ fontSize: '1rem' }}>[{studyList[flashcardIndex].ipa}]</span>}
                    <button
                      className="vocab-play-audio-btn"
                      onClick={(e) => {
                        e.stopPropagation(); // Avoid flipping the card
                        playWordAudio(studyList[flashcardIndex].original_text, studyList[flashcardIndex].audio_url);
                      }}
                      title="Play pronunciation"
                    >
                      <Volume2 size={14} />
                    </button>
                  </div>
                  
                  <div className="flashcard-hint">
                    <RotateCw size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                    Click to reveal translation
                  </div>
                </div>

                {/* Back of Card */}
                <div className="flashcard-card-back">
                  <div className="flashcard-back-content">
                    <span className="vocab-label" style={{ alignSelf: 'center' }}>Translation</span>
                    <p className="flashcard-translation">
                      {studyList[flashcardIndex].translated_text}
                    </p>
                    
                    {studyList[flashcardIndex].context_sentence && (
                      <div style={{ marginTop: '12px' }}>
                        <span className="vocab-label" style={{ display: 'block', marginBottom: '6px' }}>Context in Book</span>
                        <p className="flashcard-context">
                          {highlightWordInSentence(studyList[flashcardIndex].context_sentence!, studyList[flashcardIndex].original_text)}
                        </p>
                      </div>
                    )}
                  </div>
                  
                  <div className="flashcard-hint">
                    Click to view original
                  </div>
                </div>
                
              </div>
            </div>

            {/* Navigation & Shuffling controls */}
            <div className="flashcard-controls">
              <button className="flashcard-btn" onClick={prevFlashcard} title="Previous card">
                <ArrowLeft size={16} />
                <span>Previous</span>
              </button>
              
              <button className="flashcard-btn" onClick={shuffleFlashcards} title="Shuffle cards">
                <Shuffle size={16} />
                <span>Shuffle</span>
              </button>
              
              <button className="flashcard-btn flashcard-btn-accent" onClick={nextFlashcard} title="Next card">
                <span>Next</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
};
