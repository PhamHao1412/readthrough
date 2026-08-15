import React, { useEffect, useRef, useState } from 'react';
import Epub from 'epubjs';
import { ChevronLeft, ChevronRight, Type } from 'lucide-react';

interface EpubViewerProps {
  bookId: string;
  url: string;
  initialCfi: string;
  onProgressChange: (cfi: string) => void;
  onSelection: (text: string, x?: number, y?: number) => void;
  theme: 'light' | 'dark' | 'sepia' | 'oled' | 'mint' | 'eink';
  onOutlineLoaded?: (outline: any[]) => void;
  readThroughActive?: boolean;
  rtSettings?: {
    fontFamily: string;
    fontSizeLevel: number;
    margin: string;
    lineHeight: string;
  };
}

const WORD_CHAR = /^[\p{L}\p{N}_']$/u;

/**
 * Walk the DOM tree to find the previous TEXT_NODE sibling (across inline elements).
 * Stops at block-level boundaries to avoid crossing paragraph/section borders.
 */
const getPrevTextNode = (node: Node): Text | null => {
  const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR']);
  let cur: Node | null = node;
  while (cur) {
    let prev: Node = cur.previousSibling!;
    if (prev) {
      // Walk to the deepest last descendant
      while (prev.lastChild) prev = prev.lastChild;
      if (prev.nodeType === Node.TEXT_NODE) return prev as Text;
      if (prev.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((prev as Element).tagName)) return null;
      cur = prev;
    } else {
      cur = cur.parentNode;
      if (!cur || (cur.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((cur as Element).tagName))) return null;
    }
  }
  return null;
};

/**
 * Walk the DOM tree to find the next TEXT_NODE sibling (across inline elements).
 */
const getNextTextNode = (node: Node): Text | null => {
  const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR']);
  let cur: Node | null = node;
  while (cur) {
    let next: Node = cur.nextSibling!;
    if (next) {
      while (next.firstChild) next = next.firstChild;
      if (next.nodeType === Node.TEXT_NODE) return next as Text;
      if (next.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((next as Element).tagName)) return null;
      cur = next;
    } else {
      cur = cur.parentNode;
      if (!cur || (cur.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((cur as Element).tagName))) return null;
    }
  }
  return null;
};

/**
 * Trim leading/trailing punctuation from a Range.
 * Also handles the endOffset=0 edge case where the range boundary sits at
 * a text-node boundary but the word actually ends in the previous node.
 */
const trimRangePunctuation = (range: Range): { cleanedRange: Range; word: string } => {
  const cloned = range.cloneRange();

  // 1. Trim trailing non-word characters
  outer: while (!cloned.collapsed) {
    const endContainer = cloned.endContainer;
    const endOffset = cloned.endOffset;
    if (endContainer.nodeType === Node.TEXT_NODE) {
      if (endOffset > 0) {
        const text = endContainer.textContent || '';
        const char = text[endOffset - 1];
        if (char && !WORD_CHAR.test(char)) {
          cloned.setEnd(endContainer, endOffset - 1);
          continue;
        }
      }
      // endOffset === 0: range ends BEFORE this text node, nothing to trim here
    }
    break;
  }

  // 2. Trim leading non-word characters
  while (!cloned.collapsed) {
    const startContainer = cloned.startContainer;
    const startOffset = cloned.startOffset;
    if (startContainer.nodeType === Node.TEXT_NODE) {
      const text = startContainer.textContent || '';
      if (startOffset < text.length) {
        const char = text[startOffset];
        if (char && !WORD_CHAR.test(char)) {
          cloned.setStart(startContainer, startOffset + 1);
          continue;
        }
      }
    }
    break;
  }

  const word = cloned.toString().trim();
  return { cleanedRange: cloned, word };
};

/**
 * Given a click position (x, y) inside a document, find the full word at that point.
 * Unlike caretRangeFromPoint (which only returns a caret in ONE text node),
 * this function also expands across adjacent text nodes when a word is split
 * by inline elements (common in epub.js rendering).
 */
const findWordAtPoint = (doc: Document, x: number, y: number): { range: Range; word: string } | null => {
  const caretInfo = (doc as any).caretRangeFromPoint?.(x, y)
    ?? (doc as any).caretPositionFromPoint?.(x, y);
  if (!caretInfo) return null;

  let clickNode: Text | null = null;
  let clickOffset = 0;

  if (caretInfo.startContainer?.nodeType === Node.TEXT_NODE) {
    clickNode = caretInfo.startContainer as Text;
    clickOffset = caretInfo.startOffset;
  } else if (caretInfo.offsetNode?.nodeType === Node.TEXT_NODE) {
    clickNode = caretInfo.offsetNode as Text;
    clickOffset = caretInfo.offset;
  }
  if (!clickNode) return null;

  const text = clickNode.textContent || '';
  let offset = clickOffset;

  // Clamp and adjust to land on a word character
  if (offset >= text.length) offset = text.length - 1;
  if (offset > 0 && !WORD_CHAR.test(text[offset] ?? '')) {
    if (WORD_CHAR.test(text[offset - 1])) offset--;
  }
  if (!WORD_CHAR.test(text[offset] ?? '')) return null;

  // Expand left within the current text node
  let start = offset;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;

  // Expand right within the current text node
  let end = offset + 1;
  while (end < text.length && WORD_CHAR.test(text[end])) end++;

  // --- Cross-text-node expansion ---
  // If the word starts at offset 0, check if the previous text node continues the word
  let startNode: Text = clickNode;
  let startOffset = start;
  if (start === 0) {
    let prevNode = getPrevTextNode(clickNode);
    while (prevNode) {
      const prevText = prevNode.textContent || '';
      if (prevText.length > 0 && WORD_CHAR.test(prevText[prevText.length - 1])) {
        // Word extends into this previous node — find its start there
        let prevStart = prevText.length - 1;
        while (prevStart > 0 && WORD_CHAR.test(prevText[prevStart - 1])) prevStart--;
        startNode = prevNode;
        startOffset = prevStart;
        if (prevStart > 0) break; // might extend even further — but limit to one hop
        prevNode = getPrevTextNode(prevNode);
      } else {
        break;
      }
    }
  }

  // If the word ends at text.length, check if the next text node continues the word
  let endNode: Text = clickNode;
  let endOffset = end;
  if (end === text.length) {
    let nextNode = getNextTextNode(clickNode);
    while (nextNode) {
      const nextText = nextNode.textContent || '';
      if (nextText.length > 0 && WORD_CHAR.test(nextText[0])) {
        // Word extends into this next node — find its end there
        let nextEnd = 1;
        while (nextEnd < nextText.length && WORD_CHAR.test(nextText[nextEnd])) nextEnd++;
        endNode = nextNode;
        endOffset = nextEnd;
        if (nextEnd < nextText.length) break; // might extend even further — limit to one hop
        nextNode = getNextTextNode(nextNode);
      } else {
        break;
      }
    }
  }

  const range = doc.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);

  const w = range.toString().trim();
  return w ? { range, word: w } : null;
};


