import React, { useEffect, useRef, useState } from 'react';
import Epub from 'epubjs';
import { ChevronLeft, ChevronRight, Type } from 'lucide-react';

interface EpubViewerProps {
  bookId: string;
  url: string;
  initialCfi: string;
  onProgressChange: (cfi: string) => void;
  onSelection: (text: string) => void;
  theme: 'light' | 'dark' | 'sepia';
  onOutlineLoaded?: (outline: any[]) => void;
}

export const EpubViewer: React.FC<EpubViewerProps> = ({
  bookId,
  url,
  initialCfi,
  onProgressChange,
  onSelection,
  theme,
  onOutlineLoaded,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem(`readthrough_font_size_epub_${bookId}`);
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 80 && parsed <= 200) {
        return parsed;
      }
    }
    return 100;
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<any>(null);
  const renditionRef = useRef<any>(null);

  useEffect(() => {
    let active = true;
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';

    const loadEpub = async () => {
      setLoading(true);
      setError('');
      try {
        const book = Epub(url);
        bookRef.current = book;
        await book.ready;
        if (!active) return;

        // Load TOC if callback exists
        if (onOutlineLoaded && book.navigation?.toc) {
          const mapEpubToc = (items: any[]): any[] => {
            return items.map(item => {
              const mappedItem: any = {
                title: item.label?.trim() || '',
                target: item.href,
              };
              if (item.subitems && item.subitems.length > 0) {
                mappedItem.children = mapEpubToc(item.subitems);
              }
              return mappedItem;
            });
          };
          onOutlineLoaded(mapEpubToc(book.navigation.toc));
        }

        const rendition = book.renderTo(containerRef.current!, {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'scrolled-doc',
        });
        renditionRef.current = rendition;

        rendition.hooks.content.register((contents: any) => {
          const doc = contents.document;
          // Stop propagation inside the iframe to block external extensions
          doc.addEventListener('mouseup', (e: MouseEvent) => {
            e.stopPropagation();
          }, true);
          doc.addEventListener('dblclick', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
          }, true);
          // Keydown listener inside the iframe for arrow navigation and Command +/- Zoom
          doc.addEventListener('keydown', (e: KeyboardEvent) => {
            const isCmdOrCtrl = e.metaKey || e.ctrlKey;
            if (isCmdOrCtrl) {
              if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                setFontSize(p => Math.min(200, p + 10));
              } else if (e.key === '-') {
                e.preventDefault();
                setFontSize(p => Math.max(80, p - 10));
              }
            } else {
              if (e.key === 'ArrowRight') {
                (doc.activeElement as HTMLElement)?.blur();
                (window.document.activeElement as HTMLElement)?.blur();
                rendition.next();
              } else if (e.key === 'ArrowLeft') {
                (doc.activeElement as HTMLElement)?.blur();
                (window.document.activeElement as HTMLElement)?.blur();
                rendition.prev();
              }
            }
          });
        });

        await rendition.display(initialCfi || undefined);
        if (!active) return;

        rendition.themes.register('light', {
          body: {
            'font-family': "'Lora', 'Playfair Display', Georgia, serif !important",
            'line-height': '1.85 !important',
            'font-size': `${fontSize}% !important`,
            'color': '#1a1916 !important',
            'background-color': '#ffffff !important',
            'padding': '0 24px !important',
          },
          p: {
            'margin-bottom': '1.5em !important',
            'text-align': 'justify !important',
          }
        });

        rendition.themes.register('dark', {
          body: {
            'font-family': "'Lora', 'Playfair Display', Georgia, serif !important",
            'line-height': '1.85 !important',
            'font-size': `${fontSize}% !important`,
            'color': '#f0ede8 !important',
            'background-color': '#2a2926 !important',
            'padding': '0 24px !important',
          },
          p: {
            'margin-bottom': '1.5em !important',
            'text-align': 'justify !important',
          }
        });

        rendition.themes.register('sepia', {
          body: {
            'font-family': "'Lora', 'Playfair Display', Georgia, serif !important",
            'line-height': '1.85 !important',
            'font-size': `${fontSize}% !important`,
            'color': '#433422 !important',
            'background-color': '#faf6eb !important',
            'padding': '0 24px !important',
          },
          p: {
            'margin-bottom': '1.5em !important',
            'text-align': 'justify !important',
          }
        });

        rendition.themes.select(theme);

        rendition.on('relocated', (location: any) => {
          if (location?.start?.cfi) onProgressChange(location.start.cfi);

          // Ensure the iframe document scrolls to top on section transitions
          try {
            const iframe = containerRef.current?.querySelector('iframe');
            if (iframe && iframe.contentWindow) {
              iframe.contentWindow.scrollTo(0, 0);
              if (iframe.contentDocument) {
                if (iframe.contentDocument.body) iframe.contentDocument.body.scrollTop = 0;
                if (iframe.contentDocument.documentElement) iframe.contentDocument.documentElement.scrollTop = 0;
              }
            }
          } catch (err) {
            console.error('Failed to reset epub iframe scroll:', err);
          }
        });

        rendition.on('selected', (_cfiRange: string, contents: any) => {
          const sel = contents.window.getSelection();
          const text = sel?.toString().trim();
          if (text && text.length > 0) {
            onSelection(text);
          }
        });

      } catch (e: any) {
        if (active) setError('Failed to open EPUB file. Please check file structure.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadEpub();
    return () => {
      active = false;
      if (bookRef.current) bookRef.current.destroy();
    };
  }, [url]);

  // Jump to specific CFI location (TOC jumps)
  useEffect(() => {
    if (renditionRef.current && initialCfi) {
      const currentLocation = renditionRef.current.location?.start?.cfi;
      if (currentLocation !== initialCfi) {
        renditionRef.current.display(initialCfi);
      }
    }
  }, [initialCfi]);

  useEffect(() => {
    if (renditionRef.current) {
      renditionRef.current.themes.select(theme);
    }
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(`readthrough_font_size_epub_${bookId}`, fontSize.toString());
    if (renditionRef.current) {
      renditionRef.current.themes.fontSize(`${fontSize}%`);
    }
  }, [fontSize, bookId]);

  // Arrow key navigation and Command +/- Zoom for the main window (when focus is outside the EPUB iframe)
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
          setFontSize(p => Math.min(200, p + 10));
        } else if (e.key === '-') {
          e.preventDefault();
          setFontSize(p => Math.max(80, p - 10));
        }
      } else {
        if (e.key === 'ArrowRight') {
          (document.activeElement as HTMLElement)?.blur();
          renditionRef.current?.next();
        } else if (e.key === 'ArrowLeft') {
          (document.activeElement as HTMLElement)?.blur();
          renditionRef.current?.prev();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [setFontSize]);

  return (
    <div className="epub-viewer">
      {/* Controls */}
      <div className="epub-controls">
        <div className="pdf-controls-group">
          <button
            className="ctrl-btn"
            onClick={() => renditionRef.current?.prev()}
            title="Previous page"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="ctrl-label">Navigation</span>
          <button
            className="ctrl-btn"
            onClick={() => renditionRef.current?.next()}
            title="Next page"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="pdf-controls-group">
          <button
            className="ctrl-btn"
            onClick={() => setFontSize(p => Math.max(80, p - 10))}
            title="Decrease font size"
          >
            <Type size={13} />
          </button>
          <span className="ctrl-label">Font size: {fontSize}%</span>
          <button
            className="ctrl-btn"
            onClick={() => setFontSize(p => Math.min(200, p + 10))}
            title="Increase font size"
          >
            <Type size={20} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="loading-state" style={{ flex: 1 }}>
          <div className="spinner" />
          <span>Loading EPUB document...</span>
        </div>
      )}

      {error && !loading && (
        <div className="error-state" style={{ flex: 1 }}>
          <p>{error}</p>
        </div>
      )}

      {/* Book container */}
      <div
        ref={containerRef}
        className="epub-container"
        style={{ display: loading || error ? 'none' : 'block' }}
      />
    </div>
  );
};
