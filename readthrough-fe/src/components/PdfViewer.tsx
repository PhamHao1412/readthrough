import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjs from 'pdfjs-dist';
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, AlertTriangle, Maximize2 } from 'lucide-react';
import 'pdfjs-dist/web/pdf_viewer.css';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;


interface PdfViewerProps {
  bookId: string;
  url: string;
  initialPage: number;
  onPageChange: (page: number, total: number) => void;
  onSelection: (text: string, x?: number, y?: number) => void;
  onOutlineLoaded?: (outline: any[]) => void;
  onPdfLoaded?: (pdfDoc: any) => void;
  readThroughActive?: boolean;
  rtSettings?: {
    fontFamily: string;
    fontSizeLevel: number;
    margin: string;
    lineHeight: string;
  };
}

/**
 * Stored text item (in PDF coordinate space, unscaled).
 *
 * `transform` is the standard PDF CTM: [a, b, c, d, tx, ty]
 *   - tx, ty : bottom-left origin in PDF user units
 *   - a, d   : horizontal / vertical scale (also encodes font size)
 *
 * `width` is in PDF user units (device space in pdfjs terminology).
 */
interface StoredTextItem {
  str: string;
  transform: number[];   // [a, b, c, d, tx, ty]  — PDF units
  width: number;         // PDF units (NOT scaled)
}

/**
 * A highlight box in CSS-pixel coordinates relative to the page container.
 * null = no highlight active.
 */
interface HighlightBox {
  left: number;
  top: number;
  width: number;
  height: number;
  key: number; // changes on each new highlight, forces CSS animation restart
}

/**
 * Trim leading and trailing punctuation/non-word characters from a DOM Range.
 */
