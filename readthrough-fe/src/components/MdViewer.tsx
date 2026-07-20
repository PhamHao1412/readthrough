import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Type, Save, Copy, Check, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface MdViewerProps {
  bookId: string;
  url: string;
  initialCfi: string;
  onProgressChange: (cfi: string) => void;
  onSelection: (text: string, x?: number, y?: number) => void;
  onOutlineLoaded?: (outline: any[]) => void;
  theme: 'light' | 'dark' | 'sepia';
  readThroughActive?: boolean;
  rtSettings?: {
    fontFamily: string;
    fontSizeLevel: number;
    margin: string;
    lineHeight: string;
  };
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

// Helper to escape HTML characters
const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
};

// Highlight inline markdown tokens
const highlightInlineMarkdown = (text: string): string => {
  let escaped = escapeHtml(text);

  // Use placeholders to avoid matching markers inside already replaced HTML elements
  const placeholders: string[] = [];
  const addPlaceholder = (html: string): string => {
    const placeholder = `___MD_HIGHLIGHT_PLACEHOLDER_${placeholders.length}___`;
    placeholders.push(html);
    return placeholder;
  };

  // 1. Code Spans / Inline Code: `code`
  escaped = escaped.replace(/(`.*?`)/g, (match) => {
    return addPlaceholder(`<span class="md-syntax-inline-code">${match}</span>`);
  });

  // 2. Math Double Dollar: $$math$$
  escaped = escaped.replace(/(\$\$.+?\$\$)/g, (match) => {
    return addPlaceholder(`<span class="md-syntax-math-block">${match}</span>`);
  });

  // 3. Math Single Dollar: $math$
  escaped = escaped.replace(/(\$[^\$\s](?:[^\$]*?[^\$\s])?\$)/g, (match) => {
    return addPlaceholder(`<span class="md-syntax-math-inline">${match}</span>`);
  });

  // 4. Image Markdown: ![alt](url)
  escaped = escaped.replace(/(!\[.*?\]\(.*?\))/g, (match) => {
    const parts = match.match(/(!\[(.*?)\])\(((.*?))\)/);
    if (parts) {
      const alt = parts[2];
      const url = parts[3];
      return addPlaceholder(`<span class="md-syntax-img-marker">!</span><span class="md-syntax-link-text">[${alt}]</span><span class="md-syntax-link-url">(${url})</span>`);
    }
    return match;
  });

  // 5. Link Markdown: [text](url)
  escaped = escaped.replace(/(\[.*?\]\(.*?\))/g, (match) => {
    const parts = match.match(/(\[(.*?)\])\(((.*?))\)/);
    if (parts) {
      const label = parts[2];
      const url = parts[3];
      return addPlaceholder(`<span class="md-syntax-link-text">[${label}]</span><span class="md-syntax-link-url">(${url})</span>`);
    }
    return match;
  });

  // 6. Bold: **text**
  escaped = escaped.replace(/(\*\*.*?\*\*)/g, (match) => {
    return addPlaceholder(`<span class="md-syntax-bold">${match}</span>`);
  });

  // 7. Italic: *text* or _text_
  escaped = escaped.replace(/(\*.*?\*)/g, (match) => {
    return addPlaceholder(`<span class="md-syntax-italic">${match}</span>`);
  });
  escaped = escaped.replace(/(_.*?_)/g, (match) => {
    return addPlaceholder(`<span class="md-syntax-italic">${match}</span>`);
  });

  // Re-substitute all placeholders
  let prevResult;
  do {
    prevResult = escaped;
    for (let i = 0; i < placeholders.length; i++) {
      escaped = escaped.replace(`___MD_HIGHLIGHT_PLACEHOLDER_${i}___`, placeholders[i]);
    }
  } while (escaped !== prevResult);

  return escaped;
};

