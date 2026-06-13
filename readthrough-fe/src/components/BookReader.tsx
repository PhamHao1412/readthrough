import React, { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { ArrowLeft, BookOpen, Copy, Check, AlertTriangle, Languages, Sparkles, X, Coffee, Sun, Moon, Star, Trash2, List, ChevronRight, Volume2, ChevronDown, ChevronUp } from 'lucide-react';
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
  isWord?: boolean;
  phonetic?: string;
  audioUrl?: string;
  partsOfSpeech?: any[];
  activeTab?: 'translate' | 'explain';
  explanation?: string;
  explainLoading?: boolean;
  explainError?: string;
  contextSentence?: string;
  isCached?: boolean;
}

// Lightweight Markdown helper
const renderMarkdown = (md: string) => {
  if (!md) return null;
  const paragraphs = md.split(/\n\n+/);
  return paragraphs.map((p, pIdx) => {
    const trimmed = p.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('#')) {
      const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const content = match[2];
        if (level === 1) return <h1 key={pIdx} className="md-h1">{renderInlineMarkdown(content)}</h1>;
        if (level === 2) return <h2 key={pIdx} className="md-h2">{renderInlineMarkdown(content)}</h2>;
        return <h3 key={pIdx} className="md-h3">{renderInlineMarkdown(content)}</h3>;
      }
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const lines = trimmed.split('\n')
        .map(l => l.trim())
        .filter(l => l.replace(/^[-*]\s*/, '').trim() !== '');
      if (lines.length === 0) return null;
      return (
        <ul key={pIdx} className="md-ul">
          {lines.map((l, lIdx) => (
            <li key={lIdx}>{renderInlineMarkdown(l.replace(/^[-*]\s+/, ''))}</li>
          ))}
        </ul>
      );
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const lines = trimmed.split('\n')
        .map(l => l.trim())
        .filter(l => l.replace(/^\d+\.\s*/, '').trim() !== '');
      if (lines.length === 0) return null;
      return (
        <ol key={pIdx} className="md-ol">
          {lines.map((l, lIdx) => (
            <li key={lIdx}>{renderInlineMarkdown(l.replace(/^\d+\.\s+/, ''))}</li>
          ))}
        </ol>
      );
    }

    return <p key={pIdx} className="md-p">{renderInlineMarkdown(trimmed)}</p>;
  });
};

const renderInlineMarkdown = (inlineText: string) => {
  const parts = inlineText.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
};

interface AutoScrollContainerProps {
  content: string;
  renderMarkdown: (md: string) => React.ReactNode;
  isCached?: boolean;
}