export const EpubViewer: React.FC<EpubViewerProps> = React.memo(({
  bookId,
  url,
  initialCfi,
  onProgressChange,
  onSelection,
  theme,
  onOutlineLoaded,
  readThroughActive = false,
  rtSettings,
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
        let inputData: any = url;
        if (typeof url === 'string') {
          const res = await fetch(url);
          if (!res.ok) throw new Error('Could not download EPUB binary content.');
          inputData = await res.arrayBuffer();
        }
        const book = Epub(inputData);
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
          flow: readThroughActive ? 'paginated' : 'scrolled-doc',
        });
        renditionRef.current = rendition;
        rendition.themes.fontSize(`${fontSize}%`);

        rendition.hooks.content.register((contents: any) => {
          const doc = contents.document;

          const activeFont = readThroughActive && rtSettings
            ? (rtSettings.fontFamily === 'sans-serif' ? "'Inter', sans-serif" :
              rtSettings.fontFamily === 'monospace' ? "'JetBrains Mono', monospace" :
              rtSettings.fontFamily === 'dyslexic' ? "'Atkinson Hyperlegible', sans-serif" :
              "'Lora', Georgia, serif")
            : "'Lora', Georgia, serif";

          const style = doc.createElement('style');
          style.id = 'epub-kindle-typography-override';
          style.innerHTML = `
            * {
              ${readThroughActive ? 'background-color: transparent !important;' : ''}
              font-family: ${activeFont} !important;
              text-align: left !important;
              word-spacing: 0px !important;
              letter-spacing: 0px !important;
              text-justify: none !important;
            }
            body, p, div, span, blockquote, li, pre, code {
              font-family: ${activeFont} !important;
              text-align: left !important;
              word-break: normal !important;
              overflow-wrap: break-word !important;
              word-spacing: 0px !important;
              letter-spacing: 0px !important;
              text-justify: none !important;
              white-space: normal !important;
            }
            p {
              margin-bottom: 1.2em !important;
              text-align: left !important;
            }
            img {
              mix-blend-mode: multiply;
              opacity: 0.85;
              max-width: 100% !important;
              height: auto !important;
            }
          `;
          doc.head.appendChild(style);

          // Stop propagation inside the iframe to block external extensions
          doc.addEventListener('mouseup', (e: MouseEvent) => {
            e.stopPropagation();
          }, true);
          doc.addEventListener('dblclick', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            // ✅ Read selection SYNCHRONOUSLY — no setTimeout.
            // By the time 'dblclick' fires the browser has already applied native word selection.
            // A 20ms timeout created a race condition: the 'readthrough-click-outside' mousedown
            // handler could clear the selection before the timeout ran, causing the fallback
            // (caretRangeFromPoint) to be used instead — returning only a partial text node.
            const win = doc.defaultView || contents.window;
            let targetRange: Range | null = null;
            let word = '';

            // Path 1: Use browser's native word selection (most reliable)
            const sel = win?.getSelection();
            if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
              const nativeRange = sel.getRangeAt(0);
              const trimmed = trimRangePunctuation(nativeRange);
              if (trimmed.word) {
                targetRange = trimmed.cleanedRange;
                word = trimmed.word;
              }
            }

            // Path 2: Fallback — manually locate word at click position.
            // findWordAtPoint expands across adjacent text nodes so epub.js-split
            // words (e.g. "operat" + "e" in separate spans) are found completely.
            if (!targetRange || !word) {
              const result = findWordAtPoint(doc, e.clientX, e.clientY);
              if (result) {
                targetRange = result.range;
                word = result.word;
              }
            }

            if (targetRange && word) {
              if (sel) {
                sel.removeAllRanges();
                sel.addRange(targetRange);
              }
              try {
                const rect = targetRange.getBoundingClientRect();
                const iframe = containerRef.current?.querySelector('iframe');
                if (iframe) {
                  const iframeRect = iframe.getBoundingClientRect();
                  const x = rect.left + rect.width / 2 + iframeRect.left;
                  const y = rect.bottom + iframeRect.top;
                  onSelection(word, x, y);
                } else {
                  onSelection(word);
                }
              } catch (err) {
                onSelection(word);
              }
            }
          }, true);
          doc.addEventListener('mousedown', () => {
            if (readThroughActive) {
              window.parent.dispatchEvent(new CustomEvent('readthrough-click-outside'));
            }
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
              } else if (e.key === 'Escape') {
                try {
                  doc.defaultView?.getSelection()?.removeAllRanges();
                  doc.getSelection()?.removeAllRanges();
                } catch (err) {}
                window.parent.dispatchEvent(new CustomEvent('readthrough-escape-key'));
              }
            }
          });
        });

        await rendition.display(initialCfi || undefined);
        if (!active) return;

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
          const raw = sel?.toString() || '';
          // Strip leading/trailing punctuation so double-clicking "word," returns "word"
          const text = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
          if (text && text.length > 0) {
            try {
              const range = sel.getRangeAt(0);
              const rect = range.getBoundingClientRect();
              const iframe = containerRef.current?.querySelector('iframe');
              if (iframe) {
                const iframeRect = iframe.getBoundingClientRect();
                const x = rect.left + rect.width / 2 + iframeRect.left;
                const y = rect.bottom + iframeRect.top;
                onSelection(text, x, y);
              } else {
                onSelection(text);
              }
            } catch (err) {
              onSelection(text);
            }
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
  }, [url, readThroughActive]);

  // Update styles dynamically when settings or theme changes
  useEffect(() => {
    if (!renditionRef.current) return;

    // Calculate values
    const activeFontSize = readThroughActive && rtSettings ? (80 + (rtSettings.fontSizeLevel - 1) * 15) : fontSize;
    const activePadding = readThroughActive && rtSettings
      ? (rtSettings.margin === 'narrow' ? '48px 12px' : rtSettings.margin === 'normal' ? '48px 24px' : '48px 36px')
      : '48px 24px';
    const activeLineHeight = readThroughActive && rtSettings ? rtSettings.lineHeight : '1.85';
    const activeFontFamily = readThroughActive && rtSettings
      ? (rtSettings.fontFamily === 'serif' ? "'Lora', Georgia, serif" :
        rtSettings.fontFamily === 'sans-serif' ? "'Inter', sans-serif" :
          rtSettings.fontFamily === 'monospace' ? "'JetBrains Mono', monospace" :
            rtSettings.fontFamily === 'dyslexic' ? "'Atkinson Hyperlegible', sans-serif" :
              "'Lora', Georgia, serif")
      : "'Lora', 'Playfair Display', Georgia, serif";

    const activeBgColor = readThroughActive ? 'transparent !important' : '';

    renditionRef.current.themes.register('light', {
      body: {
        'font-family': `${activeFontFamily} !important`,
        'line-height': `${activeLineHeight} !important`,
        'font-size': `${activeFontSize}% !important`,
        'color': '#2b2b2d !important',
        'background-color': activeBgColor || '#ffffff !important',
        'padding': `${activePadding} !important`,
      },
      p: {
        'margin-bottom': '1.3em !important',
        'text-align': 'left !important',
      }
    });

    renditionRef.current.themes.register('dark', {
      body: {
        'font-family': `${activeFontFamily} !important`,
        'line-height': `${activeLineHeight} !important`,
        'font-size': `${activeFontSize}% !important`,
        'color': '#e0deda !important',
        'background-color': activeBgColor || '#2a2926 !important',
        'padding': `${activePadding} !important`,
      },
      p: {
        'margin-bottom': '1.3em !important',
        'text-align': 'left !important',
      }
    });

    renditionRef.current.themes.register('sepia', {
      body: {
        'font-family': `${activeFontFamily} !important`,
        'line-height': `${activeLineHeight} !important`,
        'font-size': `${activeFontSize}% !important`,
        'color': '#3b2c1b !important',
        'background-color': activeBgColor || '#faf6eb !important',
        'padding': `${activePadding} !important`,
      },
      p: {
        'margin-bottom': '1.3em !important',
        'text-align': 'left !important',
      }
    });

    renditionRef.current.themes.register('oled', {
      body: {
        'font-family': `${activeFontFamily} !important`,
        'line-height': `${activeLineHeight} !important`,
        'font-size': `${activeFontSize}% !important`,
        'color': '#e5e5e5 !important',
        'background-color': activeBgColor || '#000000 !important',
        'padding': `${activePadding} !important`,
      },
      p: {
        'margin-bottom': '1.3em !important',
        'text-align': 'left !important',
      }
    });

    renditionRef.current.themes.register('mint', {
      body: {
        'font-family': `${activeFontFamily} !important`,
        'line-height': `${activeLineHeight} !important`,
        'font-size': `${activeFontSize}% !important`,
        'color': '#1b4332 !important',
        'background-color': activeBgColor || '#e8f5e9 !important',
        'padding': `${activePadding} !important`,
      },
      p: {
        'margin-bottom': '1.3em !important',
        'text-align': 'left !important',
      }
    });

    renditionRef.current.themes.register('eink', {
      body: {
        'font-family': `${activeFontFamily} !important`,
        'line-height': `${activeLineHeight} !important`,
        'font-size': `${activeFontSize}% !important`,
        'color': '#000000 !important',
        'background-color': activeBgColor || '#ffffff !important',
        'padding': `${activePadding} !important`,
      },
      p: {
        'margin-bottom': '1.3em !important',
        'text-align': 'left !important',
      }
    });

    renditionRef.current.themes.select(theme);
  }, [theme, readThroughActive, rtSettings, fontSize]);

  // Handle page turn events from BookReader
  useEffect(() => {
    const handleNext = () => {
      renditionRef.current?.next();
    };
    const handlePrev = () => {
      renditionRef.current?.prev();
    };
    const handleClearSelection = () => {
      window.getSelection()?.removeAllRanges();
      try {
        const iframe = containerRef.current?.querySelector('iframe');
        iframe?.contentWindow?.getSelection()?.removeAllRanges();
        iframe?.contentDocument?.getSelection()?.removeAllRanges();
      } catch (e) {}
    };

    window.addEventListener('readthrough-next-page', handleNext);
    window.addEventListener('readthrough-prev-page', handlePrev);
    window.addEventListener('readthrough-clear-selection', handleClearSelection);
    return () => {
      window.removeEventListener('readthrough-next-page', handleNext);
      window.removeEventListener('readthrough-prev-page', handlePrev);
      window.removeEventListener('readthrough-clear-selection', handleClearSelection);
    };
  }, []);

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
});
