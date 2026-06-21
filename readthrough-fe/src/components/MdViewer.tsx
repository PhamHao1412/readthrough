import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Type, Save, Copy, Check, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface MdViewerProps {
  bookId: string;
  url: string;
  initialCfi: string;
  onProgressChange: (cfi: string) => void;
  onSelection: (text: string) => void;
  onOutlineLoaded?: (outline: any[]) => void;
  theme: 'light' | 'dark' | 'sepia';
}

export interface MarkdownBlock {
  id: string;
  type: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'paragraph' | 'code' | 'blockquote' | 'list' | 'table' | 'hr';
  content?: string;
  level?: number;
  lang?: string;
  items?: { text: string; ordered: boolean; indent: number }[];
  headers?: string[];
  rows?: string[][];
  aligns?: ('left' | 'center' | 'right')[];
  startLine?: number;
  endLine?: number;
}

// Parse Markdown function
export const parseMarkdownText = (text: string): { parsedBlocks: MarkdownBlock[]; outline: any[] } => {
  const lines = text.split(/\r?\n/);
  const parsedBlocks: MarkdownBlock[] = [];
  const rawOutline: { title: string; target: string; level: number }[] = [];
  let blockIdCounter = 0;
  let headingCounter = 0;

  const nextId = () => `md-node-${++blockIdCounter}`;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Code Block
    if (trimmed.startsWith('```')) {
      const startLine = i;
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      const endLine = i < lines.length ? i : lines.length - 1;
      parsedBlocks.push({
        id: nextId(),
        type: 'code',
        content: codeLines.join('\n'),
        lang: lang || 'code',
        startLine,
        endLine
      });
      i++;
      continue;
    }

    // 2. Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const startLine = i;
      const level = headingMatch[1].length;
      const content = headingMatch[2].trim();
      headingCounter++;
      const headingId = `md-h-${headingCounter}`;

      parsedBlocks.push({
        id: headingId,
        type: `h${level}` as any,
        level,
        content,
        startLine,
        endLine: i
      });

      // Collect TOC outline items (up to level 6)
      if (level <= 6) {
        rawOutline.push({
          title: content,
          target: headingId,
          level
        });
      }
      i++;
      continue;
    }

    // 3. Horizontal Rule
    if (/^(?:-{3,}|\*{3,}|\_{3,})$/.test(trimmed)) {
      parsedBlocks.push({
        id: nextId(),
        type: 'hr',
        startLine: i,
        endLine: i
      });
      i++;
      continue;
    }

    // 4. Blockquote
    if (trimmed.startsWith('>')) {
      const startLine = i;
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      parsedBlocks.push({
        id: nextId(),
        type: 'blockquote',
        content: quoteLines.join('\n'),
        startLine,
        endLine: i - 1
      });
      continue;
    }

    // 5. Table
    if (trimmed.startsWith('|')) {
      const startLine = i;
      const headers = trimmed.split('|').map(s => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      
      let separatorLine = (i + 1 < lines.length) ? lines[i + 1].trim() : '';
      if (separatorLine.startsWith('|') && /^[|:\-\s]+$/.test(separatorLine)) {
        const aligns = separatorLine.split('|')
          .map(s => s.trim())
          .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
          .map(s => {
            const left = s.startsWith(':');
            const right = s.endsWith(':');
            if (left && right) return 'center';
            if (right) return 'right';
            return 'left';
          });

        const rows: string[][] = [];
        i += 2; // skip header and divider
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          const rowCells = lines[i].split('|')
            .map(s => s.trim())
            .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
          rows.push(rowCells);
          i++;
        }

        parsedBlocks.push({
          id: nextId(),
          type: 'table',
          headers,
          rows,
          aligns,
          startLine,
          endLine: i - 1
        });
        continue;
      }
    }

    // 6. Lists
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const startLine = i;
      const items: any[] = [];
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (!itemMatch) {
          // Handle empty line inside list
          if (lines[i].trim() === '') {
            let nextIndex = i + 1;
            while (nextIndex < lines.length && lines[nextIndex].trim() === '') {
              nextIndex++;
            }
            if (nextIndex < lines.length && lines[nextIndex].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/)) {
              i = nextIndex;
              continue;
            }
          }
          break;
        }

        const indent = itemMatch[1].length;
        const bullet = itemMatch[2];
        const isOrdered = /^\d/.test(bullet);
        const text = itemMatch[3].trim();

        items.push({
          text,
          ordered: isOrdered,
          indent
        });
        i++;
      }

      parsedBlocks.push({
        id: nextId(),
        type: 'list',
        items,
        startLine,
        endLine: i - 1
      });
      continue;
    }

    // 7. Empty line
    if (trimmed === '') {
      i++;
      continue;
    }

    // 8. Paragraph
    const startLine = i;
    const paraLines: string[] = [];
    while (i < lines.length) {
      const nextLine = lines[i];
      const nextTrimmed = nextLine.trim();
      
      if (nextTrimmed === '' || 
          nextLine.match(/^(#{1,6})\s+(.*)$/) ||
          nextTrimmed.startsWith('```') ||
          nextTrimmed.startsWith('>') ||
          nextTrimmed.startsWith('|') ||
          nextLine.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/) ||
          /^(?:-{3,}|\*{3,}|\_{3,})$/.test(nextTrimmed)) {
        break;
      }

      paraLines.push(nextLine.trim());
      i++;
    }

    if (paraLines.length > 0) {
      parsedBlocks.push({
        id: nextId(),
        type: 'paragraph',
        content: paraLines.join(' '),
        startLine,
        endLine: i - 1
      });
    }
  }

  // Build outline tree hierarchy from flat headings
  const outline: any[] = [];
  const stack: { level: number; item: any }[] = [];

  for (const h of rawOutline) {
    const item = {
      title: h.title,
      target: h.target,
      children: []
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
      stack.pop();
    }

    if (stack.length === 0) {
      outline.push(item);
    } else {
      stack[stack.length - 1].item.children.push(item);
    }

    stack.push({ level: h.level, item });
  }

  return { parsedBlocks, outline };
};

