import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Type } from 'lucide-react';

interface TxtViewerProps {
  bookId: string;
  url: string;
  initialPage: number;
  onPageChange: (page: number, total: number) => void;
  onSelection: (text: string, x?: number, y?: number) => void;
  readThroughActive?: boolean;
  rtSettings?: {
    fontFamily: string;
    fontSizeLevel: number;
    margin: string;
    lineHeight: string;
  };
}

const CHARS_PER_PAGE = 2500;

export const TxtViewer: React.FC<TxtViewerProps> = React.memo(({
  bookId,
  url,
  initialPage,
  onPageChange,
  onSelection,
  readThroughActive = false,
  rtSettings,
}) => {
  const [pages, setPages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(initialPage || 1);
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem(`readthrough_font_size_txt_${bookId}`);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 14 && parsed <= 32) {
        return parsed;
      }
    }
    return 18;
  });

  useEffect(() => {
    localStorage.setItem(`readthrough_font_size_txt_${bookId}`, fontSize.toString());
  }, [fontSize, bookId]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const fetchText = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load text file.');
        const raw = await res.text();
        if (!active) return;

        const paginated: string[] = [];
        for (let i = 0; i < raw.length; i += CHARS_PER_PAGE) {
          paginated.push(raw.slice(i, i + CHARS_PER_PAGE));
        }
        setPages(paginated);
        const start = initialPage > 0 && initialPage <= paginated.length ? initialPage : 1;
        setCurrentPage(start);
        onPageChange(start, paginated.length);
      } catch (e: any) {
        if (active) setError('Failed to open text file. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchText();
    return () => { active = false; };
  }, [url]);

  const changePage = useCallback((offset: number) => {
    const next = currentPage + offset;
    if (next >= 1 && next <= pages.length) {
      setCurrentPage(next);
      onPageChange(next, pages.length);
      if (textRef.current) textRef.current.scrollTop = 0;
    }
  }, [currentPage, pages.length, onPageChange]);

  // Arrow key navigation and Command +/- Zoom
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      if (isCmdOrCtrl) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          setFontSize(p => Math.min(32, p + 2));
        } else if (e.key === '-') {
          e.preventDefault();
          setFontSize(p => Math.max(14, p - 2));
        }
      } else {
        if (e.key === 'ArrowRight') {
          (document.activeElement as HTMLElement)?.blur();
          changePage(1);
        } else if (e.key === 'ArrowLeft') {
          (document.activeElement as HTMLElement)?.blur();
          changePage(-1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [changePage, setFontSize]);

  // Reset scroll position to top when page changes
  useEffect(() => {
    if (textRef.current) {
      textRef.current.scrollTop = 0;
    }
  }, [currentPage]);

  // Handle next/prev page events from BookReader
  useEffect(() => {
    const handleNext = () => {
      changePage(1);
    };
    const handlePrev = () => {
      changePage(-1);
    };

    window.addEventListener('readthrough-next-page', handleNext);
    window.addEventListener('readthrough-prev-page', handlePrev);
    return () => {
      window.removeEventListener('readthrough-next-page', handleNext);
      window.removeEventListener('readthrough-prev-page', handlePrev);
    };
  }, [changePage]);

  const handleMouseUp = (e: React.MouseEvent) => {
    e.stopPropagation(); // Stop event from reaching browser extensions
    // Skip – double-click will be handled by handleDblClick
    if (e.detail >= 2) return;
    const sel = window.getSelection();
    if (!sel) return;
    const text = sel.toString().trim();
    if (text.length > 0) {
      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.bottom;
        onSelection(text, x, y);
      } catch (err) {
        onSelection(text);
      }
    }
  };

  const handleDblClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Stop event from reaching browser extensions
    // Use setTimeout to let the browser finalize its native word selection first
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

      // Strip leading/trailing punctuation so double-clicking "word," returns "word"
      const raw = sel.toString();
      const cleaned = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
      if (!cleaned) return;

      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.bottom;
        onSelection(cleaned, x, y);
      } catch (err) {
        onSelection(cleaned);
      }
    }, 10);
  };

  const txtStyles = readThroughActive && rtSettings ? {
    fontFamily: rtSettings.fontFamily === 'serif' ? "'Lora', Georgia, serif" :
                rtSettings.fontFamily === 'sans-serif' ? "'Inter', sans-serif" :
                rtSettings.fontFamily === 'monospace' ? "'JetBrains Mono', monospace" :
                rtSettings.fontFamily === 'dyslexic' ? "'Atkinson Hyperlegible', sans-serif" : undefined,
    fontSize: `${14 + (rtSettings.fontSizeLevel - 1) * 2}px`,
    lineHeight: rtSettings.lineHeight,
    paddingLeft: rtSettings.margin === 'narrow' ? '4%' : rtSettings.margin === 'normal' ? '12%' : '20%',
    paddingRight: rtSettings.margin === 'narrow' ? '4%' : rtSettings.margin === 'normal' ? '12%' : '20%',
  } : {
    fontSize: `${fontSize}px`
  };

  if (loading) {
    return (
      <div className="loading-state">
        <div className="spinner" />
        <span>Reading text document...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-state">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="txt-viewer">
      {/* Controls */}
      {!readThroughActive && (
        <div className="txt-controls">
          <div className="pdf-controls-group">
            <button className="ctrl-btn" onClick={() => changePage(-1)} disabled={currentPage <= 1}>
              <ChevronLeft size={20} />
            </button>
            <span className="ctrl-label">Page {currentPage} / {pages.length}</span>
            <button className="ctrl-btn" onClick={() => changePage(1)} disabled={currentPage >= pages.length}>
              <ChevronRight size={20} />
            </button>
          </div>

          <div className="pdf-controls-group">
            <button className="ctrl-btn" onClick={() => setFontSize(p => Math.max(14, p - 2))} title="Decrease font size">
              <Type size={13} />
            </button>
            <span className="ctrl-label">Font size: {fontSize}px</span>
            <button className="ctrl-btn" onClick={() => setFontSize(p => Math.min(32, p + 2))} title="Increase font size">
              <Type size={20} />
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="txt-body" ref={textRef} onMouseUp={handleMouseUp} onDoubleClick={handleDblClick}>
        <div className="txt-content" style={txtStyles}>
          {pages[currentPage - 1]}
        </div>
      </div>
    </div>
  );
});