// Simple Markdown syntax highlighter for the editor background overlay
export const highlightMarkdownToHtml = (text: string): string => {
  const lines = text.split('\n');
  let inCodeBlock = false;

  const highlightedLines = lines.map((line, idx) => {
    const trimmed = line.trim();
    let content = '';

    // 1. Code Block Fence
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      content = `<span class="md-syntax-code-fence">${escapeHtml(line)}</span>`;
    }
    // 2. Code Block Content
    else if (inCodeBlock) {
      content = `<span class="md-syntax-code-block-content">${escapeHtml(line)}</span>`;
    }
    // 3. Headings
    else if (line.match(/^(#{1,6}\s+)(.*)$/)) {
      const headingMatch = line.match(/^(#{1,6}\s+)(.*)$/)!;
      const hashes = headingMatch[1];
      const contentText = headingMatch[2];
      content = `<span class="md-syntax-header md-syntax-h${hashes.trim().length}"><span class="md-syntax-header-hashes">${escapeHtml(hashes)}</span>${highlightInlineMarkdown(contentText)}</span>`;
    }
    // 4. Blockquote
    else if (trimmed.startsWith('>')) {
      const match = line.match(/^(\s*>\s*)(.*)$/);
      if (match) {
        content = `<span class="md-syntax-blockquote-marker">${escapeHtml(match[1])}</span><span class="md-syntax-blockquote-content">${highlightInlineMarkdown(match[2])}</span>`;
      } else {
        content = highlightInlineMarkdown(line);
      }
    }
    // 5. Horizontal Rule
    else if (/^(?:-{3,}|\*{3,}|\_{3,})$/.test(trimmed)) {
      content = `<span class="md-syntax-hr">${escapeHtml(line)}</span>`;
    }
    // 6. Lists
    else if (line.match(/^(\s*)([-*+]|\d+\.)(\s+)(.*)$/)) {
      const listMatch = line.match(/^(\s*)([-*+]|\d+\.)(\s+)(.*)$/)!;
      const indent = listMatch[1];
      const bullet = listMatch[2];
      const space = listMatch[3];
      const listContent = listMatch[4];
      content = `${escapeHtml(indent)}<span class="md-syntax-list-bullet">${escapeHtml(bullet)}</span>${escapeHtml(space)}<span class="md-syntax-list-content">${highlightInlineMarkdown(listContent)}</span>`;
    }
    // 7. Regular Line with inline highlights
    else {
      content = highlightInlineMarkdown(line);
    }

    const displayLine = content === '' ? '&#8203;' : content;
    return `<div class="md-editor-line" data-line="${idx}">${displayLine}</div>`;
  });

  return highlightedLines.join('');
};

interface Checkpoint {
  id: string;
  editorScroll: number;
  previewScroll: number;
}

// Obsolete simulated line wrapping removed in favor of direct DOM line elements offset measuring

// Helper to find the top-most visible block in the preview pane
const getTopVisibleBlock = (preview: HTMLDivElement, blocks: MarkdownBlock[]): MarkdownBlock | null => {
  const previewRect = preview.getBoundingClientRect();
  for (const block of blocks) {
    const el = document.getElementById(block.id);
    if (!el) continue;
    const elRect = el.getBoundingClientRect();
    if (elRect.bottom >= previewRect.top + 10) {
      return block;
    }
  }
  return null;
};

// Helper to find the top-most visible line in the editor (textarea)
const getTopVisibleLine = (editor: HTMLTextAreaElement, highlightPre: HTMLPreElement | null): number => {
  const lineElements = highlightPre?.querySelectorAll('.md-editor-line');
  if (!lineElements || lineElements.length === 0) return 0;

  const scrollTop = editor.scrollTop;

  for (let i = 0; i < lineElements.length; i++) {
    const el = lineElements[i] as HTMLElement;
    const lineBottom = el.offsetTop + el.offsetHeight;
    if (lineBottom >= scrollTop) {
      return i;
    }
  }
  return 0;
};

// Helper to map a line index back to a MarkdownBlock
const getBlockAtLine = (lineIndex: number, blocks: MarkdownBlock[]): MarkdownBlock | null => {
  for (const block of blocks) {
    if (block.startLine !== undefined && block.endLine !== undefined) {
      if (lineIndex >= block.startLine && lineIndex <= block.endLine) {
        return block;
      }
    }
  }
  return null;
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
      .catch(() => {
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
  onOutlineLoaded,
  readThroughActive = false,
  rtSettings,
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
  const [pendingScrollLine, setPendingScrollLine] = useState<number | null>(null);
  const [pendingScrollBlockId, setPendingScrollBlockId] = useState<string | null>(null);

  // Settings states
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem(`readthrough_font_size_md_${bookId}`);
    return saved ? Math.max(14, Math.min(32, parseInt(saved, 10))) : 16;
  });
  const [fontFamily, setFontFamily] = useState<'sans-serif' | 'serif'>(() => {
    const saved = localStorage.getItem(`readthrough_font_family_md_${bookId}`);
    return saved === 'serif' ? 'serif' : 'sans-serif';
  });

  const [copiedBlockId, setCopiedBlockId] = useState<string | null>(null);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const highlightPreRef = useRef<HTMLPreElement>(null);
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

  // Perform scroll synchronization for Editor on view mode transition
  useEffect(() => {
    if (pendingScrollLine !== null && (viewMode === 'editor' || viewMode === 'split')) {
      const editor = editorRef.current;
      if (editor) {
        const timer = setTimeout(() => {
          const style = window.getComputedStyle(editor);
          const paddingTop = parseFloat(style.paddingTop) || 0;
          const lineElements = highlightPreRef.current?.querySelectorAll('.md-editor-line');
          
          if (lineElements && lineElements[pendingScrollLine]) {
            const lineEl = lineElements[pendingScrollLine] as HTMLElement;
            editor.scrollTop = lineEl.offsetTop - paddingTop;
          }
          setPendingScrollLine(null);
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [viewMode, pendingScrollLine]);

  // Perform scroll synchronization for Preview on view mode transition
  useEffect(() => {
    if (pendingScrollBlockId !== null && (viewMode === 'preview' || viewMode === 'split')) {
      const preview = scrollContainerRef.current;
      if (preview) {
        const timer = setTimeout(() => {
          const targetElement = document.getElementById(pendingScrollBlockId);
          if (targetElement) {
            ignoreScrollEventRef.current = true;
            const containerRect = preview.getBoundingClientRect();
            const targetRect = targetElement.getBoundingClientRect();
            const targetOffsetTop = targetRect.top - containerRect.top + preview.scrollTop;
            
            preview.scrollTop = Math.max(0, targetOffsetTop - 20);
            
            setTimeout(() => {
              ignoreScrollEventRef.current = false;
            }, 200);
          }
          setPendingScrollBlockId(null);
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [viewMode, pendingScrollBlockId]);

  // Handle view mode changes and synchronize scroll positions
  const handleViewModeChange = (newMode: 'editor' | 'split' | 'preview') => {
    // 1. Preview -> Editor/Split: Save preview top block to scroll editor to it
    if ((viewMode === 'preview' || viewMode === 'split') && (newMode === 'editor' || newMode === 'split')) {
      const preview = scrollContainerRef.current;
      if (preview) {
        const topBlock = getTopVisibleBlock(preview, blocks);
        if (topBlock && topBlock.startLine !== undefined) {
          setPendingScrollLine(topBlock.startLine);
        }
      }
    }
    // 2. Editor -> Preview/Split: Save editor top line to scroll preview to it
    else if (viewMode === 'editor' && (newMode === 'preview' || newMode === 'split')) {
      const editor = editorRef.current;
      if (editor) {
        const topLine = getTopVisibleLine(editor, highlightPreRef.current);
        const block = getBlockAtLine(topLine, blocks);
        if (block) {
          setPendingScrollBlockId(block.id);
        }
      }
    }
    setViewMode(newMode);
  };


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

  const handleMouseUp = (e: React.MouseEvent) => {
    e.stopPropagation();
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
    e.stopPropagation();
    // Use setTimeout to let the browser finalize its native word selection first
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

      // Strip leading/trailing punctuation from the selected text so that
      // double-clicking "linearizable," returns "linearizable" not "linearizable,"
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
    const editor = e.currentTarget;
    if (highlightPreRef.current) {
      highlightPreRef.current.scrollTop = editor.scrollTop;
      highlightPreRef.current.scrollLeft = editor.scrollLeft;
    }

    if (viewMode !== 'split') return;
    const preview = scrollContainerRef.current;
    if (!editor || !preview || blocks.length === 0) return;

    // Calculate maximum scroll boundaries
    const maxEditorScroll = editor.scrollHeight - editor.clientHeight;
    const maxPreviewScroll = preview.scrollHeight - preview.clientHeight;
    if (maxEditorScroll <= 0) return;

    // Retrieve or calculate checkpoints
    if (!checkpointsRef.current) {
      const lineElements = highlightPreRef.current?.querySelectorAll('.md-editor-line');
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

        // Retrieve the actual visual line element from the highlight pre
        const lineEl = lineElements?.[block.startLine] as HTMLElement | undefined;
        if (!lineEl) continue;
        
        const editorScroll = lineEl.offsetTop;

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

  // Handle next/prev page scroll events for MD preview pane
  useEffect(() => {
    const handleNext = () => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollBy({
          top: scrollContainerRef.current.clientHeight - 40,
          behavior: 'smooth'
        });
      }
    };
    const handlePrev = () => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollBy({
          top: -(scrollContainerRef.current.clientHeight - 40),
          behavior: 'smooth'
        });
      }
    };

    window.addEventListener('readthrough-next-page', handleNext);
    window.addEventListener('readthrough-prev-page', handlePrev);
    return () => {
      window.removeEventListener('readthrough-next-page', handleNext);
      window.removeEventListener('readthrough-prev-page', handlePrev);
    };
  }, []);

  const mdStyles = readThroughActive && rtSettings ? {
    fontFamily: rtSettings.fontFamily === 'serif' ? "'Lora', Georgia, serif" :
                rtSettings.fontFamily === 'sans-serif' ? "'Inter', sans-serif" :
                rtSettings.fontFamily === 'monospace' ? "'JetBrains Mono', monospace" :
                rtSettings.fontFamily === 'dyslexic' ? "'Atkinson Hyperlegible', sans-serif" : undefined,
    fontSize: `${14 + (rtSettings.fontSizeLevel - 1) * 2}px`,
    lineHeight: rtSettings.lineHeight,
    paddingLeft: rtSettings.margin === 'narrow' ? '4%' : rtSettings.margin === 'normal' ? '12%' : '20%',
    paddingRight: rtSettings.margin === 'narrow' ? '4%' : rtSettings.margin === 'normal' ? '12%' : '20%',
    maxWidth: 'none',
  } : {
    fontSize: `${fontSize}px`
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
      {!readThroughActive && (
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

        {/* Font styling configuration */}
        <div className="md-controls-group">
          {/* Font Family selector (only visible when preview pane is active) */}
          {viewMode !== 'editor' && (
            <button
              className="ctrl-btn"
              onClick={() => fontFamily === 'sans-serif' ? setFontFamily('serif') : setFontFamily('sans-serif')}
              title="Change font family"
              style={{ fontSize: '0.78rem', fontWeight: 700, padding: '0 8px' }}
            >
              {fontFamily === 'sans-serif' ? 'Serif font' : 'Sans font'}
            </button>
          )}

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

        {/* View Mode Layout toggles */}
        <div className="md-controls-group md-mode-toggles">
          {/* Button 1: Editor only */}
          <button
            className={`md-mode-btn md-mode-editor ${viewMode === 'editor' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('editor')}
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
            onClick={() => handleViewModeChange('split')}
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
            onClick={() => handleViewModeChange('preview')}
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
    )}

      {/* Body content workspace */}
      <div className="md-viewer-workspace">
        {(viewMode === 'editor' || viewMode === 'split') && (
          <div className={`md-editor-pane ${viewMode === 'split' ? 'split' : ''}`}>
            <div className="md-editor-container">
              <pre
                ref={highlightPreRef}
                className="md-editor-highlight"
                aria-hidden="true"
                style={{ fontSize: `${Math.max(12, fontSize - 4)}px` }}
                dangerouslySetInnerHTML={{ __html: highlightMarkdownToHtml(editContent) }}
              />
              <textarea
                ref={editorRef}
                className="md-editor-textarea"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onScroll={handleEditorScroll}
                placeholder="Write your markdown here..."
                style={{ fontSize: `${Math.max(12, fontSize - 4)}px` }}
              />
            </div>
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
              className={`md-content font-${readThroughActive && rtSettings ? rtSettings.fontFamily : fontFamily}`}
              style={mdStyles}
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
