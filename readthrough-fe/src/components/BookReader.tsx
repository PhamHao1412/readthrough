import React, { useCallback, useState, useEffect, useRef } from 'react';
import { ArrowLeft, BookOpen, AlertTriangle, Sparkles, X, List, ChevronRight, Settings, ChevronLeft, Zap, Palette } from 'lucide-react';
import { PdfViewer } from './PdfViewer';
import { EpubViewer } from './EpubViewer';
import { TxtViewer } from './TxtViewer';
import { MdViewer } from './MdViewer';
import { TranslationTooltip } from './TranslationTooltip';
import { TranslationBottomSheet } from './TranslationBottomSheet';
import { AIReadingCompanionPanel } from './AIReadingCompanionPanel';
import {
  extractPdfSectionText,
  extractPdfChapterOverviewText,
  findSectionPageRange,
  extractMarkdownSectionText,
  isChapterOrMajorContainer,
} from '../utils/sectionExtractor';

import { ThemeId } from '../utils/themes';

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
  toc?: string;
  /** Async upload state: "uploading" | "ready" | "failed" */
  upload_status?: string;
  /** Upload progress 0-100, valid while upload_status === "uploading" */
  upload_progress?: number;
}

interface BookReaderProps {
  book: Book;
  onBack: () => void;
  theme: ThemeId;
  onThemeChange: () => void;
}