interface Checkpoint {
  id: string;
  editorScroll: number;
  previewScroll: number;
}

// Simulates browser word-wrapping for monospace text inside a textarea
const countWrappedLines = (text: string, maxChars: number): number => {
  const cleanText = text.replace(/\t/g, '    ');
  if (cleanText.length === 0) return 1;
  if (maxChars <= 0) return 1;

  const words = cleanText.split(/(\s+)/);
  let visualLines = 1;
  let currentLineLength = 0;

  for (const word of words) {
    const len = word.length;
    if (currentLineLength + len <= maxChars) {
      currentLineLength += len;
    } else {
      if (len > maxChars) {
        if (currentLineLength > 0) {
          visualLines++;
          currentLineLength = 0;
        }
        visualLines += Math.floor(len / maxChars);
        currentLineLength = len % maxChars;
      } else {
        visualLines++;
        currentLineLength = len;
      }
    }
  }
  return visualLines;
};


let katexPromise: Promise<any> | null = null;

const loadKatex = (): Promise<any> => {
  if (katexPromise) return katexPromise;

  katexPromise = new Promise((resolve, reject) => {
    // Load CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css';
    document.head.appendChild(link);

    // Load JS
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js';
    script.async = true;
    script.onload = () => {
      resolve((window as any).katex);
    };
    script.onerror = (err) => {
      reject(err);
    };
    document.head.appendChild(script);
  });

  return katexPromise;
};

const MathRenderer: React.FC<{ math: string; displayMode: boolean }> = ({ math, displayMode }) => {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let active = true;
    loadKatex()
      .then((katex) => {
        if (!active || !containerRef.current) return;
        try {
          katex.render(math, containerRef.current, {
            displayMode,
            throwOnError: false
          });
        } catch (e: any) {
          setError(e.message || 'KaTeX error');
        }
      })
      .catch((err) => {
        if (active) setError('Failed to load KaTeX');
      });
    return () => {
      active = false;
    };
  }, [math, displayMode]);

  if (error) {
    return <code className="math-error">{math}</code>;
  }

  return <span ref={containerRef}>{displayMode ? '$$' + math + '$$' : '$' + math + '$'}</span>;
};