const trimRangePunctuation = (range: Range): { cleanedRange: Range; word: string } => {
  const wordCharRegex = /^[\p{L}\p{N}_']$/u;
  const cloned = range.cloneRange();

  // 1. Trim trailing non-word characters
  while (!cloned.collapsed) {
    const endContainer = cloned.endContainer;
    const endOffset = cloned.endOffset;
    if (endContainer.nodeType === Node.TEXT_NODE && endOffset > 0) {
      const text = endContainer.textContent || '';
      const char = text[endOffset - 1];
      if (char && !wordCharRegex.test(char)) {
        cloned.setEnd(endContainer, endOffset - 1);
        continue;
      }
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
        if (char && !wordCharRegex.test(char)) {
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

// ─────────────────────────────────────────────────────────────────────────────


export const PdfViewer: React.FC<PdfViewerProps> = React.memo(({
  bookId,
  url,
  initialPage,
  onPageChange,
  onSelection,
  onOutlineLoaded,
  onPdfLoaded,
  readThroughActive = false,
  rtSettings,
}) => {
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState<number>(initialPage || 1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [fitScale, setFitScale] = useState<number>(1.4);
  const [zoomOffset, setZoomOffset] = useState<number>(() => {
    const saved = localStorage.getItem(`readthrough_zoom_offset_pdf_${bookId}`);
    return saved ? parseFloat(saved) : 0;
  });
  const scale = Math.max(0.5, Math.min(3.0, +(fitScale + zoomOffset).toFixed(2)));

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  // Word highlight overlay state
  const [highlight, setHighlight] = useState<HighlightBox | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const annotationLayerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<any>(null);

  // Text items and viewport stored after each page render
  const textItemsRef = useRef<StoredTextItem[]>([]);
  const viewportRef = useRef<pdfjs.PageViewport | null>(null);

  // Dedup guard
  const lastWordRef = useRef<string>('');

  // ── Resolve Destination to Page Number ────────────────────────
  const resolveDest = useCallback(async (dest: any) => {
    if (!pdf) return null;
    let explicitDest = dest;
    if (typeof dest === 'string') {
      explicitDest = await pdf.getDestination(dest);
    }
    if (!explicitDest || !Array.isArray(explicitDest)) return null;
    const pageRef = explicitDest[0];
    if (pageRef && typeof pageRef === 'object') {
      try {
        const pageIdx = await pdf.getPageIndex(pageRef);
        return pageIdx + 1;
      } catch (err) {
        console.error('Error parsing page from link:', err);
      }
    }
    return null;
  }, [pdf]);

  // ── Compute fit-to-width scale ─────────────────────────────────
  const computeFitScale = useCallback(async (doc: pdfjs.PDFDocumentProxy): Promise<number> => {
    if (!wrapperRef.current) return 1.4;
    const page = await doc.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const isMobile = window.innerWidth <= 768;
    const padding = isMobile ? 0 : 32;
    const availableWidth = wrapperRef.current.clientWidth - padding;
    // On mobile screens, scale up by 1.25x so text is large, readable, and fills screen width
    const mobileBoost = isMobile ? 1.25 : 1.0;
    let baseScale = (availableWidth / baseViewport.width) * mobileBoost;
    if (rtSettings?.fontSizeLevel) {
      baseScale = baseScale * (1 + (rtSettings.fontSizeLevel - 4) * 0.18);
    }
    return Math.max(0.4, Math.min(4.0, baseScale));
  }, [rtSettings?.fontSizeLevel]);

  // Auto fit-to-width on window or wrapper resize
  useEffect(() => {
    if (!pdf || !wrapperRef.current) return;
    let timeoutId: any = null;
    const observer = new ResizeObserver(() => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        if (window.innerWidth <= 768 || readThroughActive) {
          const fitScaleVal = await computeFitScale(pdf);
          setFitScale(fitScaleVal);
        }
      }, 100);
    });
    observer.observe(wrapperRef.current);
    return () => {
      observer.disconnect();
      clearTimeout(timeoutId);
    };
  }, [pdf, computeFitScale, readThroughActive]);

  // ── Load document ──────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!url) return;
      setLoading(true);
      setError('');
      try {
        // Range-based loading: only fetch bytes needed for the current page.
        // - disableAutoFetch: prevents PDF.js from pre-downloading the whole file
        // - disableStream: TRUE → forces range transport (sends Range: bytes=X-Y)
        // - rangeChunkSize: 512KB per chunk → 8× fewer requests than 64KB default
        const token = localStorage.getItem('readthrough_access_token');
        const isBlobUrl = url.startsWith('blob:');
        const isBackendApi = url.startsWith('/api/') || url.includes('/api/v1/');

        // CRITICAL FIX:
        // Pass Authorization header ONLY to internal backend API (/api/v1/...).
        // NEVER pass Authorization header to Cloudflare R2 / AWS S3 presigned URLs!
        // Sending Bearer JWT to S3/R2 presigned URLs triggers "InvalidArgument: Only one auth mechanism allowed"
        // or CORS preflight rejection, causing newly uploaded PDFs to fail on first open.
        const httpHeaders: Record<string, string> = {};
        if (token && isBackendApi && !isBlobUrl) {
          httpHeaders['Authorization'] = `Bearer ${token}`;
        }

        let doc: pdfjs.PDFDocumentProxy;

        try {
          doc = await pdfjs.getDocument({
            url,
            cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
            cMapPacked: true,
            rangeChunkSize: 524288, // 512KB per range chunk for HTTP streaming
            disableAutoFetch: !isBlobUrl,
            disableStream: !isBlobUrl,
            httpHeaders,
            withCredentials: false,
          }).promise;
        } catch (primaryErr: any) {
          console.warn('[PdfViewer] Primary URL load failed, trying resilient fallback...', primaryErr);

          // Fallback 1: If primary URL was a direct presigned R2/S3 URL, try proxying via backend /content
          if (!isBackendApi && !isBlobUrl && bookId) {
            const fallbackHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
            try {
              doc = await pdfjs.getDocument({
                url: `/api/v1/books/${bookId}/content`,
                cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
                cMapPacked: true,
                rangeChunkSize: 524288,
                disableAutoFetch: true,
                disableStream: true,
                httpHeaders: fallbackHeaders,
                withCredentials: false,
              }).promise;
            } catch (fallbackErr: any) {
              console.warn('[PdfViewer] Fallback 1 failed, downloading full blob...', fallbackErr);
              // Fallback 2: Direct full blob fetch via backend proxy
              const res = await fetch(`/api/v1/books/${bookId}/content`, {
                headers: fallbackHeaders,
              });
              if (!res.ok) throw new Error(`HTTP error ${res.status}: Failed to download PDF`);
              const arrayBuf = await res.arrayBuffer();
              doc = await pdfjs.getDocument({
                data: new Uint8Array(arrayBuf),
                cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
                cMapPacked: true,
              }).promise;
            }
          } else {
            throw primaryErr;
          }
        }

        if (!active) return;
        setPdf(doc);
        if (onPdfLoaded) {
          onPdfLoaded(doc);
        }
        setTotalPages(doc.numPages);
        const start = initialPage > 0 && initialPage <= doc.numPages ? initialPage : 1;
        setPageNumber(start);
        onPageChange(start, doc.numPages);

        // Calculate fit scale immediately for mobile viewports
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
          const fitScaleVal = await computeFitScale(doc);
          setFitScale(fitScaleVal);
        } else {
          requestAnimationFrame(async () => {
            if (!active) return;
            const fitScaleVal = await computeFitScale(doc);
            setFitScale(fitScaleVal);
          });
        }
      } catch (err: any) {
        console.error('[PdfViewer] Error loading PDF:', err);
        if (active) setError('Failed to open this PDF file. Please check the file.');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };

  }, [url, bookId, computeFitScale]);

  // Sync initialPage prop changes
  useEffect(() => {
    if (initialPage && initialPage !== pageNumber) {
      setPageNumber(initialPage);
    }
  }, [initialPage]);

  // Load PDF Outline (TOC)
  useEffect(() => {
    if (!pdf || !onOutlineLoaded) return;

    const fetchOutline = async () => {
      try {
        const rawOutline = await pdf.getOutline();
        if (!rawOutline) return;

        const mapOutlineItems = async (items: any[]): Promise<any[]> => {
          const mapped = [];
          for (const item of items) {
            // Skip entries with no meaningful title — these are structural PDF
            // bookmarks with blank labels that only clutter the TOC.
            const title = (item.title ?? '').trim();
            if (!title) continue;

            let targetPage: number | null = null;
            if (item.dest) {
              targetPage = await resolveDest(item.dest);
            }

            const mappedItem: any = {
              title,
              target: targetPage,
            };

            if (item.items && item.items.length > 0) {
              mappedItem.children = await mapOutlineItems(item.items);
            }
            mapped.push(mappedItem);
          }
          return mapped;
        };

        const mappedOutline = await mapOutlineItems(rawOutline);
        onOutlineLoaded(mappedOutline);
      } catch (err) {
        console.error('Failed to extract PDF table of contents:', err);
      }
    };

    fetchOutline();
  }, [pdf, onOutlineLoaded, resolveDest]);

  // Clear highlight when turning pages or zooming
  useEffect(() => {
    setHighlight(null);
  }, [pageNumber, scale]);

  // Reset scroll position to top when page changes
  useEffect(() => {
    if (wrapperRef.current) {
      wrapperRef.current.scrollTop = 0;
      wrapperRef.current.scrollLeft = 0;
    }
  }, [pageNumber]);

  // ── Render page ────────────────────────────────────────────────
  const renderPage = useCallback(async (num: number, sc: number) => {
    if (!pdf || !canvasRef.current || !textLayerRef.current) return;
    if (renderTaskRef.current) renderTaskRef.current.cancel();

    textItemsRef.current = [];
    viewportRef.current = null;

    try {
      const page = await pdf.getPage(num);
      const viewport = page.getViewport({ scale: sc });
      viewportRef.current = viewport;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      if (containerRef.current) {
        containerRef.current.style.width = `${viewport.width}px`;
        containerRef.current.style.height = `${viewport.height}px`;
      }

      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
        transform: [dpr, 0, 0, dpr, 0, 0],
      });
      renderTaskRef.current = renderTask;
      await renderTask.promise;

      const textContent = await page.getTextContent();

      textItemsRef.current = (textContent.items as any[])
        .filter((item) => typeof item.str === 'string' && item.str.trim().length > 0)
        .map((item) => ({
          str: item.str as string,
          transform: item.transform as number[],
          width: item.width as number,
        }));

      const textLayerDiv = textLayerRef.current;
      textLayerDiv.innerHTML = '';
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;
      textLayerDiv.style.setProperty('--scale-factor', sc.toString());

      pdfjs.renderTextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport,
        textDivs: [],
      });

      // Render annotation layer (links, notes)
      const annotationLayerDiv = annotationLayerRef.current;
      if (annotationLayerDiv) {
        annotationLayerDiv.innerHTML = '';
        annotationLayerDiv.style.width = `${viewport.width}px`;
        annotationLayerDiv.style.height = `${viewport.height}px`;

        const annotations = await page.getAnnotations();
        if (annotations && annotations.length > 0) {
          const linkService = {
            navigateTo: async (dest: any) => {
              const pageNum = await resolveDest(dest);
              if (pageNum && pageNum >= 1 && pageNum <= pdf.numPages) {
                setPageNumber(pageNum);
                onPageChange(pageNum, pdf.numPages);
              }
            },
            getDestinationHash: () => '#',
            getAnchorUrl: () => '#',
            setHash: () => { },
            executeNamedAction: () => { },
            onFileAttachmentAnnotation: () => { },
          };

          const annotationLayer = new pdfjs.AnnotationLayer({
            div: annotationLayerDiv,
            accessibilityManager: null,
            annotationCanvasMap: null,
            l10n: null,
            page: page,
            viewport: viewport,
          });

          await annotationLayer.render({
            viewport: viewport.clone({ dontFlip: true }),
            div: annotationLayerDiv,
            annotations: annotations,
            page: page,
            linkService: linkService as any,
            downloadManager: null as any,
            renderForms: false,
          });
        }
      }
    } catch (e: any) {
      if (e.name !== 'RenderingCancelledException') console.error(e);
    }
  }, [pdf, resolveDest, onPageChange]);

  useEffect(() => {
    if (pdf) renderPage(pageNumber, scale);
  }, [pdf, pageNumber, scale, renderPage]);

  // ── Preload pages in background (15 pages forward, 5 pages backward) ──
  useEffect(() => {
    if (!pdf || pageNumber <= 0) return;

    const PRELOAD_FORWARD = 15;
    const PRELOAD_BACKWARD = 5;
    const maxPages = totalPages || pdf.numPages;

    const startPage = Math.max(1, pageNumber - PRELOAD_BACKWARD);
    const endPage = Math.min(maxPages, pageNumber + PRELOAD_FORWARD);

    let isCancelled = false;

    const preloadPages = async () => {
      // 1. Preload forward pages first (most likely direction)
      for (let i = pageNumber + 1; i <= endPage; i++) {
        if (isCancelled) break;
        try {
          const page = await pdf.getPage(i);
          if (!isCancelled && page) {
            await page.getTextContent().catch(() => {});
          }
        } catch {}
      }

      // 2. Preload backward pages
      for (let i = pageNumber - 1; i >= startPage; i--) {
        if (isCancelled) break;
        try {
          const page = await pdf.getPage(i);
          if (!isCancelled && page) {
            await page.getTextContent().catch(() => {});
          }
        } catch {}
      }
    };

    // Delay background preloading slightly (150ms) so current page render takes priority
    const timer = setTimeout(() => {
      preloadPages();
    }, 150);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [pdf, pageNumber, totalPages]);

  // ── Page navigation ────────────────────────────────────────────
  const changePage = useCallback((offset: number) => {
    const next = pageNumber + offset;
    if (next >= 1 && next <= totalPages) {
      setPageNumber(next);
      onPageChange(next, totalPages);
    }
  }, [pageNumber, totalPages, onPageChange]);

  // ── Zoom ───────────────────────────────────────────────────────
  const zoom = useCallback((factor: number) => {
    setZoomOffset(prev => {
      const next = +(prev + factor).toFixed(2);
      localStorage.setItem(`readthrough_zoom_offset_pdf_${bookId}`, next.toString());
      return next;
    });
  }, [bookId]);

  // Arrow key navigation + Command +/- Zoom
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
          zoom(0.15);
        } else if (e.key === '-') {
          e.preventDefault();
          zoom(-0.15);
        }
      } else if (e.key === 'Escape') {
        setHighlight(null);
        lastWordRef.current = '';
        window.getSelection()?.removeAllRanges();
        window.dispatchEvent(new CustomEvent('readthrough-escape-key'));
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
  }, [changePage, zoom]);

  // Clear highlight box when clear selection event is received
  useEffect(() => {
    const handleClearSelection = () => {
      setHighlight(null);
      lastWordRef.current = '';
      window.getSelection()?.removeAllRanges();
    };

    window.addEventListener('readthrough-clear-selection', handleClearSelection);
    return () => {
      window.removeEventListener('readthrough-clear-selection', handleClearSelection);
    };
  }, []);

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

  // ── Show highlight ─────────────────────────────────────────────
  const showHighlight = useCallback((box: Omit<HighlightBox, 'key'>) => {
    setHighlight({ ...box, key: Date.now() });
  }, []);

  const fireWord = useCallback((word: string, x?: number, y?: number) => {
    const w = word.trim();
    if (!w) return;
    if (w === lastWordRef.current) return;

    lastWordRef.current = w;
    onSelection(w, x, y);
    window.getSelection()?.removeAllRanges();
  }, [onSelection]);

  // ── DOUBLE-CLICK → Range-based word detection + highlight ──
  const handleDblClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // Stop event from reaching browser extensions

    const clickX = e.clientX;
    const clickY = e.clientY;

    // Small delay to let browser's native dblclick selection complete and finalize
    setTimeout(() => {
      const textLayer = textLayerRef.current;
      const container = containerRef.current;
      if (!textLayer || !container) return;

      let targetRange: Range | null = null;
      let word = '';

      // ── Strategy 1: Browser Native Selection (handles kerning, visual layout & word boundaries perfectly) ──
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const nativeRange = sel.getRangeAt(0);
        if (textLayer.contains(nativeRange.startContainer)) {
          const trimmed = trimRangePunctuation(nativeRange);
          if (trimmed.word) {
            targetRange = trimmed.cleanedRange;
            word = trimmed.word;
          }
        }
      }

      // ── Strategy 2: Fallback caretRangeFromPoint within clickNode only ──
      if (!targetRange || !word) {
        const caretRange = (document as any).caretRangeFromPoint?.(clickX, clickY)
          ?? (document as any).caretPositionFromPoint?.(clickX, clickY);

        if (caretRange) {
          let clickNode: Text | null = null;
          let clickOffset = 0;

          if (caretRange.startContainer?.nodeType === Node.TEXT_NODE) {
            clickNode = caretRange.startContainer as Text;
            clickOffset = caretRange.startOffset;
          } else if (caretRange.offsetNode?.nodeType === Node.TEXT_NODE) {
            clickNode = caretRange.offsetNode as Text;
            clickOffset = caretRange.offset;
          }

          if (clickNode && textLayer.contains(clickNode)) {
            const clickText = clickNode.textContent || '';
            const wordCharRegex = /^[\p{L}\p{N}_']$/u;

            let offset = clickOffset;
            if (offset > 0 && (offset >= clickText.length || !wordCharRegex.test(clickText[offset]))) {
              if (wordCharRegex.test(clickText[offset - 1])) {
                offset = offset - 1;
              }
            }

            let start = offset;
            while (start > 0 && wordCharRegex.test(clickText[start - 1])) start--;

            let end = offset;
            while (end < clickText.length && wordCharRegex.test(clickText[end])) end++;

            const fallbackRange = document.createRange();
            fallbackRange.setStart(clickNode, start);
            fallbackRange.setEnd(clickNode, end);

            const w = fallbackRange.toString().trim();
            if (w) {
              targetRange = fallbackRange;
              word = w;
            }
          }
        }
      }

      if (!targetRange || !word) return;

      console.log('[ReadThrough PDF] Word from dblclick:', word);

      // Update visual selection to match targetRange
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(targetRange);
      }

      // ── Compute highlight box from targetRange rects ──
      const rects = targetRange.getClientRects();
      if (rects.length === 0) return;

      const containerRect = container.getBoundingClientRect();
      let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.left < minLeft) minLeft = r.left;
        if (r.top < minTop) minTop = r.top;
        if (r.right > maxRight) maxRight = r.right;
        if (r.bottom > maxBottom) maxBottom = r.bottom;
      }

      const box = {
        left: minLeft - containerRect.left,
        top: minTop - containerRect.top,
        width: maxRight - minLeft,
        height: maxBottom - minTop,
      };

      showHighlight(box);
      fireWord(word, minLeft + (maxRight - minLeft) / 2, maxBottom);
    }, 20);
  }, [fireWord, showHighlight]);


  // ── MOUSEUP: handle drag / range selections ────────────────────
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // Stop event from reaching browser extensions

    if (e.detail >= 2) return;

    requestAnimationFrame(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = sel.toString().trim();
      if (!text || text === lastWordRef.current) return;

      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        lastWordRef.current = text;
        onSelection(text, rect.left + rect.width / 2, rect.bottom);
      } catch (err) {
        lastWordRef.current = text;
        onSelection(text);
      }
    });
  }, [onSelection]);

  // Clear selection and highlight when clicking inside PDF wrapper (outside selection)
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const isInsidePdf = wrapperRef.current?.contains(e.target as Node);
      if (!isInsidePdf) return;

      requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          setHighlight(null);
          lastWordRef.current = '';
        }
      });
    };

    window.addEventListener('mousedown', handleGlobalClick);
    return () => {
      window.removeEventListener('mousedown', handleGlobalClick);
    };
  }, []);

  // ── Bottom Controls Actions ────────────────────────────────────
  const fitWidth = useCallback(async () => {
    if (!pdf) return;
    const fitScaleVal = await computeFitScale(pdf);
    setFitScale(fitScaleVal);
    setZoomOffset(0);
    localStorage.setItem(`readthrough_zoom_offset_pdf_${bookId}`, '0');
  }, [pdf, computeFitScale, bookId]);

  // ── Render ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="loading-state">
        <div className="spinner" />
        <span>Loading PDF document...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-state">
        <AlertTriangle size={48} />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="pdf-viewer">
      {/* Controls */}
      {!readThroughActive && (
        <div className="pdf-controls">
          <div className="pdf-controls-group">
            <button className="ctrl-btn" onClick={() => changePage(-1)} disabled={pageNumber <= 1}>
              <ChevronLeft size={20} />
            </button>
            <span className="ctrl-label">Page {pageNumber} / {totalPages}</span>
            <button className="ctrl-btn" onClick={() => changePage(1)} disabled={pageNumber >= totalPages}>
              <ChevronRight size={20} />
            </button>
          </div>

          <div className="pdf-controls-group">
            <button className="ctrl-btn" onClick={() => zoom(-0.15)} disabled={scale <= 0.5} title="Zoom out">
              <ZoomOut size={18} />
            </button>
            <span className="ctrl-label">{Math.round(scale * 100)}%</span>
            <button className="ctrl-btn" onClick={() => zoom(0.15)} disabled={scale >= 3.0} title="Zoom in">
              <ZoomIn size={18} />
            </button>
            <div className="ctrl-sep" />
            <button className="ctrl-btn" onClick={fitWidth} title="Fit width">
              <Maximize2 size={16} />
            </button>
          </div>
        </div>
      )}

      {/* PDF canvas + text layer + highlight overlay */}
      <div className="pdf-canvas-wrapper" ref={wrapperRef}>
        <div ref={containerRef} className="pdf-page-container">
          <canvas ref={canvasRef} />

          {/* Word highlight overlay — sits between canvas and text layer */}
          {highlight && (
            <div
              key={highlight.key}
              className="word-highlight"
              style={{
                left: highlight.left,
                top: highlight.top,
                width: highlight.width,
                height: highlight.height,
              }}
            />
          )}

          <div
            ref={textLayerRef}
            className="textLayer"
            onDoubleClick={handleDblClick}
            onMouseUp={handleMouseUp}
          />

          <div
            ref={annotationLayerRef}
            className="annotationLayer"
          />
        </div>
      </div>
    </div>
  );
});