export const BookReader: React.FC<BookReaderProps> = ({ book, onBack, theme, onThemeChange }) => {
  const { fetchWithAuth } = useAuth();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  // For PDF: we pass the direct URL to PdfViewer so PDF.js can do Range requests.
  // For other types: we use blobUrl (full download into memory).
  const [directPdfUrl, setDirectPdfUrl] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState<boolean>(true);
  const [contentError, setContentError] = useState<string>('');

  // Read Through (Kindle Mode) States
  const [readThroughActive, setReadThroughActive] = useState<boolean>(() => {
    return localStorage.getItem('readthrough_rt_active') === 'true';
  });
  const [rtFontFamily, setRtFontFamily] = useState<string>(() => {
    return localStorage.getItem('readthrough_rt_font_family') || 'serif';
  });
  const [rtFontSizeLevel, setRtFontSizeLevel] = useState<number>(() => {
    const saved = localStorage.getItem('readthrough_rt_font_size_level');
    return saved ? parseInt(saved, 10) : 4;
  });
  const [rtMargin, setRtMargin] = useState<'narrow' | 'normal' | 'wide'>(() => {
    return (localStorage.getItem('readthrough_rt_margin') as any) || 'normal';
  });
  const [rtLineHeight, setRtLineHeight] = useState<string>(() => {
    return localStorage.getItem('readthrough_rt_line_height') || '1.6';
  });
  const [showRtSettings, setShowRtSettings] = useState<boolean>(false);
  const [showRtToc, setShowRtToc] = useState<boolean>(false);
  const [hudVisible, setHudVisible] = useState<boolean>(true);
  const [activeSelection, setActiveSelection] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    localStorage.setItem('readthrough_rt_active', readThroughActive.toString());
    if (readThroughActive) {
      document.body.classList.add('rt-mode-active');
    } else {
      document.body.classList.remove('rt-mode-active');
      setShowRtSettings(false);
      setShowRtToc(false);
      setActiveSelection(null);
    }
  }, [readThroughActive]);

  useEffect(() => {
    localStorage.setItem('readthrough_rt_font_family', rtFontFamily);
  }, [rtFontFamily]);

  useEffect(() => {
    localStorage.setItem('readthrough_rt_font_size_level', rtFontSizeLevel.toString());
  }, [rtFontSizeLevel]);

  useEffect(() => {
    localStorage.setItem('readthrough_rt_margin', rtMargin);
  }, [rtMargin]);

  useEffect(() => {
    localStorage.setItem('readthrough_rt_line_height', rtLineHeight);
  }, [rtLineHeight]);

  const hudTimeoutRef = useRef<any>(null);

  useEffect(() => {
    if (!readThroughActive) return;

    const resetHudTimeout = () => {
      setHudVisible(true);
      if (hudTimeoutRef.current) window.clearTimeout(hudTimeoutRef.current);

      if (!showRtSettings && !showRtToc) {
        hudTimeoutRef.current = window.setTimeout(() => {
          setHudVisible(false);
        }, 3000);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (e.clientY < 80 || e.clientY > window.innerHeight - 80) {
        resetHudTimeout();
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    resetHudTimeout();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (hudTimeoutRef.current) window.clearTimeout(hudTimeoutRef.current);
    };
  }, [readThroughActive, showRtSettings, showRtToc]);

  // Click outside or Escape key to close floating popups & clear text selection (works in both normal & Kindle modes)
  useEffect(() => {
    const clearSelection = () => {
      // Clear browser text selection in main window
      window.getSelection()?.removeAllRanges();
      // Clear selection inside any iframe (e.g. EPUB / PDF)
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach((iframe) => {
        try {
          iframe.contentWindow?.getSelection()?.removeAllRanges();
          iframe.contentDocument?.getSelection()?.removeAllRanges();
        } catch (e) {}
      });
      // Broadcast clear custom highlight event for PDF/EPUB components
      window.dispatchEvent(new CustomEvent('readthrough-clear-selection'));
    };

    const handleOutsideEvent = () => {
      if (showRtSettings) setShowRtSettings(false);
      if (showRtToc) setShowRtToc(false);
      if (activeSelection) {
        setActiveSelection(null);
      }
      clearSelection();
    };

    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target) return;

      // Close settings panel if clicked outside settings panel and settings button
      if (showRtSettings && !target.closest('.rt-settings-panel') && !target.closest('button[title="Text settings"]')) {
        setShowRtSettings(false);
      }

      // Close TOC dropdown if clicked outside TOC panel and TOC button
      if (showRtToc && !target.closest('.rt-toc-dropdown') && !target.closest('button[title="Table of Contents"]')) {
        setShowRtToc(false);
      }

      // Close active selection tooltip if clicked outside selection tooltip
      if (activeSelection && !target.closest('.translation-tooltip')) {
        setActiveSelection(null);
        clearSelection();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleOutsideEvent();
      }
    };

    window.addEventListener('mousedown', handleGlobalClick);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('readthrough-click-outside', handleOutsideEvent);
    window.addEventListener('readthrough-escape-key', handleOutsideEvent);

    return () => {
      window.removeEventListener('mousedown', handleGlobalClick);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('readthrough-click-outside', handleOutsideEvent);
      window.removeEventListener('readthrough-escape-key', handleOutsideEvent);
    };
  }, [showRtSettings, showRtToc, activeSelection]);

  // Table of Contents and Navigation states
  const [outline, setOutline] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(book.current_page || 1);
  const [currentCfi, setCurrentCfi] = useState<string>(book.epub_cfi || '');
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  // AI Reading Companion states
  const [companionSectionTitle, setCompanionSectionTitle] = useState<string>('');
  const [companionPageNumber, setCompanionPageNumber] = useState<number>(1);
  const [companionContent, setCompanionContent] = useState<string>('');
  const [companionTab, setCompanionTab] = useState<'summary' | 'explain' | 'quiz' | 'vocab'>('summary');
  const [companionIsChapter, setCompanionIsChapter] = useState<boolean>(false);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const extractionSeqRef = useRef<number>(0);

  // Reset outline and navigation states when switching books
  useEffect(() => {
    setOutline([]);
    setCurrentPage(book.current_page || 1);
    setCurrentCfi(book.epub_cfi || '');
    setExpandedItems({});
    setCompanionSectionTitle('');
    setCompanionContent('');
    setCompanionIsChapter(false);
  }, [book.id]);

  const handleOutlineLoaded = useCallback((loadedOutline: any[]) => {
    setOutline(loadedOutline);
  }, []);

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
  }, [book.id, fetchWithAuth]);

  const openCompanionForSection = useCallback(async (item?: any, initialTab: 'summary' | 'explain' | 'quiz' | 'vocab' = 'summary') => {
    const seq = ++extractionSeqRef.current;

    let targetTitle = item?.title || '';
    let targetPage = typeof item?.target === 'number' ? item.target : currentPage;
    const isChapter = isChapterOrMajorContainer(item, outline);



    if (!targetTitle) {
      targetTitle = `Page ${targetPage || currentPage}`;
    }

    setCompanionSectionTitle(targetTitle);
    setCompanionPageNumber(targetPage || currentPage);
    setCompanionTab(initialTab);
    setCompanionIsChapter(isChapter);
    setCompanionContent('');
    setSidebarOpen(true);
    setIsExtracting(true);

    let text = '';

    // 1. If PDF and pdfDoc is available
    if (book.file_type === 'pdf' && pdfDoc) {
      if (isChapter) {
        text = await extractPdfChapterOverviewText(pdfDoc, item, outline, book.total_pages || pdfDoc.numPages);
      } else {
        const range = findSectionPageRange(targetPage || currentPage, outline, book.total_pages || pdfDoc.numPages, targetTitle);
        text = await extractPdfSectionText(pdfDoc, range.startPage, range.endPage, targetTitle, range.nextSectionTitle);
      }
    }

    // 2. If Markdown
    if (!text && book.file_type === 'md') {
      try {
        const cache = await caches.open('readthrough-book-cache');
        const cached = await cache.match(`/books/${book.id}/content`);
        let mdText = '';
        if (cached) {
          mdText = await cached.text();
        } else {
          const res = await fetchWithAuth(`/api/v1/books/${book.id}/content`);
          if (res.ok) mdText = await res.text();
        }
        if (mdText) {
          text = extractMarkdownSectionText(mdText, targetTitle, typeof item?.target === 'string' ? item.target : undefined);
        }
      } catch (err) {
        console.warn('Failed to extract markdown text:', err);
      }
    }

    // 3. Fallback extraction (current page + small range)
    if (!text && pdfDoc) {
      text = await extractPdfSectionText(pdfDoc, targetPage || currentPage, Math.min((targetPage || currentPage) + 3, book.total_pages || 10), targetTitle);
    }

    if (extractionSeqRef.current === seq) {
      setCompanionContent(text);
      setIsExtracting(false);
    }
  }, [book, pdfDoc, outline, currentPage, fetchWithAuth]);


  const handleNavigateOutlineItem = useCallback((itemOrTarget: any) => {
    if (itemOrTarget === null || itemOrTarget === undefined) return;
    let target = itemOrTarget;
    if (typeof itemOrTarget === 'object') {
      target = itemOrTarget.target;
    }

    if (typeof target === 'number') {
      setCurrentPage(target);
      saveProgress(target, '', book.total_pages);
    } else if (typeof target === 'string') {
      setCurrentCfi(target);
      saveProgress(1, target);
    }
  }, [book.total_pages, saveProgress]);


  const handleSummarizeOutlineItem = useCallback(async (itemOrTarget: any) => {
    if (itemOrTarget === null || itemOrTarget === undefined) return;
    let target = itemOrTarget;
    let itemObj: any = null;
    if (typeof itemOrTarget === 'object') {
      itemObj = itemOrTarget;
      target = itemOrTarget.target;
    }

    if (typeof target === 'number') {
      setCurrentPage(target);
      saveProgress(target, '', book.total_pages);
    } else if (typeof target === 'string') {
      setCurrentCfi(target);
      saveProgress(1, target);
    }

    if (itemObj) {
      await openCompanionForSection(itemObj, 'summary');
    } else {
      await openCompanionForSection({
        title: `Page ${typeof target === 'number' ? target : currentPage}`,
        target: typeof target === 'number' ? target : currentPage,
      }, 'summary');
    }
  }, [book.total_pages, openCompanionForSection, saveProgress, currentPage]);


  const toggleExpand = useCallback((path: string) => {
    setExpandedItems(prev => ({
      ...prev,
      [path]: !prev[path]
    }));
  }, []);

  const renderOutlineItems = (items: any[], depth = 0, path = ''): React.ReactNode => {
    return items
      .filter(item => (item.title ?? '').trim() !== '')
      .map((item, idx) => {
        const itemPath = path ? `${path}-${idx}` : `${idx}`;
        const hasChildren = item.children && item.children.length > 0;
        const isExpanded = !!expandedItems[itemPath];

        return (
          <div key={itemPath} className="toc-node">
            <div
              className="toc-item-row"
              style={{ paddingLeft: `${depth * 16}px` }}
              data-toc-path={itemPath}
            >
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

              <button
                className="toc-item-content-btn"
                onClick={() => {
                  handleNavigateOutlineItem(item);
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

        // ── 1. Cache Hit: load instantly in 0ms from local cache ────────────
        if (cachedResponse) {
          const rawBlob = await cachedResponse.blob();
          if (active && rawBlob.size > 0) {
            const mimeType = book.file_type === 'epub'
              ? 'application/epub+zip'
              : book.file_type === 'pdf'
                ? 'application/pdf'
                : 'text/plain';
            const typedBlob = new Blob([rawBlob], { type: mimeType });
            localBlobUrl = URL.createObjectURL(typedBlob);

            if (book.file_type === 'pdf') {
              setDirectPdfUrl(localBlobUrl);
            } else {
              setBlobUrl(localBlobUrl);
            }
            setLoadingContent(false);
            console.log(`[Cache] Loaded "${book.title}" instantly from local cache`);
            return;
          }
        }

        // ── 2. PDF Cache Miss: Render instantly via Range Streaming ─────────
        // while fetching full file in background to populate cache for next reload.
        if (book.file_type === 'pdf') {
          // Get presigned URL first so large PDF also bypasses BE proxy
          let instantUrl = `/api/v1/books/${book.id}/content`; // fallback
          try {
            const urlRes = await fetchWithAuth(`/api/v1/books/${book.id}/download-url`);
            if (urlRes.ok) {
              const urlJson = await urlRes.json();
              if (urlJson.data?.url && urlJson.data?.is_presigned) {
                instantUrl = urlJson.data.url; // use R2 presigned URL directly
              }
            }
          } catch {
            // ignore — use fallback /content
          }

          if (active) {
            setDirectPdfUrl(instantUrl);
            setLoadingContent(false);
          }

          // Background task to cache large PDF for future instant reloads
          (async () => {
            try {
              const urlRes = await fetchWithAuth(`/api/v1/books/${book.id}/download-url`);
              if (!urlRes.ok) return;
              const urlJson = await urlRes.json();
              const downloadUrl = urlJson.data?.url;
              if (!downloadUrl) return;

              const fileRes = urlJson.data?.is_presigned
                ? await fetch(downloadUrl)
                : await fetchWithAuth(`/api/v1/books/${book.id}/content`);

              if (fileRes.ok) {
                await cache.put(cacheKey, fileRes);
                console.log(`[Cache] Background cached large PDF "${book.title}"`);
              }
            } catch (err) {
              console.warn('[Cache] Background caching failed:', err);
            }
          })();
          return;
        }


        // ── 3. Standard Cache Miss (<=50MB or EPUB/TXT/MD): fetch & cache ─────
        const urlRes = await fetchWithAuth(`/api/v1/books/${book.id}/download-url`);
        if (!urlRes.ok) throw new Error('Failed to retrieve download link.');
        const urlJson = await urlRes.json();

        if (!urlJson.succeeded || !urlJson.data?.url) {
          throw new Error('Invalid download response.');
        }

        const { url, is_presigned } = urlJson.data;
        isPresigned = !!is_presigned;

        let fileRes;
        if (isPresigned) {
          fileRes = await fetch(url);
        } else {
          fileRes = await fetchWithAuth(`/api/v1/books/${book.id}/content`);
        }

        if (!fileRes.ok) throw new Error('Failed to download book content file.');

        const fileResClone = fileRes.clone();
        const rawBlob = await fileRes.blob();

        try {
          await cache.put(cacheKey, fileResClone);
          console.log(`[Cache] Saved "${book.title}" to local cache`);
        } catch (cacheErr) {
          console.warn('[Cache] Failed to write to cache storage:', cacheErr);
        }

        if (!active) return;
        const mimeType = book.file_type === 'epub'
          ? 'application/epub+zip'
          : book.file_type === 'pdf'
            ? 'application/pdf'
            : 'text/plain';
        const typedBlob = new Blob([rawBlob], { type: mimeType });
        localBlobUrl = URL.createObjectURL(typedBlob);

        if (book.file_type === 'pdf') {
          setDirectPdfUrl(localBlobUrl);
        } else {
          setBlobUrl(localBlobUrl);
        }
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
  }, [book.id, book.file_type, fetchWithAuth]);

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('readthrough_sidebar_width');
    const maxWidth = typeof window !== 'undefined' ? Math.floor(window.innerWidth * 0.5) : 600;
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= 280) {
        return Math.min(parsed, maxWidth);
      }
    }
    return Math.min(380, maxWidth);
  });

  const [isResizing, setIsResizing] = useState(false);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    const maxWidth = Math.floor(window.innerWidth * 0.5); // Allow expanding up to half screen (50vw)
    const minWidth = 280;
    const newWidth = window.innerWidth - e.clientX;
    if (newWidth >= minWidth && newWidth <= maxWidth) {
      setSidebarWidth(newWidth);
    } else if (newWidth > maxWidth) {
      setSidebarWidth(maxWidth);
    } else if (newWidth < minWidth) {
      setSidebarWidth(minWidth);
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

  const [bookVocab, setBookVocab] = useState<any[]>([]);

  const fetchBookVocabularies = useCallback(async () => {
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
    }
  }, [book.id, fetchWithAuth]);


  useEffect(() => {
    fetchBookVocabularies();
  }, [fetchBookVocabularies]);

  const handleCloseTooltip = useCallback(() => {
    setActiveSelection(null);
    window.getSelection()?.removeAllRanges();
    window.dispatchEvent(new CustomEvent('readthrough-clear-selection'));
  }, []);


  const handlePdfPageChange = useCallback((page: number, total: number) => {
    saveProgress(page, '', total);
  }, [saveProgress]);

  const handleEpubProgressChange = useCallback((cfi: string) => {
    saveProgress(1, cfi);
  }, [saveProgress]);

  const handleTxtPageChange = useCallback((page: number, total: number) => {
    saveProgress(page, '', total);
  }, [saveProgress]);

  const handleMdProgressChange = useCallback((cfi: string) => {
    saveProgress(1, cfi);
  }, [saveProgress]);

  const getSentenceContext = (selectedText: string): string => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    const range = sel.getRangeAt(0);
    const container = range.startContainer;
    if (!container) return '';

    const currentLineElement = container.nodeType === Node.TEXT_NODE ? container.parentElement : (container as HTMLElement);
    if (!currentLineElement) return '';

    const textLayer = currentLineElement.parentElement;
    let fullText = currentLineElement.textContent || '';

    if (textLayer && textLayer.children.length > 1) {
      const siblings = Array.from(textLayer.children);
      const curIdx = siblings.indexOf(currentLineElement);

      if (curIdx !== -1) {
        const linesBefore: string[] = [];
        const linesAfter: string[] = [];

        for (let i = Math.max(0, curIdx - 2); i < curIdx; i++) {
          const text = siblings[i].textContent?.trim() || '';
          if (text) linesBefore.push(text);
        }

        for (let i = curIdx + 1; i < Math.min(siblings.length, curIdx + 3); i++) {
          const text = siblings[i].textContent?.trim() || '';
          if (text) linesAfter.push(text);
        }

        let currentTextClean = currentLineElement.textContent || '';
        let nextTextCombined = linesAfter.join(' ');

        if (currentTextClean.endsWith('-') || currentTextClean.endsWith('‐')) {
          currentTextClean = currentTextClean.slice(0, -1);
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

    if (fullText && fullText.includes(selectedText)) {
      const selIdx = fullText.indexOf(selectedText);
      let pStart = 0;
      for (let i = selIdx - 1; i >= 0; i--) {
        const char = fullText[i];
        if ((char === '.' || char === '!' || char === '?') && (i === fullText.length - 1 || /\s/.test(fullText[i + 1]))) {
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
      sentence = sentence.replace(/\s+/g, ' ');

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

  const handleSelection = useCallback(async (text: string, x?: number, y?: number) => {
    if (!text.trim()) return;
    const posX = x !== undefined ? x : window.innerWidth / 2;
    const posY = y !== undefined ? y : window.innerHeight / 2;
    setActiveSelection({ text: text.trim(), x: posX, y: posY });
  }, []);

  // PDF gets the direct URL so PDF.js can Range-fetch page by page.
  // All other types use the full blob URL.
  const contentUrl = book.file_type === 'pdf'
    ? (directPdfUrl || '')
    : (blobUrl || '');



  return (
    <div className={`reader-shell ${readThroughActive ? 'rt-active' : ''}`}>
      {/* Top Toolbar */}
      <header className="reader-toolbar">
        <div className="reader-toolbar-left">
          <button className="toolbar-back-btn" onClick={onBack} title="Back to library">
            <ArrowLeft size={16} />
            <span>Library</span>
          </button>
          <div className="toolbar-divider" />
          <button
            className={`toolbar-toc-btn ${sidebarOpen ? 'active' : ''}`}
            onClick={() => setSidebarOpen(o => !o)}
            title="Table of Contents & AI Reading Companion"
          >
            <List size={16} />
            <span>Contents & AI</span>
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
            className={`theme-btn rt-mode-toggle-btn ${readThroughActive ? 'active' : ''}`}
            onClick={() => setReadThroughActive(!readThroughActive)}
            title={readThroughActive ? "Tắt chế độ ReadThrough (Kindle Mode)" : "Bật chế độ ReadThrough (Kindle Mode)"}
          >
            <Zap size={15} fill={readThroughActive ? "currentColor" : "none"} />
          </button>
          <button
            className="theme-btn"
            onClick={onThemeChange}
            title="Theme Presets"
          >
            <Palette size={15} />
          </button>
          <button
            className={`sidebar-toggle-btn ${sidebarOpen ? 'active' : ''}`}
            onClick={() => setSidebarOpen(o => !o)}
            title="AI Reading Companion & Table of Contents"
          >
            <Sparkles size={16} />
          </button>

        </div>
      </header>


      {/* Body: PDF Content + Right AI Companion Panel */}
      <div className={`reader-body ${isResizing ? 'is-resizing' : ''}`}>
        {/* Document Area */}
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
                  onPdfLoaded={setPdfDoc}
                  readThroughActive={readThroughActive}
                  rtSettings={{
                    fontFamily: rtFontFamily,
                    fontSizeLevel: rtFontSizeLevel,
                    margin: rtMargin,
                    lineHeight: rtLineHeight
                  }}
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
                  readThroughActive={readThroughActive}
                  rtSettings={{
                    fontFamily: rtFontFamily,
                    fontSizeLevel: rtFontSizeLevel,
                    margin: rtMargin,
                    lineHeight: rtLineHeight
                  }}
                />
              )}
              {book.file_type === 'md' && (
                <MdViewer
                  bookId={book.id}
                  url={contentUrl}
                  initialCfi={currentCfi}
                  onProgressChange={handleMdProgressChange}
                  onSelection={handleSelection}
                  onOutlineLoaded={handleOutlineLoaded}
                  theme={theme}
                  readThroughActive={readThroughActive}
                  rtSettings={{
                    fontFamily: rtFontFamily,
                    fontSizeLevel: rtFontSizeLevel,
                    margin: rtMargin,
                    lineHeight: rtLineHeight
                  }}
                />
              )}
              {book.file_type === 'txt' && (
                <TxtViewer
                  bookId={book.id}
                  url={contentUrl}
                  initialPage={currentPage}
                  onPageChange={handleTxtPageChange}
                  onSelection={handleSelection}
                  readThroughActive={readThroughActive}
                  rtSettings={{
                    fontFamily: rtFontFamily,
                    fontSizeLevel: rtFontSizeLevel,
                    margin: rtMargin,
                    lineHeight: rtLineHeight
                  }}
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

        {/* Right Sidebar: Unified Table of Contents & AI Reading Companion */}
        <aside
          className={`reader-sidebar ${sidebarOpen ? 'open' : 'closed'} ${isResizing ? 'no-transition' : ''}`}
          style={{ width: sidebarOpen ? `${sidebarWidth}px` : '0px' }}
        >
          <AIReadingCompanionPanel
            bookId={book.id}
            bookTitle={book.title}
            bookAuthor={book.author}
            sectionTitle={companionSectionTitle}
            pageNumber={companionPageNumber}
            sectionContent={companionContent}
            activeTab={companionTab}
            onTabChange={setCompanionTab}
            onClose={() => setSidebarOpen(false)}
            bookVocab={bookVocab}
            onVocabularySaved={fetchBookVocabularies}
            outline={outline}
            currentPage={currentPage}
            totalPages={book.total_pages}
            onNavigateOutlineItem={handleNavigateOutlineItem}
            onSummarizeOutlineItem={handleSummarizeOutlineItem}
            isExtracting={isExtracting}
            isChapter={companionIsChapter}
          />

        </aside>
      </div>


      {readThroughActive && (
        <div className={`rt-hud ${hudVisible ? 'visible' : 'hidden'}`}>
          <div className="rt-header">
            <button className="rt-btn rt-back-btn" onClick={() => setReadThroughActive(false)} title="Exit Kindle Mode">
              <ArrowLeft size={18} />
            </button>
            <div className="rt-book-title">{book.title}</div>
            <div className="rt-actions">
              <button className={`rt-btn ${showRtToc ? 'active' : ''}`} onClick={() => { setShowRtToc(!showRtToc); setShowRtSettings(false); }} title="Table of Contents">
                <List size={18} />
              </button>
              <button
                className="rt-btn rt-toggle-active-btn active"
                onClick={() => setReadThroughActive(false)}
                title="Tắt chế độ ReadThrough (Trở về chế độ thường)"
              >
                <Zap size={18} fill="currentColor" />
              </button>
              <button className={`rt-btn ${showRtSettings ? 'active' : ''}`} onClick={() => { setShowRtSettings(!showRtSettings); setShowRtToc(false); }} title="Text settings">
                <Settings size={18} />
              </button>
              <button className="rt-btn" onClick={onThemeChange} title="Theme Presets">
                <Palette size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kindle Mode Floating TOC Dropdown */}
      {readThroughActive && showRtToc && (
        <div className="rt-toc-dropdown">
          <div className="rt-toc-header">
            <h3>Table of Contents</h3>
            <button onClick={() => setShowRtToc(false)}><X size={16} /></button>
          </div>
          <div className="rt-toc-body">
            {outline.length === 0 ? (
              <p className="rt-toc-empty">No table of contents available.</p>
            ) : (
              <div className="toc-list">
                {renderOutlineItems(outline)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Kindle Mode Settings Panel */}
      {readThroughActive && showRtSettings && (
        <div className="rt-settings-panel">
          <div className="rt-settings-section">
            <label>Theme Preset</label>
            <div className="rt-settings-options font-options">
              <button
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                onClick={() => {
                  setShowRtSettings(false);
                  onThemeChange();
                }}
              >
                <Palette size={14} />
                <span>Select Theme Preset...</span>
              </button>
            </div>
          </div>

          <div className="rt-settings-section">
            <label>Font Family</label>
            <div className="rt-settings-options font-options">
              <button className={rtFontFamily === 'serif' ? 'active' : ''} onClick={() => setRtFontFamily('serif')}>Georgia</button>
              <button className={rtFontFamily === 'sans-serif' ? 'active' : ''} onClick={() => setRtFontFamily('sans-serif')}>Sans</button>
              <button className={rtFontFamily === 'monospace' ? 'active' : ''} onClick={() => setRtFontFamily('monospace')}>Mono</button>
              <button className={rtFontFamily === 'dyslexic' ? 'active' : ''} onClick={() => setRtFontFamily('dyslexic')}>Dyslexic</button>
            </div>
          </div>

          <div className="rt-settings-section">
            <label>Font Size</label>
            <div className="rt-settings-options font-size-options">
              <button onClick={() => setRtFontSizeLevel(p => Math.max(1, p - 1))} disabled={rtFontSizeLevel <= 1}>A-</button>
              <span className="rt-settings-value">Level {rtFontSizeLevel}</span>
              <button onClick={() => setRtFontSizeLevel(p => Math.min(8, p + 1))} disabled={rtFontSizeLevel >= 8}>A+</button>
            </div>
          </div>

          <div className="rt-settings-section">
            <label>Margins</label>
            <div className="rt-settings-options margin-options">
              <button className={rtMargin === 'narrow' ? 'active' : ''} onClick={() => setRtMargin('narrow')}>Narrow</button>
              <button className={rtMargin === 'normal' ? 'active' : ''} onClick={() => setRtMargin('normal')}>Normal</button>
              <button className={rtMargin === 'wide' ? 'active' : ''} onClick={() => setRtMargin('wide')}>Wide</button>
            </div>
          </div>

          <div className="rt-settings-section">
            <label>Line Spacing</label>
            <div className="rt-settings-options line-height-options">
              <button className={rtLineHeight === '1.4' ? 'active' : ''} onClick={() => setRtLineHeight('1.4')}>1.4</button>
              <button className={rtLineHeight === '1.6' ? 'active' : ''} onClick={() => setRtLineHeight('1.6')}>1.6</button>
              <button className={rtLineHeight === '1.8' ? 'active' : ''} onClick={() => setRtLineHeight('1.8')}>1.8</button>
              <button className={rtLineHeight === '2.0' ? 'active' : ''} onClick={() => setRtLineHeight('2.0')}>2.0</button>
            </div>
          </div>
        </div>
      )}

      {/* Kindle Mode Floating Footer (Progress) */}
      {readThroughActive && (
        <div className={`rt-footer ${hudVisible ? 'visible' : 'hidden'}`}>
          <div className="rt-progress-bar-container">
            <div
              className="rt-progress-bar"
              style={{
                width: `${book.total_pages && currentPage ? (currentPage / book.total_pages) * 100 : 0}%`
              }}
            />
          </div>
          <div className="rt-footer-meta">
            <span>{currentPage && book.total_pages ? `Page ${currentPage} of ${book.total_pages}` : book.file_type === 'epub' || book.file_type === 'md' ? 'Current Position' : ''}</span>
            <span>{Math.round(book.total_pages && currentPage ? (currentPage / book.total_pages) * 100 : 0)}% read</span>
          </div>
        </div>
      )}

      {/* Page Turning Hover Buttons */}
      {readThroughActive && (
        <>
          <button
            className="rt-nav-zone left"
            onClick={() => window.dispatchEvent(new CustomEvent('readthrough-prev-page'))}
            title="Previous page (Left arrow)"
          >
            <ChevronLeft size={36} />
          </button>
          <button
            className="rt-nav-zone right"
            onClick={() => window.dispatchEvent(new CustomEvent('readthrough-next-page'))}
            title="Next page (Right arrow)"
          >
            <ChevronRight size={36} />
          </button>
        </>
      )}

      {/* Selection Tooltip / Mobile Bottom Sheet for ANY highlighted text */}
      {activeSelection && (
        window.innerWidth <= 768 ? (
          <TranslationBottomSheet
            text={activeSelection.text}
            onClose={handleCloseTooltip}
            contextSentence={getSentenceContext(activeSelection.text)}
            bookId={book.id}
            bookTitle={book.title}
            bookAuthor={book.author}
            pageNumber={currentPage}
            bookVocab={bookVocab}
            onVocabularySaved={fetchBookVocabularies}
          />
        ) : (
          <TranslationTooltip
            text={activeSelection.text}
            x={activeSelection.x}
            y={activeSelection.y}
            onClose={handleCloseTooltip}
            contextSentence={getSentenceContext(activeSelection.text)}
            bookId={book.id}
            bookTitle={book.title}
            bookAuthor={book.author}
            pageNumber={currentPage}
            bookVocab={bookVocab}
            onVocabularySaved={fetchBookVocabularies}
          />
        )
      )}
    </div>
  );
};