export const MdViewer: React.FC<MdViewerProps> = React.memo(({
  bookId,
  url,
  initialCfi,
  onProgressChange,
  onSelection,
  onOutlineLoaded
}) => {
  const { fetchWithAuth } = useAuth();
  
  const [rawContent, setRawContent] = useState<string>('');
  const [blocks, setBlocks] = useState<MarkdownBlock[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  
  // View mode & content states
  const [viewMode, setViewMode] = useState<'editor' | 'split' | 'preview'>('preview');
  const [editContent, setEditContent] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  // Settings states
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem(`readthrough_font_size_md_${bookId}`);
    return saved ? Math.max(14, Math.min(32, parseInt(saved, 10))) : 18;
  });
  const [fontFamily, setFontFamily] = useState<'sans-serif' | 'serif'>(() => {
    const saved = localStorage.getItem(`readthrough_font_family_md_${bookId}`);
    return saved === 'serif' ? 'serif' : 'sans-serif';
  });

  const [copiedBlockId, setCopiedBlockId] = useState<string | null>(null);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lastActiveHeadingRef = useRef<string>('');
  const ignoreScrollEventRef = useRef<boolean>(false);
  const checkpointsRef = useRef<Checkpoint[] | null>(null);

  // Invalidate checkpoints cache when content or layout dependencies change
  useEffect(() => {
    checkpointsRef.current = null;
  }, [editContent, viewMode, fontSize, fontFamily]);

  // Invalidate checkpoints cache on window resize
  useEffect(() => {
    const handleResize = () => {
      checkpointsRef.current = null;
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);


  // Fetch document content
  useEffect(() => {
    let active = true;
    const fetchDoc = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load Markdown document.');
        const text = await res.text();
        if (!active) return;
        setRawContent(text);
        setEditContent(text);
      } catch (e: any) {
        if (active) setError(e.message || 'Failed to open file.');
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchDoc();
    return () => { active = false; };
  }, [url]);

  // Update parsed blocks and TOC outline in real-time when editContent changes
  useEffect(() => {
    const { parsedBlocks, outline } = parseMarkdownText(editContent);
    setBlocks(parsedBlocks);
    if (onOutlineLoaded) {
      onOutlineLoaded(outline);
    }
  }, [editContent, onOutlineLoaded]);

  // Save font size
  useEffect(() => {
    localStorage.setItem(`readthrough_font_size_md_${bookId}`, fontSize.toString());
  }, [fontSize, bookId]);

  // Save font family
  useEffect(() => {
    localStorage.setItem(`readthrough_font_family_md_${bookId}`, fontFamily);
  }, [fontFamily, bookId]);

  // Listen to initialCfi or currentCfi changes to scroll to headings
  useEffect(() => {
    if (initialCfi && !loading && viewMode !== 'editor') {
      if (initialCfi === lastActiveHeadingRef.current) return;
      
      // Small timeout to ensure DOM is fully rendered
      const timer = setTimeout(() => {
        const targetElement = document.getElementById(initialCfi);
        if (targetElement && scrollContainerRef.current) {
          ignoreScrollEventRef.current = true;
          
          const container = scrollContainerRef.current;
          const containerRect = container.getBoundingClientRect();
          const targetRect = targetElement.getBoundingClientRect();
          const targetOffsetTop = targetRect.top - containerRect.top + container.scrollTop;

          container.scrollTo({
            top: targetOffsetTop - 20,
            behavior: 'smooth'
          });
          
          lastActiveHeadingRef.current = initialCfi;

          // Release ignore lock after scroll completes
          setTimeout(() => {
            ignoreScrollEventRef.current = false;
          }, 800);
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [initialCfi, loading, viewMode]);

  // Scroll spy to detect active heading
  const handleScroll = useCallback(() => {
    if (ignoreScrollEventRef.current || viewMode === 'editor' || blocks.length === 0) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const headings = blocks.filter(b => b.type.startsWith('h') && b.type !== 'hr');
    if (headings.length === 0) return;

    let activeHeadingId = '';
    
    // Find the heading closest to the top of container viewport
    for (const h of headings) {
      const el = document.getElementById(h.id);
      if (el) {
        const elRect = el.getBoundingClientRect();
        const elRelativeTop = elRect.top - containerRect.top;
        
        // If heading is near the top or has just scrolled past
        if (elRelativeTop <= 100) {
          activeHeadingId = h.id;
        }
      }
    }

    if (activeHeadingId && activeHeadingId !== lastActiveHeadingRef.current) {
      lastActiveHeadingRef.current = activeHeadingId;
      onProgressChange(activeHeadingId);
    }
  }, [blocks, viewMode, onProgressChange]);

  // Selection handler
  const handleMouseUp = (e: React.MouseEvent) => {
    e.stopPropagation();
    const sel = window.getSelection();
    if (!sel) return;
    const text = sel.toString().trim();
    if (text.length > 0) {
      onSelection(text);
    }
  };

  const handleDblClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // Keyboard zoom control (similar to TxtViewer)
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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Copy code handler
  const handleCopyCode = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedBlockId(id);
    setTimeout(() => setCopiedBlockId(null), 2000);
  };

  // Save modifications handler
  const handleSaveChanges = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/v1/books/${bookId}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent })
      });

      if (!res.ok) throw new Error('Failed to save content on server.');
      
      // Update DB baseline
      setRawContent(editContent);

      try {
        const cache = await caches.open('readthrough-book-cache');
        const cacheKey = `/books/${bookId}/content`;
        const response = new Response(editContent, {
          headers: { 'Content-Type': 'text/markdown' }
        });
        await cache.put(cacheKey, response);
      } catch (cacheErr) {
        console.warn('Cache update error:', cacheErr);
      }
    } catch (err: any) {
      alert(err.message || 'An error occurred while saving.');
    } finally {
      setSaving(false);
    }
  };

  // Scroll synchronization handler (Editor to Preview)
  const handleEditorScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (viewMode !== 'split') return;
    const editor = e.currentTarget;
    const preview = scrollContainerRef.current;
    if (!editor || !preview || blocks.length === 0) return;

    // Calculate maximum scroll boundaries
    const maxEditorScroll = editor.scrollHeight - editor.clientHeight;
    const maxPreviewScroll = preview.scrollHeight - preview.clientHeight;
    if (maxEditorScroll <= 0) return;

    // Retrieve or calculate checkpoints
    if (!checkpointsRef.current) {
      const style = window.getComputedStyle(editor);
      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const paddingRight = parseFloat(style.paddingRight) || 0;
      const paddingTop = parseFloat(style.paddingTop) || 0;
      const lineHeight = parseFloat(style.lineHeight) || 25.6;

      const textareaWidth = editor.clientWidth - paddingLeft - paddingRight;

      // Measure character width for JetBrains Mono monospace font
      const span = document.createElement('span');
      span.style.fontFamily = style.fontFamily;
      span.style.fontSize = style.fontSize;
      span.style.visibility = 'hidden';
      span.style.position = 'absolute';
      span.style.whiteSpace = 'pre';
      span.textContent = 'a'.repeat(100);
      document.body.appendChild(span);
      const charWidth = span.getBoundingClientRect().width / 100;
      document.body.removeChild(span);

      const maxChars = charWidth > 0 ? Math.floor(textareaWidth / charWidth) : 80;

      const rawLines = editContent.split('\n');
      const visualLineOffsets: number[] = [];
      let cumulative = 0;
      
      for (const line of rawLines) {
        visualLineOffsets.push(cumulative);
        cumulative += countWrappedLines(line, maxChars);
      }

      const previewRect = preview.getBoundingClientRect();
      const list: Checkpoint[] = [];
      
      // Start checkpoint
      list.push({ id: 'start', editorScroll: 0, previewScroll: 0 });

      // Build checkpoints for all visible blocks with rendered elements
      for (const block of blocks) {
        if (block.startLine === undefined) continue;

        const el = document.getElementById(block.id);
        if (!el) continue;

        const elRect = el.getBoundingClientRect();
        const previewScroll = elRect.top - previewRect.top + preview.scrollTop - 20;
        const editorScroll = paddingTop + visualLineOffsets[block.startLine] * lineHeight;

        list.push({
          id: block.id,
          editorScroll: Math.max(0, Math.min(maxEditorScroll, editorScroll)),
          previewScroll: Math.max(0, Math.min(maxPreviewScroll, previewScroll))
        });
      }

      // End checkpoint
      list.push({ id: 'end', editorScroll: maxEditorScroll, previewScroll: maxPreviewScroll });

      // Sort checkpoints by editorScroll to be safe
      list.sort((a, b) => a.editorScroll - b.editorScroll);

      // Deduplicate checkpoints with identical editorScroll values to avoid zero range issues
      const deduped: Checkpoint[] = [];
      for (const cp of list) {
        if (deduped.length === 0 || cp.editorScroll !== deduped[deduped.length - 1].editorScroll) {
          deduped.push(cp);
        }
      }
      checkpointsRef.current = deduped;
    }

    const checkpoints = checkpointsRef.current;
    if (checkpoints.length < 2) return;

    // Find bounding checkpoints for current editor scroll top
    let prev = checkpoints[0];
    let next = checkpoints[1];

    if (editor.scrollTop <= checkpoints[0].editorScroll) {
      prev = checkpoints[0];
      next = checkpoints[1];
    } else if (editor.scrollTop >= checkpoints[checkpoints.length - 1].editorScroll) {
      prev = checkpoints[checkpoints.length - 2];
      next = checkpoints[checkpoints.length - 1];
    } else {
      // Binary search to find the correct interval in O(log N)
      let low = 0;
      let high = checkpoints.length - 2;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (editor.scrollTop >= checkpoints[mid].editorScroll && editor.scrollTop <= checkpoints[mid + 1].editorScroll) {
          prev = checkpoints[mid];
          next = checkpoints[mid + 1];
          break;
        } else if (editor.scrollTop < checkpoints[mid].editorScroll) {
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }
    }

    // Interpolate scroll position between the two checkpoints
    const range = next.editorScroll - prev.editorScroll;
    const progress = range > 0 ? (editor.scrollTop - prev.editorScroll) / range : 0;
    const targetScrollTop = prev.previewScroll + progress * (next.previewScroll - prev.previewScroll);

    // Sync scroll instantly
    preview.scrollTop = Math.max(0, Math.min(maxPreviewScroll, targetScrollTop));
  };

  // Inline rendering parser
  const renderInlineMarkdown = (text: string): React.ReactNode[] => {
    const tokenRegex = /(\$\$.+?\$\$)|(\$[^\$\s](?:[^\$]*?[^\$\s])?\$)|(!\[.*?\]\(.*?\))|(\[.*?\]\(.*?\))|(\*\*.*?\*\*)|(\*.*?\*)|(`.*?`)/g;
    const parts = text.split(tokenRegex);

    return parts.map((part, idx) => {
      if (!part) return null;

      if (part.startsWith('$$') && part.endsWith('$$')) {
        return (
          <span key={idx} className="md-view-math-block" style={{ display: 'block', textAlign: 'center' }}>
            <MathRenderer math={part.slice(2, -2)} displayMode={true} />
          </span>
        );
      }

      if (part.startsWith('$') && part.endsWith('$')) {
        return <MathRenderer key={idx} math={part.slice(1, -1)} displayMode={false} />;
      }

      if (part.startsWith('![') && part.includes('](')) {
        const match = part.match(/!\[(.*?)\]\((.*?)\)/);
        if (match) {
          return (
            <img
              key={idx}
              src={match[2]}
              alt={match[1]}
              className="md-view-img"
              onClick={(e) => e.stopPropagation()}
            />
          );
        }
      }

      if (part.startsWith('[') && part.includes('](')) {
        const match = part.match(/\[(.*?)\]\((.*?)\)/);
        if (match) {
          return (
            <a
              key={idx}
              href={match[2]}
              target="_blank"
              rel="noopener noreferrer"
              className="md-link"
              onClick={(e) => e.stopPropagation()}
            >
              {match[1]}
            </a>
          );
        }
      }

      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={idx} className="md-bold">{part.slice(2, -2)}</strong>;
      }

      if (part.startsWith('*') && part.endsWith('*')) {
        return <em key={idx} className="md-italic">{part.slice(1, -1)}</em>;
      }

      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={idx} className="md-view-inline-code">{part.slice(1, -1)}</code>;
      }

      return part;
    }).filter(Boolean) as React.ReactNode[];
  };

  // Blocks renderer
  const renderMarkdownBlocks = () => {
    return blocks.map((block) => {
      switch (block.type) {
        case 'h1':
          return <h1 key={block.id} id={block.id} className="md-view-h1">{renderInlineMarkdown(block.content || '')}</h1>;
        case 'h2':
          return <h2 key={block.id} id={block.id} className="md-view-h2">{renderInlineMarkdown(block.content || '')}</h2>;
        case 'h3':
          return <h3 key={block.id} id={block.id} className="md-view-h3">{renderInlineMarkdown(block.content || '')}</h3>;
        case 'h4':
          return <h4 key={block.id} id={block.id} className="md-view-h4">{renderInlineMarkdown(block.content || '')}</h4>;
        case 'h5':
          return <h5 key={block.id} id={block.id} className="md-view-h5">{renderInlineMarkdown(block.content || '')}</h5>;
        case 'h6':
          return <h6 key={block.id} id={block.id} className="md-view-h6">{renderInlineMarkdown(block.content || '')}</h6>;
        case 'paragraph':
          return <p key={block.id} id={block.id} className="md-view-p">{renderInlineMarkdown(block.content || '')}</p>;
        case 'blockquote':
          return (
            <blockquote key={block.id} id={block.id} className="md-view-blockquote">
              {block.content?.split('\n').map((l, idx) => (
                <p key={idx} style={{ margin: 0 }}>{renderInlineMarkdown(l)}</p>
              ))}
            </blockquote>
          );
        case 'hr':
          return <hr key={block.id} id={block.id} className="md-view-hr" />;
        case 'code':
          return (
            <div key={block.id} id={block.id} className="md-view-code-block">
              <div className="md-view-code-header">
                <span className="md-view-code-lang">{block.lang}</span>
                <button
                  className="md-view-code-copy-btn"
                  onClick={() => handleCopyCode(block.id, block.content || '')}
                >
                  {copiedBlockId === block.id ? (
                    <><Check size={12} /> Copied</>
                  ) : (
                    <><Copy size={12} /> Copy</>
                  )}
                </button>
              </div>
              <pre className="md-view-code-pre">
                <code>{block.content}</code>
              </pre>
            </div>
          );
        case 'table':
          return (
            <div key={block.id} id={block.id} className="md-view-table-wrapper">
              <table className="md-view-table">
                <thead>
                  <tr>
                    {block.headers?.map((h, idx) => (
                      <th
                        key={idx}
                        style={{ textAlign: block.aligns?.[idx] || 'left' }}
                      >
                        {renderInlineMarkdown(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows?.map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      {row.map((cell, cellIdx) => (
                        <td
                          key={cellIdx}
                          style={{ textAlign: block.aligns?.[cellIdx] || 'left' }}
                        >
                          {renderInlineMarkdown(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        case 'list':
          return (
            <div key={block.id} id={block.id} style={{ marginBottom: '1.2em' }}>
              {block.items?.map((item, idx) => {
                const Tag = item.ordered ? 'ol' : 'ul';
                const listClass = `md-view-list md-view-list-item-indent-${Math.min(2, Math.floor(item.indent / 2))}`;
                return (
                  <Tag key={idx} className={listClass} style={{ margin: 0, paddingLeft: item.indent > 0 ? '1.5em' : '20px' }}>
                    <li className="md-view-list-item">
                      {renderInlineMarkdown(item.text)}
                    </li>
                  </Tag>
                );
              })}
            </div>
          );
        default:
          return null;
      }
    });
  };

  if (loading) {
    return (
      <div className="loading-state">
        <Loader2 className="spinner" style={{ animation: 'spin 0.7s linear infinite' }} />
        <span>Reading Markdown document...</span>
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
    <div className="md-viewer">
      {/* Markdown Reader Toolbar Controls */}
      <div className="md-controls">
        <div className="md-controls-group">
          {editContent !== rawContent && (
            <button
              className="ctrl-btn active"
              onClick={handleSaveChanges}
              disabled={saving}
              title="Save changes"
              style={{ color: 'var(--accent)' }}
            >
              {saving ? (
                <Loader2 size={15} style={{ animation: 'spin 0.7s linear infinite' }} />
              ) : (
                <Save size={15} />
              )}
              <span style={{ fontSize: '0.8rem', fontWeight: 600, marginLeft: '4px' }}>
                {saving ? 'Saving...' : 'Save'}
              </span>
            </button>
          )}

          {editContent !== rawContent && (
            <button
              className="ctrl-btn"
              onClick={() => setEditContent(rawContent)}
              title="Discard changes"
              style={{ fontSize: '0.8rem', fontWeight: 600 }}
            >
              Reset
            </button>
          )}
        </div>

        {/* Font styling configuration (only visible when preview pane is active) */}
        {viewMode !== 'editor' && (
          <div className="md-controls-group">
            {/* Font Family selector */}
            <button
              className="ctrl-btn"
              onClick={() => fontFamily === 'sans-serif' ? setFontFamily('serif') : setFontFamily('sans-serif')}
              title="Change font family"
              style={{ fontSize: '0.78rem', fontWeight: 700, padding: '0 8px' }}
            >
              {fontFamily === 'sans-serif' ? 'Serif font' : 'Sans font'}
            </button>

            {/* Font Zoom controls */}
            <button
              className="ctrl-btn"
              onClick={() => setFontSize(p => Math.max(14, p - 2))}
              title="Decrease font size"
            >
              <Type size={13} />
            </button>
            <span className="ctrl-label" style={{ fontSize: '0.75rem', minWidth: '70px', textAlign: 'center' }}>
              {fontSize}px
            </span>
            <button
              className="ctrl-btn"
              onClick={() => setFontSize(p => Math.min(32, p + 2))}
              title="Increase font size"
            >
              <Type size={18} />
            </button>
          </div>
        )}

        {/* View Mode Layout toggles */}
        <div className="md-controls-group md-mode-toggles">
          {/* Button 1: Editor only */}
          <button
            className={`md-mode-btn md-mode-editor ${viewMode === 'editor' ? 'active' : ''}`}
            onClick={() => setViewMode('editor')}
            title="Show Editor Only"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6"></polyline>
              <polyline points="8 6 2 12 8 18"></polyline>
            </svg>
          </button>

          {/* Button 2: Editor and Preview (Split) */}
          <button
            className={`md-mode-btn md-mode-split ${viewMode === 'split' ? 'active' : ''}`}
            onClick={() => setViewMode('split')}
            title="Show Editor and Preview (Split)"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="12" y1="3" x2="12" y2="21"></line>
              <polyline points="8 10 6 12 8 14"></polyline>
              <polyline points="10 10 12 12 10 14" style={{ display: 'none' }}></polyline>
            </svg>
          </button>

          {/* Button 3: Preview only */}
          <button
            className={`md-mode-btn md-mode-preview ${viewMode === 'preview' ? 'active' : ''}`}
            onClick={() => setViewMode('preview')}
            title="Show Preview Only"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="12" cy="12" r="2.5"></circle>
              <path d="M8 12s2-3.5 4-3.5 4 3.5 4 3.5-2 3.5-4 3.5-4-3.5-4-3.5z"></path>
            </svg>
          </button>
        </div>
      </div>

      {/* Body content workspace */}
      <div className="md-viewer-workspace">
        {(viewMode === 'editor' || viewMode === 'split') && (
          <div className={`md-editor-pane ${viewMode === 'split' ? 'split' : ''}`}>
            <textarea
              ref={editorRef}
              className="md-editor-textarea"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onScroll={handleEditorScroll}
              placeholder="Write your markdown here..."
            />
          </div>
        )}

        {(viewMode === 'preview' || viewMode === 'split') && (
          <div
            className={`md-preview-pane ${viewMode === 'split' ? 'split' : ''}`}
            ref={scrollContainerRef}
            onScroll={handleScroll}
            onMouseUp={handleMouseUp}
            onDoubleClick={handleDblClick}
          >
            <div
              className={`md-content font-${fontFamily}`}
              style={{ fontSize: `${fontSize}px` }}
            >
              {renderMarkdownBlocks()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

MdViewer.displayName = 'MdViewer';
