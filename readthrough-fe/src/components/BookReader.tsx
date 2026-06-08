import React, { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { ArrowLeft, BookOpen, Copy, Check, AlertTriangle, Languages, Sparkles, X, Coffee, Sun, Moon, Star, Trash2, List, ChevronRight } from 'lucide-react';
import { PdfViewer } from './PdfViewer';
import { EpubViewer } from './EpubViewer';
import { TxtViewer } from './TxtViewer';
import { useAuth } from '../context/AuthContext';


export interface Book {
  id: string;
  title: string;
  author: string;
  file_type: string;
  file_size: number;
  current_page: number;
  epub_cfi: string;
  total_pages: number;
}

interface TranslationEntry {
  id: number;
  dbId?: string;
  original: string;
  translated: string;
  loading: boolean;
  error: string;
  saving?: boolean;
}

interface BookReaderProps {
  book: Book;
  onBack: () => void;
  theme: 'light' | 'dark' | 'sepia';
  onThemeChange: () => void;
}

export const BookReader: React.FC<BookReaderProps> = ({ book, onBack, theme, onThemeChange }) => {
  const { fetchWithAuth } = useAuth();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState<boolean>(true);
  const [contentError, setContentError] = useState<string>('');

  // Table of Contents and Navigation states
  const [outline, setOutline] = useState<any[]>([]);
  const [tocOpen, setTocOpen] = useState<boolean>(() => {
    return localStorage.getItem('readthrough_toc_open') === 'true';
  });
  const [currentPage, setCurrentPage] = useState<number>(book.current_page || 1);
  const [currentCfi, setCurrentCfi] = useState<string>(book.epub_cfi || '');
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const [tocWidth, setTocWidth] = useState<number>(() => {
    const saved = localStorage.getItem('readthrough_toc_width');
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 200 && parsed <= 500) {
        return parsed;
      }
    }
    return 260;
  });
  const [isTocResizing, setIsTocResizing] = useState<boolean>(false);

  // Refs for click-outside-to-close TOC
  const tocSidebarRef = useRef<HTMLElement>(null);
  const tocToggleBtnRef = useRef<HTMLButtonElement>(null);
  const tocResizerRef = useRef<HTMLDivElement>(null);
  // Ref for TOC scroll container (auto-scroll active item into view)
  const tocBodyRef = useRef<HTMLDivElement>(null);

  const startTocResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsTocResizing(true);
  }, []);

  const resizeToc = useCallback((e: MouseEvent) => {
    if (!isTocResizing) return;
    const newWidth = e.clientX;
    if (newWidth >= 200 && newWidth <= Math.min(500, window.innerWidth * 0.4)) {
      setTocWidth(newWidth);
    }
  }, [isTocResizing]);

  const stopTocResize = useCallback(() => {
    if (isTocResizing) {
      setIsTocResizing(false);
      localStorage.setItem('readthrough_toc_width', tocWidth.toString());
    }
  }, [isTocResizing, tocWidth]);

  useEffect(() => {
    if (isTocResizing) {
      window.addEventListener('mousemove', resizeToc);
      window.addEventListener('mouseup', stopTocResize);
    } else {
      window.removeEventListener('mousemove', resizeToc);
      window.removeEventListener('mouseup', stopTocResize);
    }
    return () => {
      window.removeEventListener('mousemove', resizeToc);
      window.removeEventListener('mouseup', stopTocResize);
    };
  }, [isTocResizing, resizeToc, stopTocResize]);

  // Reset outline and navigation states when switching books
  useEffect(() => {
    setOutline([]);
    setCurrentPage(book.current_page || 1);
    setCurrentCfi(book.epub_cfi || '');
    setExpandedItems({});
  }, [book.id]);

  const handleOutlineLoaded = useCallback((loadedOutline: any[]) => {
    setOutline(loadedOutline);
  }, []);

  // ── Compute the active TOC path based on current reading position ──
  const activeTocPath = useMemo(() => {
    if (outline.length === 0) return null;

    if (book.file_type === 'pdf') {
      // Walk the tree and find the item with the highest page number <= currentPage
      const findBest = (items: any[], path = ''): { path: string | null; page: number } => {
        let best: { path: string | null; page: number } = { path: null, page: -1 };
        items.forEach((item, idx) => {
          const itemPath = path ? `${path}-${idx}` : `${idx}`;
          if (typeof item.target === 'number' && item.target <= currentPage && item.target > best.page) {
            best = { path: itemPath, page: item.target };
          }
          if (item.children?.length > 0) {
            const childBest = findBest(item.children, itemPath);
            if (childBest.page > best.page) best = childBest;
          }
        });
        return best;
      };
      return findBest(outline).path;
    }

    if (book.file_type === 'epub' && currentCfi) {
      // Walk the tree and find the item whose CFI matches exactly
      const findCfi = (items: any[], path = ''): string | null => {
        for (let idx = 0; idx < items.length; idx++) {
          const itemPath = path ? `${path}-${idx}` : `${idx}`;
          if (items[idx].target === currentCfi) return itemPath;
          if (items[idx].children?.length > 0) {
            const found = findCfi(items[idx].children, itemPath);
            if (found) return found;
          }
        }
        return null;
      };
      return findCfi(outline);
    }

    return null;
  }, [outline, currentPage, currentCfi, book.file_type]);

  // Auto-expand all ancestor nodes of the active TOC item
  useEffect(() => {
    if (!activeTocPath) return;
    const parts = activeTocPath.split('-');
    if (parts.length <= 1) return; // top-level, no parents to expand
    const parentPaths: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      parentPaths.push(parts.slice(0, i).join('-'));
    }
    setExpandedItems(prev => {
      const next = { ...prev };
      parentPaths.forEach(p => { next[p] = true; });
      return next;
    });
  }, [activeTocPath]);

  // Auto-scroll active TOC item into view whenever it changes or TOC opens
  useEffect(() => {
    if (!activeTocPath || !tocOpen) return;
    const timer = setTimeout(() => {
      const container = tocBodyRef.current;
      if (!container) return;
      const el = container.querySelector<HTMLElement>(`[data-toc-path="${activeTocPath}"]`);
      if (!el) return;

      // Manual scroll within the container — avoids scrollIntoView which can
      // shift browser focus when in keyboard-interaction mode.
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const elRelTop = elRect.top - containerRect.top + container.scrollTop;
      const elRelBottom = elRelTop + elRect.height;
      const containerScrollBottom = container.scrollTop + container.clientHeight;

      if (elRelTop < container.scrollTop) {
        container.scrollTo({ top: elRelTop - 8, behavior: 'smooth' });
      } else if (elRelBottom > containerScrollBottom) {
        container.scrollTo({ top: elRelBottom - container.clientHeight + 8, behavior: 'smooth' });
      }

      // Defensive: if focus somehow landed on the TOC button or inside the sidebar, release it
      const focused = document.activeElement as HTMLElement | null;
      if (
        focused &&
        (focused === tocToggleBtnRef.current ||
          tocSidebarRef.current?.contains(focused))
      ) {
        focused.blur();
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [activeTocPath, tocOpen]);

  const handleTocToggle = () => {
    const nextState = !tocOpen;
    setTocOpen(nextState);
    localStorage.setItem('readthrough_toc_open', nextState.toString());
  };

  // Close TOC when clicking outside the sidebar (and not on the toggle button)
  useEffect(() => {
    if (!tocOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      // Don't close while actively dragging the resize handle
      if (isTocResizing) return;
      const target = e.target as Node;
      if (
        tocSidebarRef.current &&
        !tocSidebarRef.current.contains(target) &&
        tocToggleBtnRef.current &&
        !tocToggleBtnRef.current.contains(target) &&
        tocResizerRef.current &&
        !tocResizerRef.current.contains(target)
      ) {
        setTocOpen(false);
        localStorage.setItem('readthrough_toc_open', 'false');
        // Prevent browser returning focus to the toggle button after panel closes
        tocToggleBtnRef.current?.blur();
        (document.activeElement as HTMLElement)?.blur();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [tocOpen, isTocResizing]);

  // Keyboard shortcut: Escape → close TOC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const isEditable =
        tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable;
      if (isEditable) return;

      if (e.key === 'Escape' && tocOpen) {
        setTocOpen(false);
        localStorage.setItem('readthrough_toc_open', 'false');
        // Prevent browser from auto-focusing the toggle button after close
        tocToggleBtnRef.current?.blur();
        (document.activeElement as HTMLElement)?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tocOpen]);

  const handleOutlineClick = (target: any) => {
    if (target === null || target === undefined) return;
    if (typeof target === 'number') {
      setCurrentPage(target);
      saveProgress(target, '', book.total_pages);
    } else if (typeof target === 'string') {
      setCurrentCfi(target);
      saveProgress(1, target);
    }
  };

  const toggleExpand = useCallback((path: string) => {
    setExpandedItems(prev => ({
      ...prev,
      [path]: !prev[path]
    }));
  }, []);

  const renderOutlineItems = (items: any[], depth = 0, path = ''): React.ReactNode => {
    return items.map((item, idx) => {
      const itemPath = path ? `${path}-${idx}` : `${idx}`;
      const hasChildren = item.children && item.children.length > 0;
      const isExpanded = !!expandedItems[itemPath];
      const isActive = itemPath === activeTocPath;

      return (
        <div key={itemPath} className="toc-node">
          <div
            className={`toc-item-row ${isActive ? 'active' : ''}`}
            style={{ paddingLeft: `${depth * 16}px` }}
            data-toc-path={itemPath}
          >
            {/* Expand/Collapse Toggle Button */}
            {hasChildren ? (
              <button
                className={`toc-toggle-btn ${isExpanded ? 'expanded' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(itemPath);
                }}
              >
                <ChevronRight size={14} />
              </button>
            ) : (
              <div className="toc-toggle-spacer" />
            )}

            {/* Clickable jump link */}
            <button
              className={`toc-item-content-btn ${item.target !== null ? 'has-target' : ''} depth-${depth} ${isActive ? 'active' : ''}`}
              onClick={() => {
                if (item.target !== null) handleOutlineClick(item.target);
              }}
            >
              <span className="toc-item-text" title={item.title}>
                {item.title}
              </span>
              {item.target !== null && typeof item.target === 'number' && (
                <span className="toc-item-page">p. {item.target}</span>
              )}
            </button>
          </div>

          {/* Children */}
          {hasChildren && isExpanded && (
            <div className="toc-children">
              {renderOutlineItems(item.children, depth + 1, itemPath)}
            </div>
          )}
        </div>
      );
    });
  };

  useEffect(() => {
    let active = true;
    let localBlobUrl = '';

    const fetchContent = async () => {
      setLoadingContent(true);
      setContentError('');
      try {
        const res = await fetchWithAuth(`/api/v1/books/${book.id}/content`);
        if (!res.ok) throw new Error('Failed to load this book content.');
        const blob = await res.blob();
        if (!active) return;
        localBlobUrl = URL.createObjectURL(blob);
        setBlobUrl(localBlobUrl);
      } catch (err: any) {
        if (active) setContentError(err.message || 'Error loading book.');
      } finally {
        if (active) setLoadingContent(false);
      }
    };

    fetchContent();

    return () => {
      active = false;
      if (localBlobUrl) {
        URL.revokeObjectURL(localBlobUrl);
      }
    };
  }, [book.id, fetchWithAuth]);

  const [translations, setTranslations] = useState<TranslationEntry[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);


  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('readthrough_sidebar_width');
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 250 && parsed <= 600) {
        return parsed;
      }
    }
    return 320;
  });
  const [isResizing, setIsResizing] = useState(false);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    const newWidth = window.innerWidth - e.clientX;
    if (newWidth >= 250 && newWidth <= Math.min(600, window.innerWidth * 0.6)) {
      setSidebarWidth(newWidth);
    }
  }, [isResizing]);

  const stopResize = useCallback(() => {
    if (isResizing) {
      setIsResizing(false);
      localStorage.setItem('readthrough_sidebar_width', sidebarWidth.toString());
    }
  }, [isResizing, sidebarWidth]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResize);
    } else {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResize);
    }
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResize);
    };
  }, [isResizing, resize, stopResize]);

  // Sidebar Sub-tabs states
  const [sidebarTab, setSidebarTab] = useState<'lookup' | 'vocab'>('lookup');
  const [bookVocab, setBookVocab] = useState<any[]>([]);
  const [loadingBookVocab, setLoadingBookVocab] = useState<boolean>(false);

  const fetchBookVocabularies = useCallback(async () => {
    setLoadingBookVocab(true);
    try {
      const res = await fetchWithAuth(`/api/v1/vocabularies?book_id=${book.id}`);
      if (res.ok) {
        const json = await res.json();
        if (json.succeeded && Array.isArray(json.data)) {
          setBookVocab(json.data);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingBookVocab(false);
    }
  }, [book.id]);

  useEffect(() => {
    if (sidebarOpen && sidebarTab === 'vocab') {
      fetchBookVocabularies();
    }
  }, [sidebarOpen, sidebarTab, fetchBookVocabularies]);

  const toggleSaveVocabulary = useCallback(async (entry: TranslationEntry) => {
    if (!entry.translated || entry.loading || entry.saving) return;

    // Set saving state
    setTranslations(prev => prev.map(t => t.id === entry.id ? { ...t, saving: true } : t));

    if (entry.dbId) {
      // Unsave (Delete from DB)
      try {
        const res = await fetchWithAuth(`/api/v1/vocabularies/${entry.dbId}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          setTranslations(prev => prev.map(t => t.id === entry.id ? { ...t, dbId: undefined, saving: false } : t));
          fetchBookVocabularies();
        } else {
          alert('Failed to remove vocabulary.');
          setTranslations(prev => prev.map(t => t.id === entry.id ? { ...t, saving: false } : t));
        }
      } catch (e) {
        console.error(e);
        alert('Server connection error.');
        setTranslations(prev => prev.map(t => t.id === entry.id ? { ...t, saving: false } : t));
      }
    } else {
      // Save (Add to DB)
      try {
        const res = await fetchWithAuth('/api/v1/vocabularies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            book_id: book.id,
            original_text: entry.original,
            translated_text: entry.translated,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.succeeded && json.data?.id) {
            setTranslations(prev => prev.map(t => t.id === entry.id ? { ...t, dbId: json.data.id, saving: false } : t));
            fetchBookVocabularies();
          } else {
            throw new Error(json.message);
          }
        } else {
          throw new Error('Service failed');
        }
      } catch (e) {
        console.error(e);
        alert('Failed to save vocabulary.');
        setTranslations(prev => prev.map(t => t.id === entry.id ? { ...t, saving: false } : t));
      }
    }
  }, [book.id, fetchBookVocabularies]);

  const handleDeleteBookVocab = async (vocabId: string) => {
    try {
      const res = await fetchWithAuth(`/api/v1/vocabularies/${vocabId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setBookVocab(prev => prev.filter(v => v.id !== vocabId));
        // Also update any matching item in history translations list to unstar it
        setTranslations(prev => prev.map(t => t.dbId === vocabId ? { ...t, dbId: undefined } : t));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const saveProgress = useCallback(async (page: number, cfi: string = '', totalPages: number = 0) => {
    setCurrentPage(page);
    if (cfi) setCurrentCfi(cfi);
    try {
      await fetchWithAuth(`/api/v1/books/${book.id}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_page: page, epub_cfi: cfi, total_pages: totalPages }),
      });
    } catch (err) {
      console.error('Failed to sync reading progress:', err);
    }
  }, [book.id]);

  const handleSelection = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const id = Date.now();
    const entry: TranslationEntry = { id, original: text.trim(), translated: '', loading: true, error: '' };
    setTranslations(prev => [entry, ...prev]);

    // Auto-open sidebar when translating
    setSidebarOpen(true);

    try {
      const res = await fetchWithAuth('/api/v1/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      });
      if (!res.ok) throw new Error('Translation failed');
      const json = await res.json();
      if (json.succeeded && json.data?.translatedText) {
        setTranslations(prev =>
          prev.map(t => t.id === id ? { ...t, translated: json.data.translatedText, loading: false } : t)
        );
      } else {
        throw new Error(json.message || 'Translation not found');
      }
    } catch (e: any) {
      setTranslations(prev =>
        prev.map(t => t.id === id ? { ...t, error: e.message, loading: false } : t)
      );
    }
  }, []);

  const handleCopy = (entry: TranslationEntry) => {
    navigator.clipboard.writeText(entry.translated);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const removeTranslation = (id: number) => {
    setTranslations(prev => prev.filter(t => t.id !== id));
  };

  const contentUrl = blobUrl || '';

  return (
    <div className="reader-shell">
      {/* Top Toolbar */}
      <header className="reader-toolbar">
        <div className="reader-toolbar-left">
          <button className="toolbar-back-btn" onClick={onBack} title="Back to library">
            <ArrowLeft size={16} />
            <span>Library</span>
          </button>
          <div className="toolbar-divider" />
          <button
            ref={tocToggleBtnRef}
            className={`toolbar-toc-btn ${tocOpen ? 'active' : ''}`}
            onClick={handleTocToggle}
            title="Book table of contents"
          >
            <List size={16} />
            <span>Table of Contents</span>
          </button>
          <div className="toolbar-divider" />
          <div className="reader-book-meta">
            <BookOpen size={15} className="reader-book-icon" />
            <span className="reader-book-title">{book.title}</span>
          </div>
        </div>

        <div className="reader-toolbar-right">
          <div className="reader-hint">
            <Sparkles size={13} />
            <span>Highlight to translate</span>
          </div>
          <span className={`reader-type-badge type-${book.file_type}`}>{book.file_type.toUpperCase()}</span>
          <button
            className="theme-btn"
            onClick={onThemeChange}
            title="Switch theme (Light/Dark/Sepia)"
          >
            {theme === 'light' && <Moon size={15} />}
            {theme === 'dark' && <Coffee size={15} />}
            {theme === 'sepia' && <Sun size={15} />}
          </button>
          <button
            className={`sidebar-toggle-btn ${sidebarOpen ? 'active' : ''}`}
            onClick={() => setSidebarOpen(o => !o)}
            title="Translation panel"
          >
            <Languages size={16} />
            {translations.length > 0 && <span className="sidebar-badge">{translations.filter(t => !t.loading).length}</span>}
          </button>
        </div>
      </header>

      {/* Body: PDF + Sidebar */}
      <div className={`reader-body ${isResizing || isTocResizing ? 'is-resizing' : ''}`}>
        {/* TOC Sidebar */}
        <aside
          ref={tocSidebarRef}
          className={`reader-toc-sidebar ${tocOpen ? 'open' : 'closed'} ${isTocResizing ? 'no-transition' : ''}`}
          style={{
            width: tocOpen ? `${tocWidth}px` : '0px',
          }}
        >
          <div className="toc-header">
            <h3>Table of Contents</h3>
          </div>
          <div ref={tocBodyRef} className="toc-body">
            {outline.length === 0 ? (
              <div className="toc-empty">
                <p>This document does not have an automatic table of contents.</p>
              </div>
            ) : (
              <nav className="toc-list">
                {renderOutlineItems(outline)}
              </nav>
            )}
          </div>
        </aside>

        {/* TOC Resizer */}
        {tocOpen && (
          <div
            ref={tocResizerRef}
            className={`reader-toc-resizer ${isTocResizing ? 'resizing' : ''}`}
            onMouseDown={startTocResize}
          />
        )}

        {/* PDF Area */}
        <div className="reader-content">
          {loadingContent ? (
            <div className="reader-loading-state">
              <div className="spinner" />
              <span>Decrypting and loading document...</span>
            </div>
          ) : contentError ? (
            <div className="reader-error-state">
              <AlertTriangle size={32} />
              <p>{contentError}</p>
              <button onClick={onBack}>Back to library</button>
            </div>
          ) : (
            <>
              {book.file_type === 'pdf' && (
                <PdfViewer
                  bookId={book.id}
                  url={contentUrl}
                  initialPage={currentPage}
                  onPageChange={(page, total) => saveProgress(page, '', total)}
                  onSelection={handleSelection}
                  onOutlineLoaded={handleOutlineLoaded}
                />
              )}
              {book.file_type === 'epub' && (
                <EpubViewer
                  bookId={book.id}
                  url={contentUrl}
                  initialCfi={currentCfi}
                  onProgressChange={(cfi) => saveProgress(1, cfi)}
                  onSelection={handleSelection}
                  theme={theme}
                  onOutlineLoaded={handleOutlineLoaded}
                />
              )}
              {book.file_type === 'txt' && (
                <TxtViewer
                  bookId={book.id}
                  url={contentUrl}
                  initialPage={currentPage}
                  onPageChange={(page, total) => saveProgress(page, '', total)}
                  onSelection={handleSelection}
                />
              )}
            </>
          )}
        </div>

        {/* Resizer */}
        {sidebarOpen && (
          <div
            className={`reader-resizer ${isResizing ? 'resizing' : ''}`}
            onMouseDown={startResize}
          />
        )}

        {/* Translation Sidebar */}
        <aside
          className={`reader-sidebar ${sidebarOpen ? 'open' : 'closed'} ${isResizing ? 'no-transition' : ''}`}
          style={{ width: sidebarOpen ? `${sidebarWidth}px` : '0px' }}
        >
          <div className="sidebar-header">
            <div className="sidebar-header-tabs">
              <button
                className={`sidebar-header-tab ${sidebarTab === 'lookup' ? 'active' : ''}`}
                onClick={() => setSidebarTab('lookup')}
              >
                Lookup
              </button>
              <button
                className={`sidebar-header-tab ${sidebarTab === 'vocab' ? 'active' : ''}`}
                onClick={() => setSidebarTab('vocab')}
              >
                Saved words
              </button>
            </div>
            {sidebarTab === 'lookup' && translations.length > 0 && (
              <button
                className="sidebar-clear-btn"
                onClick={() => setTranslations([])}
                title="Clear all history"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="sidebar-body">
            {sidebarTab === 'lookup' ? (
              translations.length === 0 ? (
                <div className="sidebar-empty">
                  <div className="sidebar-empty-icon">
                    <Languages size={28} />
                  </div>
                  <p>Highlight text in the document to see the translation here</p>
                </div>
              ) : (
                <div className="translation-list">
                  {translations.map(entry => (
                    <div key={entry.id} className="translation-card">
                      <div className="translation-card-header">
                        <span className="translation-card-label">Original</span>
                        <div className="translation-card-actions">
                          <button
                            className={`translation-card-save ${entry.dbId ? 'saved' : ''} ${entry.saving ? 'saving' : ''}`}
                            onClick={() => toggleSaveVocabulary(entry)}
                            disabled={entry.loading || entry.saving}
                            title={entry.dbId ? "Remove from notebook" : "Save to notebook"}
                          >
                            <Star size={13} fill={entry.dbId ? "currentColor" : "none"} />
                          </button>
                          <button
                            className="translation-card-remove"
                            onClick={() => removeTranslation(entry.id)}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                      <p className="translation-original">"{entry.original}"</p>

                      {entry.loading && (
                        <div className="translation-loading">
                          <div className="spinner-sm" />
                          <span>Translating...</span>
                        </div>
                      )}

                      {entry.error && (
                        <div className="translation-error">
                          <AlertTriangle size={14} />
                          <span>{entry.error}</span>
                        </div>
                      )}

                      {!entry.loading && !entry.error && (
                        <>
                          <div className="translation-divider" />
                          <span className="translation-card-label">Vietnamese</span>
                          <p className="translation-result">{entry.translated}</p>
                          <button
                            className={`translation-copy-btn ${copiedId === entry.id ? 'copied' : ''}`}
                            onClick={() => handleCopy(entry)}
                          >
                            {copiedId === entry.id
                              ? <><Check size={12} /> Copied</>
                              : <><Copy size={12} /> Copy</>}
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : (
              /* Book Saved Vocabulary tab */
              loadingBookVocab ? (
                <div className="vocab-loading-state">
                  <div className="spinner-sm" />
                  <span>Loading vocabulary...</span>
                </div>
              ) : bookVocab.length === 0 ? (
                <div className="sidebar-empty">
                  <div className="sidebar-empty-icon">
                    <Star size={28} />
                  </div>
                  <p>No vocabulary items saved for this book yet. Click the star button to save.</p>
                </div>
              ) : (
                <div className="sidebar-vocab-list">
                  {bookVocab.map(v => (
                    <div key={v.id} className="sidebar-vocab-card">
                      <div className="sidebar-vocab-card-header">
                        <p className="sidebar-vocab-original">"{v.original_text}"</p>
                        <button
                          className="sidebar-vocab-delete"
                          onClick={() => handleDeleteBookVocab(v.id)}
                          title="Remove from notebook"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <p className="sidebar-vocab-translated">{v.translated_text}</p>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