const AutoScrollContainer: React.FC<AutoScrollContainerProps> = ({ content, renderMarkdown, isCached }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      if (isCached) {
        containerRef.current.scrollTop = 0;
      } else {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    }
  }, [content, isCached]);

  return (
    <div
      ref={containerRef}
      className="explain-container"
      style={{ maxHeight: '200px', overflowY: 'auto' }}
    >
      {content ? renderMarkdown(content) : "No explanation available."}
    </div>
  );
};

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
      let isPresigned = false;
      try {
        const cacheName = 'readthrough-book-cache';
        const cacheKey = `/books/${book.id}/content`;
        const cache = await caches.open(cacheName);
        const cachedResponse = await cache.match(cacheKey);

        if (cachedResponse) {
          const blob = await cachedResponse.blob();
          if (!active) return;
          localBlobUrl = URL.createObjectURL(blob);
          setBlobUrl(localBlobUrl);
          setLoadingContent(false);
          console.log('[Cache] Loaded book instantly from local cache');
          return;
        }

        // 1. Get the download URL (either R2 pre-signed or backend local path)
        const urlRes = await fetchWithAuth(`/api/v1/books/${book.id}/download-url`);
        if (!urlRes.ok) throw new Error('Failed to retrieve download link.');
        const urlJson = await urlRes.json();
        
        if (!urlJson.succeeded || !urlJson.data?.url) {
          throw new Error('Invalid download response.');
        }

        const { url, is_presigned } = urlJson.data;
        isPresigned = !!is_presigned;

        // 2. Fetch the file based on whether it is a pre-signed Cloud URL or Local fallback
        let fileRes;
        if (isPresigned) {
          fileRes = await fetch(url);
        } else {
          fileRes = await fetchWithAuth(`/api/v1/books/${book.id}/content`);
        }

        if (!fileRes.ok) throw new Error('Failed to download book content file.');
        
        // Clone the response to store it in cache and get the blob for current render
        const fileResClone = fileRes.clone();
        const blob = await fileRes.blob();
        
        try {
          await cache.put(cacheKey, fileResClone);
          console.log('[Cache] Saved book content to local cache');
        } catch (cacheErr) {
          console.warn('[Cache] Failed to write to cache storage:', cacheErr);
        }

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
      if (localBlobUrl && localBlobUrl.startsWith('blob:')) {
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
  const [expandedSidebarContexts, setExpandedSidebarContexts] = useState<Record<string, boolean>>({});

  const toggleSidebarContext = (id: string) => {
    setExpandedSidebarContexts(prev => ({ ...prev, [id]: !prev[id] }));
  };

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
            ipa: entry.phonetic || '',
            part_of_speech: entry.partsOfSpeech?.[0]?.partOfSpeech || '',
            context_sentence: entry.contextSentence || '',
            audio_url: entry.audioUrl || '',
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

  const handlePdfPageChange = useCallback((page: number, total: number) => {
    saveProgress(page, '', total);
  }, [saveProgress]);

  const handleEpubProgressChange = useCallback((cfi: string) => {
    saveProgress(1, cfi);
  }, [saveProgress]);

  const handleTxtPageChange = useCallback((page: number, total: number) => {
    saveProgress(page, '', total);
  }, [saveProgress]);

  const getSentenceContext = (selectedText: string): string => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    const range = sel.getRangeAt(0);
    const container = range.startContainer;
    if (!container) return '';

    // Find the text layer container element (e.g. span or p representing the line)
    const currentLineElement = container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as HTMLElement);
    if (!currentLineElement) return '';

    // Get the parent text layer container (which contains all line elements)
    const textLayer = currentLineElement.parentElement;
    
    let fullText = currentLineElement.textContent || '';

    // If we have a text layer containing multiple line elements (typical in PDF and EPUB renderers)
    if (textLayer && textLayer.children.length > 1) {
      // Find the index of the current line among siblings
      const siblings = Array.from(textLayer.children);
      const curIdx = siblings.indexOf(currentLineElement);
      
      if (curIdx !== -1) {
        // Collect 1-2 lines before and 1-2 lines after to get complete sentences
        const linesBefore: string[] = [];
        const linesAfter: string[] = [];
        
        // Take up to 2 lines before
        for (let i = Math.max(0, curIdx - 2); i < curIdx; i++) {
          const text = siblings[i].textContent?.trim() || '';
          if (text) linesBefore.push(text);
        }
        
        // Take up to 2 lines after
        for (let i = curIdx + 1; i < Math.min(siblings.length, curIdx + 3); i++) {
          const text = siblings[i].textContent?.trim() || '';
          if (text) linesAfter.push(text);
        }

        // Combine them:
        // If the current line ends with a hyphen (like transac-), remove it and join directly
        let currentTextClean = currentLineElement.textContent || '';
        let nextTextCombined = linesAfter.join(' ');
        
        // Handle PDF hyphenation: e.g. transac- + tion
        if (currentTextClean.endsWith('-') || currentTextClean.endsWith('‐')) {
          // Remove hyphen and connect directly with the first word of the next line
          currentTextClean = currentTextClean.slice(0, -1);
          // Split the next line text by first space to get the first part
          const firstSpaceIdx = nextTextCombined.indexOf(' ');
          if (firstSpaceIdx !== -1) {
            const firstWord = nextTextCombined.substring(0, firstSpaceIdx);
            const rest = nextTextCombined.substring(firstSpaceIdx + 1);
            currentTextClean += firstWord;
            nextTextCombined = rest;
          } else {
            currentTextClean += nextTextCombined;
            nextTextCombined = '';
          }
        }
        
        fullText = [...linesBefore, currentTextClean, nextTextCombined].join(' ');
      }
    }

    // Now extract the sentence containing selectedText from the combined fullText
    if (fullText && fullText.includes(selectedText)) {
      const selIdx = fullText.indexOf(selectedText);
      let pStart = 0;
      for (let i = selIdx - 1; i >= 0; i--) {
        const char = fullText[i];
        if ((char === '.' || char === '!' || char === '?') && (i === fullText.length - 1 || /\s/.test(fullText[i + 1]))) {
          // Check for abbreviations
          const word = fullText.slice(Math.max(0, i - 3), i + 1);
          if (!/Mr\.|Dr\.|St\.|Ms\./i.test(word)) {
            pStart = i + 1;
            break;
          }
        }
      }
      
      let pEnd = fullText.length;
      for (let i = selIdx + selectedText.length; i < fullText.length; i++) {
        const char = fullText[i];
        if ((char === '.' || char === '!' || char === '?') && (i === fullText.length - 1 || /\s/.test(fullText[i + 1]))) {
          const word = fullText.slice(Math.max(0, i - 3), i + 1);
          if (!/Mr\.|Dr\.|St\.|Ms\./i.test(word)) {
            pEnd = i + 1;
            break;
          }
        }
      }
      
      let sentence = fullText.slice(pStart, pEnd).trim();
      
      // Cleanup extra whitespace and double spaces
      sentence = sentence.replace(/\s+/g, ' ');

      // Cap size to 350 chars
      if (sentence.length > 350) {
        const midIdx = sentence.indexOf(selectedText);
        if (midIdx !== -1) {
          const start = Math.max(0, midIdx - 150);
          const end = Math.min(sentence.length, midIdx + selectedText.length + 150);
          return (start > 0 ? '...' : '') + sentence.slice(start, end).trim() + (end < sentence.length ? '...' : '');
        }
      }
      
      return sentence;
    }

    return selectedText;
  };

  const handleSelection = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const contextSentence = getSentenceContext(text.trim());
    const id = Date.now();
    const entry: TranslationEntry = {
      id,
      original: text.trim(),
      translated: '',
      loading: true,
      error: '',
      activeTab: 'translate',
      contextSentence: contextSentence
    };
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
          prev.map(t => t.id === id ? {
            ...t,
            translated: json.data.translatedText,
            isWord: json.data.isWord,
            phonetic: json.data.phonetic,
            audioUrl: json.data.audioUrl,
            partsOfSpeech: json.data.partsOfSpeech,
            loading: false
          } : t)
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

  const fetchCardExplanation = async (entry: TranslationEntry) => {
    if (entry.explanation || entry.explainLoading) return;
    
    setTranslations(prev =>
      prev.map(t => t.id === entry.id ? { ...t, explainLoading: true, explainError: '' } : t)
    );
    
    try {
      const res = await fetchWithAuth('/api/v1/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: entry.original,
          context_sentence: entry.contextSentence || '',
          book_title: book.title || '',
          book_author: book.author || '',
          page_number: currentPage || 1,
        }),
      });

      if (!res.ok) throw new Error('Explanation failed');
      if (!res.body) throw new Error('ReadableStream is not supported by your browser.');

      setTranslations(prev =>
        prev.map(t => t.id === entry.id ? { ...t, explanation: '', explainLoading: false, isCached: false } : t)
      );

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let accumulatedText = '';
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.content) {
                accumulatedText += parsed.content;
                const hasCachedPrefix = accumulatedText.startsWith('[CACHED]');
                setTranslations(prev =>
                  prev.map(t => t.id === entry.id ? {
                    ...t,
                    explanation: hasCachedPrefix ? accumulatedText.slice(8) : accumulatedText,
                    isCached: hasCachedPrefix
                  } : t)
                );
              }
            } catch (e) {
              console.warn('Failed to parse SSE JSON chunk:', e, dataStr);
            }
          }
        }
      }

      if (buffer.trim().startsWith('data:')) {
        const dataStr = buffer.trim().slice(5).trim();
        try {
          const parsed = JSON.parse(dataStr);
          if (parsed.content) {
            accumulatedText += parsed.content;
            const hasCachedPrefix = accumulatedText.startsWith('[CACHED]');
            setTranslations(prev =>
              prev.map(t => t.id === entry.id ? {
                ...t,
                explanation: hasCachedPrefix ? accumulatedText.slice(8) : accumulatedText,
                isCached: hasCachedPrefix
              } : t)
            );
          }
        } catch (e) {
          console.warn('Failed to parse SSE JSON chunk:', e, dataStr);
        }
      }
    } catch (e: any) {
      setTranslations(prev =>
        prev.map(t => t.id === entry.id ? { ...t, explainError: e.message || 'AI service error', explainLoading: false } : t)
      );
    }
  };

  const playAudio = (url: string) => {
    if (!url) return;
    const audio = new Audio(url);
    audio.play().catch(e => console.error('Audio play error:', e));
  };

  const playSidebarWordAudio = (word: string, audioUrl?: string) => {
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

  const handleCopy = (entry: TranslationEntry) => {
    navigator.clipboard.writeText(entry.translated);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const removeTranslation = (id: number) => {
    setTranslations(prev => prev.filter(t => t.id !== id));
  };

  // Date grouping for sidebar vocabularies
  const getGroupedVocabularies = () => {
    const groups: Record<string, any[]> = {};
    
    bookVocab.forEach(v => {
      const date = new Date(v.created_at);
      const today = new Date();
      const yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      
      let dateKey = '';
      if (date.toDateString() === today.toDateString()) {
        dateKey = 'Today';
      } else if (date.toDateString() === yesterday.toDateString()) {
        dateKey = 'Yesterday';
      } else {
        dateKey = date.toLocaleDateString('en-US', {
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        });
      }
      
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(v);
    });
    
    return groups;
  };

  const renderSidebarPartOfSpeechBadge = (pos?: string) => {
    if (!pos) return null;
    const cleanPos = pos.trim().toLowerCase();
    let badgeClass = 'vocab-badge';
    if (['noun', 'verb', 'adjective', 'adverb'].includes(cleanPos)) {
      badgeClass += ` vocab-badge-${cleanPos}`;
    }
    return <span className={badgeClass} style={{ fontSize: '0.6rem', padding: '1px 4px', textTransform: 'uppercase' }}>{pos}</span>;
  };

  const highlightSidebarWordInSentence = (sentence: string, word: string) => {
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
                  onPageChange={handlePdfPageChange}
                  onSelection={handleSelection}
                  onOutlineLoaded={handleOutlineLoaded}
                />
              )}
              {book.file_type === 'epub' && (
                <EpubViewer
                  bookId={book.id}
                  url={contentUrl}
                  initialCfi={currentCfi}
                  onProgressChange={handleEpubProgressChange}
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
                  onPageChange={handleTxtPageChange}
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

                      {/* Mini Tabs inside the card */}
                      {!entry.loading && !entry.error && (
                        <div className="tooltip-tabs" style={{ margin: '4px -12px 8px -12px' }}>
                          <button
                            className={`tooltip-tab ${(!entry.activeTab || entry.activeTab === 'translate') ? 'active' : ''}`}
                            onClick={() => setTranslations(prev => prev.map(t => t.id === entry.id ? { ...t, activeTab: 'translate' } : t))}
                          >
                            Translate
                          </button>
                          <button
                            className={`tooltip-tab ${entry.activeTab === 'explain' ? 'active' : ''}`}
                            onClick={() => {
                              setTranslations(prev => prev.map(t => t.id === entry.id ? { ...t, activeTab: 'explain' } : t));
                              fetchCardExplanation(entry);
                            }}
                          >
                            AI Explain
                          </button>
                        </div>
                      )}

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

                      {!entry.loading && !entry.error && (!entry.activeTab || entry.activeTab === 'translate') && (
                        <>
                          <div className="translation-divider" />
                          <span className="translation-card-label">Vietnamese</span>
                          <p className="translation-result">{entry.translated}</p>

                          {/* Dictionary details in card */}
                          {entry.isWord && (
                            <div className="dict-word-container" style={{ marginTop: '8px' }}>
                              {(entry.phonetic || entry.audioUrl) && (
                                <div className="dict-phonetic-row">
                                  {entry.phonetic && (
                                    <span className="dict-phonetic-text">{entry.phonetic}</span>
                                  )}
                                  {entry.audioUrl && (
                                    <button
                                      className="dict-audio-btn"
                                      onClick={() => playAudio(entry.audioUrl!)}
                                      title="Listen pronunciation"
                                    >
                                      <Volume2 size={12} />
                                    </button>
                                  )}
                                </div>
                              )}

                              {entry.partsOfSpeech && entry.partsOfSpeech.map((pos: any, posIdx: number) => (
                                <div key={posIdx} className="dict-pos-section">
                                  <span className="dict-pos-badge">{pos.partOfSpeech}</span>
                                  <ul className="dict-definition-list">
                                    {pos.definitions && pos.definitions.map((def: any, defIdx: number) => (
                                      <li key={defIdx} className="dict-definition-item">
                                        • {def.definition}
                                        {def.example && (
                                          <span className="dict-example">Example: "{def.example}"</span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          )}

                          <button
                            className={`translation-copy-btn ${copiedId === entry.id ? 'copied' : ''}`}
                            onClick={() => handleCopy(entry)}
                            style={{ marginTop: '8px' }}
                          >
                            {copiedId === entry.id
                              ? <><Check size={12} /> Copied</>
                              : <><Copy size={12} /> Copy</>}
                          </button>
                        </>
                      )}

                      {!entry.loading && !entry.error && entry.activeTab === 'explain' && (
                        <>
                          <div className="translation-divider" />
                          {entry.explainLoading && (
                            <div className="translation-loading">
                              <div className="spinner-sm" />
                              <span>Analyzing grammar with AI...</span>
                            </div>
                          )}

                          {entry.explainError && (
                            <div className="translation-error">
                              <AlertTriangle size={14} />
                              <span>{entry.explainError}</span>
                            </div>
                          )}

                          {!entry.explainLoading && !entry.explainError && (
                            <AutoScrollContainer
                              content={entry.explanation || ''}
                              renderMarkdown={renderMarkdown}
                              isCached={entry.isCached}
                            />
                          )}

                          {!entry.explainLoading && !entry.explainError && entry.explanation && (
                            <button
                              className={`translation-copy-btn ${copiedId === entry.id ? 'copied' : ''}`}
                              onClick={() => {
                                navigator.clipboard.writeText(entry.explanation!);
                                setCopiedId(entry.id);
                                setTimeout(() => setCopiedId(null), 2000);
                              }}
                              style={{ marginTop: '8px' }}
                            >
                              {copiedId === entry.id
                                ? <><Check size={12} /> Copied</>
                                : <><Copy size={12} /> Copy</>}
                            </button>
                          )}
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
                  {Object.entries(getGroupedVocabularies()).map(([dateGroup, items]) => (
                    <div key={dateGroup} className="sidebar-vocab-date-group">
                      <div className="sidebar-vocab-date-header">{dateGroup}</div>
                      {items.map(v => (
                        <div key={v.id} className="sidebar-vocab-card">
                          <div className="sidebar-vocab-card-header">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <p className="sidebar-vocab-original" style={{ margin: 0 }}>"{v.original_text}"</p>
                              <div className="sidebar-vocab-meta-row">
                                {renderSidebarPartOfSpeechBadge(v.part_of_speech)}
                                {v.ipa && <span className="sidebar-vocab-ipa">[{v.ipa}]</span>}
                                <button
                                  className="sidebar-vocab-audio-btn"
                                  onClick={() => playSidebarWordAudio(v.original_text, v.audio_url)}
                                  title="Play pronunciation"
                                >
                                  <Volume2 size={10} />
                                </button>
                              </div>
                            </div>
                            <button
                              className="sidebar-vocab-delete"
                              onClick={() => handleDeleteBookVocab(v.id)}
                              title="Remove from notebook"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                          <p className="sidebar-vocab-translated">{v.translated_text}</p>
                          
                          {/* Context Sentence */}
                          {v.context_sentence && (
                            <div className="sidebar-vocab-context-box">
                              <button
                                className="sidebar-vocab-context-toggle"
                                onClick={() => toggleSidebarContext(v.id)}
                              >
                                {expandedSidebarContexts[v.id] ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                <span>Context</span>
                              </button>
                              {expandedSidebarContexts[v.id] && (
                                <p className="sidebar-vocab-context-text">
                                  {highlightSidebarWordInSentence(v.context_sentence, v.original_text)}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
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
