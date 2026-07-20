import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, AlertTriangle, Maximize2 } from 'lucide-react';
import 'pdfjs-dist/web/pdf_viewer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface PdfViewerProps {
  bookId: string;
  url: string;
  initialPage: number;
  onPageChange: (page: number, total: number) => void;
  onSelection: (text: string, x?: number, y?: number) => void;
  onOutlineLoaded?: (outline: any[]) => void;
  readThroughActive?: boolean;
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
 * Extract the word surrounding `charIndex` inside `str`,
 * and return { word, wordStart, wordEnd } so the caller can
 * compute the word's bounding box within the text item.
 */

// ─────────────────────────────────────────────────────────────────────────────


export const PdfViewer: React.FC<PdfViewerProps> = React.memo(({
  bookId,
  url,
  initialPage,
  onPageChange,
  onSelection,
  onOutlineLoaded,
  readThroughActive = false,
}) => {
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState<number>(initialPage || 1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.4);
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
    const availableWidth = wrapperRef.current.clientWidth - 48;
    return Math.max(0.5, Math.min(3.0, availableWidth / baseViewport.width));
  }, []);

  // ── Load document ──────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const doc = await pdfjs.getDocument(url).promise;
        if (!active) return;
        setPdf(doc);
        setTotalPages(doc.numPages);
        const start = initialPage > 0 && initialPage <= doc.numPages ? initialPage : 1;
        setPageNumber(start);
        onPageChange(start, doc.numPages);

        // Restore zoom level from localStorage if it exists
        const savedZoom = localStorage.getItem(`readthrough_zoom_pdf_${bookId}`);
        if (savedZoom) {
          const parsed = parseFloat(savedZoom);
          if (!isNaN(parsed) && parsed >= 0.5 && parsed <= 3.0) {
            setScale(parsed);
            return;
          }
        }

        requestAnimationFrame(async () => {
          if (!active) return;
          const fitScale = await computeFitScale(doc);
          setScale(fitScale);
          localStorage.setItem(`readthrough_zoom_pdf_${bookId}`, fitScale.toString());
        });
      } catch {
        if (active) setError('Failed to open this PDF file. Please check the file.');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [url, bookId]);

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
            let targetPage: number | null = null;
            if (item.dest) {
              targetPage = await resolveDest(item.dest);
            }

            const mappedItem: any = {
              title: item.title,
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
            setHash: () => {},
            executeNamedAction: () => {},
            onFileAttachmentAnnotation: () => {},
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

  // ── Page navigation ────────────────────────────────────────────
  const changePage = useCallback((offset: number) => {
    const next = pageNumber + offset;
    if (next >= 1 && next <= totalPages) {
      setPageNumber(next);
      onPageChange(next, totalPages);
    }
  }, [pageNumber, totalPages, onPageChange]);

  // ── Zoom ───────────────────────────────────────────────────────
  const zoom = useCallback((factor: number) =>
    setScale(prev => {
      const next = Math.max(0.5, Math.min(3.0, +(prev + factor).toFixed(2)));
      localStorage.setItem(`readthrough_zoom_pdf_${bookId}`, next.toString());
      return next;
    }), [bookId]);

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

    // Use setTimeout of 50ms to ensure the browser's native selection is completed and finalized
    setTimeout(() => {
      const textLayer = textLayerRef.current;
      const container = containerRef.current;
      if (!textLayer || !container) return;

      // ── Step 1: Find the exact text node + character offset at the click point ──
      // caretRangeFromPoint gives us the exact character position under the cursor,
      // bypassing browser's double-click selection which may include punctuation.
      const caretRange = (document as any).caretRangeFromPoint?.(clickX, clickY)
        ?? (document as any).caretPositionFromPoint?.(clickX, clickY);
      if (!caretRange) return;

      let clickNode: Text | null = null;
      let clickOffset = 0;

      if (caretRange.startContainer?.nodeType === Node.TEXT_NODE) {
        // Standard Range from caretRangeFromPoint
        clickNode = caretRange.startContainer as Text;
        clickOffset = caretRange.startOffset;
      } else if (caretRange.offsetNode?.nodeType === Node.TEXT_NODE) {
        // CaretPosition from caretPositionFromPoint (Firefox)
        clickNode = caretRange.offsetNode as Text;
        clickOffset = caretRange.offset;
      }

      if (!clickNode || !textLayer.contains(clickNode)) return;

      // ── Step 2: Gather all text nodes in the text layer (in reading order) ──
      const wordCharRegex = /^[\p{L}\p{N}_']$/u;
      const walk = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT, null);
      const allNodes: Text[] = [];
      let n: Node | null;
      while ((n = walk.nextNode())) {
        if ((n as Text).textContent?.trim()) allNodes.push(n as Text);
      }

      const nodeIdx = allNodes.indexOf(clickNode);
      if (nodeIdx === -1) return;

      // ── Step 3: Expand word start (backward, potentially across sibling spans) ──
      let wordStartNode: Text = clickNode;
      let wordStartOffset: number = clickOffset;

      // Walk backward in current node
      while (wordStartOffset > 0 && wordCharRegex.test(clickNode.textContent![wordStartOffset - 1])) {
        wordStartOffset--;
      }
      // If we reached the beginning of the node, try previous nodes
      if (wordStartOffset === 0) {
        for (let i = nodeIdx - 1; i >= 0; i--) {
          const prevNode = allNodes[i];
          const prevText = prevNode.textContent || '';
          let off = prevText.length;
          while (off > 0 && wordCharRegex.test(prevText[off - 1])) off--;
          if (off < prevText.length) {
            wordStartNode = prevNode;
            wordStartOffset = off;
            if (off > 0) break; // stopped inside node
            // off === 0: entire node is word chars, keep looking back
          } else {
            break; // no word chars at end of prev node
          }
        }
      }

      // ── Step 4: Expand word end (forward, potentially across sibling spans) ──
      let wordEndNode: Text = clickNode;
      let wordEndOffset: number = clickOffset;

      // Walk forward in current node
      const clickText = clickNode.textContent || '';
      while (wordEndOffset < clickText.length && wordCharRegex.test(clickText[wordEndOffset])) {
        wordEndOffset++;
      }
      // If we reached the end of the node, try next nodes
      if (wordEndOffset === clickText.length) {
        for (let i = nodeIdx + 1; i < allNodes.length; i++) {
          const nextNode = allNodes[i];
          const nextText = nextNode.textContent || '';
          let off = 0;
          while (off < nextText.length && wordCharRegex.test(nextText[off])) off++;
          if (off > 0) {
            wordEndNode = nextNode;
            wordEndOffset = off;
            if (off < nextText.length) break; // stopped inside node
            // off === nextText.length: entire node is word chars, keep looking forward
          } else {
            break; // no word chars at start of next node
          }
        }
      }

      // ── Step 5: Build the clean word range ──
      const wordRange = document.createRange();
      wordRange.setStart(wordStartNode, wordStartOffset);
      wordRange.setEnd(wordEndNode, wordEndOffset);

      const word = wordRange.toString().trim();
      if (!word) return;

      console.log('[ReadThrough PDF] Word from dblclick:', word);

      // Update visual selection to match the exact word
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(wordRange);
      }

      // ── Step 6: Compute highlight box from the clean word range rects ──
      const rects = wordRange.getClientRects();
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
    }, 50);
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

  const fitWidth = useCallback(async () => {
    if (!pdf) return;
    const fitScale = await computeFitScale(pdf);
    setScale(fitScale);
    localStorage.setItem(`readthrough_zoom_pdf_${bookId}`, fitScale.toString());
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
