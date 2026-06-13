import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Type } from 'lucide-react';

interface TxtViewerProps {
  bookId: string;
  url: string;
  initialPage: number;
  onPageChange: (page: number, total: number) => void;
  onSelection: (text: string) => void;
}

const CHARS_PER_PAGE = 2500;

export const TxtViewer: React.FC<TxtViewerProps> = React.memo(({ bookId, url, initialPage, onPageChange, onSelection }) => {
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

  const handleMouseUp = (e: React.MouseEvent) => {
    e.stopPropagation(); // Stop event from reaching browser extensions
    const sel = window.getSelection();
    if (!sel) return;
    const text = sel.toString().trim();
    if (text.length > 0) {
      onSelection(text);
    }
  };

  const handleDblClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Stop event from reaching browser extensions
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

      {/* Content */}
      <div className="txt-body" ref={textRef} onMouseUp={handleMouseUp} onDoubleClick={handleDblClick}>
        <div className="txt-content" style={{ fontSize: `${fontSize}px` }}>
          {pages[currentPage - 1]}
        </div>
      </div>
    </div>
  );
});
