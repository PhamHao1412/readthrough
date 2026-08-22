import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Sparkles,
  BookOpen,
  FileText,
  Lightbulb,
  HelpCircle,
  Bookmark,
  RotateCcw,
  AlertCircle,
  Copy,
  Check,
  X,
  Trash2,
  ArrowLeft,
  Search,
  ChevronRight,
  ChevronDown,
  List,
  Compass,
  Quote,
  CheckCircle2,
  XCircle,
  Award,
  Square,
  Brain,
} from 'lucide-react';



import { useAuth } from '../context/AuthContext';

export interface AIReadingCompanionPanelProps {
  bookId: string;
  bookTitle: string;
  bookAuthor?: string;
  sectionTitle: string;
  pageNumber?: number;
  sectionContent: string;
  activeTab: 'summary' | 'explain' | 'quiz' | 'vocab';
  onTabChange: (tab: 'summary' | 'explain' | 'quiz' | 'vocab') => void;
  onClose: () => void;
  bookVocab: any[];
  onVocabularySaved: () => void;
  outline?: any[];
  currentPage?: number;
  totalPages?: number;
  onNavigateOutlineItem: (item: any) => void;
  onSummarizeOutlineItem: (item: any) => void;
  isExtracting?: boolean;
  isChapter?: boolean;
}


export interface ParsedQuizQuestion {
  id: string;
  number: number;
  title: string;
  question: string;
  options: Array<{
    letter: string;
    text: string;
  }>;
  correctAnswerLetter: string;
  correctAnswerText: string;
  explanation: string;
}

export const parseQuizMarkdown = (rawMd: string): ParsedQuizQuestion[] => {
  if (!rawMd) return [];
  const text = rawMd.replace(/\r\n/g, '\n');

  const questionBlocks = text.split(/(?=^#{1,4}\s*Question\s+\d+)/gmi);
  const parsedQuestions: ParsedQuizQuestion[] = [];

  for (let i = 0; i < questionBlocks.length; i++) {
    const block = questionBlocks[i].trim();
    if (!/^#{1,4}\s*Question\s+\d+/i.test(block)) continue;

    // 1. Extract Question Header and Title
    const headerMatch = block.match(/^#{1,4}\s*Question\s+(\d+)[:\s-]*(.*?)(?:\n|$)/i);
    const qNum = headerMatch ? parseInt(headerMatch[1], 10) : i + 1;
    const qTitle = headerMatch && headerMatch[2] ? headerMatch[2].trim() : `Question ${qNum}`;

    // 2. Extract Correct Answer & Explanation
    let correctAnswerLetter = '';
    let correctAnswerText = '';
    let explanation = '';

    const correctMatch = block.match(/(?:\*\*|\b)Correct Answer:?(?:\*\*|\b)[:\s]*\(?([A-Da-d])\)?[:\s-]*(.*?)(?:\n\n|\n\*\*Explanation|\nExplanation|<\/details>|$)/si);
    if (correctMatch) {
      correctAnswerLetter = correctMatch[1].toUpperCase();
      correctAnswerText = correctMatch[2].trim().replace(/^\*\*/, '').replace(/\*\*$/, '');
    }

    const explMatch = block.match(/(?:^|\n)\s*(?:\*\*)?Explanation:?(?:\*\*)?[:\s]*([\s\S]*?)(?:<\/details>|\n---|$)/i);
    if (explMatch) {
      explanation = explMatch[1]
        .replace(/<\/?[a-z][^>]*>/gi, '')
        .trim();
    }

    // 3. Extract Options (A, B, C, D)
    const options: Array<{ letter: string; text: string }> = [];
    const optionRegex = /(?:^|\n)\s*[-*]?\s*(?:\*\*)?\(?([A-Da-d])\)?(?:\*\*)?[:\.\s-]+([^\n]+)/g;
    let optMatch;

    const preDetailsContent = block.split(/<details|\*\*Correct Answer|Correct Answer:/i)[0];

    while ((optMatch = optionRegex.exec(preDetailsContent)) !== null) {
      const letter = optMatch[1].toUpperCase();
      const optText = optMatch[2].trim().replace(/^\*\*/, '').replace(/\*\*$/, '');
      if (['A', 'B', 'C', 'D'].includes(letter)) {
        if (!options.some(o => o.letter === letter)) {
          options.push({ letter, text: optText });
        }
      }
    }

    // 4. Extract Question Body
    const afterHeader = block.replace(/^#{1,4}\s*Question\s+\d+[:\s-]*.*?\n+/i, '');
    const questionBodyLines: string[] = [];
    for (const line of afterHeader.split('\n')) {
      if (/^\s*[-*]?\s*(?:\*\*)?\(?[A-Da-d]\)?(?:\*\*)?[:\.\s-]/.test(line)) {
        break;
      }
      if (line.includes('<details') || line.includes('Correct Answer:')) break;
      questionBodyLines.push(line);
    }
    const questionText = questionBodyLines.join('\n').trim();

    if (options.length >= 2) {
      parsedQuestions.push({
        id: `q-${qNum}-${i}`,
        number: qNum,
        title: qTitle,
        question: questionText || qTitle,
        options,
        correctAnswerLetter,
        correctAnswerText,
        explanation,
      });
    }
  }

  return parsedQuestions;
};

export const AIReadingCompanionPanel: React.FC<AIReadingCompanionPanelProps> = ({
  bookId,
  bookTitle,
  bookAuthor,
  sectionTitle,
  pageNumber,
  sectionContent,
  activeTab,
  onTabChange,
  onClose,
  bookVocab,
  onVocabularySaved,
  outline = [],
  currentPage = 1,
  onNavigateOutlineItem,
  onSummarizeOutlineItem,
  isExtracting = false,
  isChapter = false,
}) => {

  const { fetchWithAuth } = useAuth();


  // Primary view mode: 'toc' (Table of Contents) or 'companion' (AI Insights)
  const [viewMode, setViewMode] = useState<'toc' | 'companion'>(() => {
    return sectionContent && sectionContent.trim().length > 0 ? 'companion' : 'toc';
  });

  // TOC search and expansion state
  const [tocSearch, setTocSearch] = useState<string>('');
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

  // Content state per action: action -> accumulated text
  const [contentMap, setContentMap] = useState<Record<string, string>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<boolean>(false);

  // Real-time Thinking HUD states
  const [thinkingElapsed, setThinkingElapsed] = useState<number>(0);
  const [thoughtDurationMap, setThoughtDurationMap] = useState<Record<string, number>>({});

  // Interactive Quiz state
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [revealedExplanations, setRevealedExplanations] = useState<Record<string, boolean>>({});

  // Auto-scroll management
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef<boolean>(false);

  const scrollToBottom = useCallback(() => {
    if (userScrolledUpRef.current || !scrollContainerRef.current) return;
    const el = scrollContainerRef.current;
    el.scrollTop = el.scrollHeight;
  }, []);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const el = scrollContainerRef.current;
    const threshold = 45;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    userScrolledUpRef.current = !isNearBottom;
  };

  const prevSectionKeyRef = useRef<string>('');
  const currentSectionKey = `${bookId}:${sectionTitle}:${pageNumber}`;

  // Track whether an action was attempted for the current section to prevent infinite request loops
  const hasAttemptedRef = useRef<Record<string, boolean>>({});

  // Reset stream states and quiz answers when switching to a completely new section
  useEffect(() => {
    if (prevSectionKeyRef.current !== currentSectionKey) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      prevSectionKeyRef.current = currentSectionKey;
      setContentMap({});
      setLoadingMap({});
      setErrorMap({});
      setUserAnswers({});
      setRevealedExplanations({});
      setThoughtDurationMap({});
      setThinkingElapsed(0);
      hasAttemptedRef.current = {};
      userScrolledUpRef.current = false;
    }
  }, [currentSectionKey]);




  // Streaming AbortController to support cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleCancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoadingMap(prev => ({ ...prev, [activeTab]: false }));
  }, [activeTab]);

  // Clean up ongoing stream on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // Streaming action fetcher
  const streamAction = useCallback(async (action: 'summary' | 'explain' | 'quiz') => {
    if (!sectionContent || !sectionContent.trim()) {
      return;
    }

    // Cancel any previous stream before starting a new one
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setLoadingMap(prev => ({ ...prev, [action]: true }));
    setErrorMap(prev => ({ ...prev, [action]: '' }));
    setContentMap(prev => ({ ...prev, [action]: '' }));
    setThinkingElapsed(0);
    userScrolledUpRef.current = false;
    hasAttemptedRef.current[action] = true;

    const streamStartTime = Date.now();
    let firstTokenReceived = false;
    const thinkingTimer = setInterval(() => {
      if (!firstTokenReceived) {
        setThinkingElapsed(parseFloat(((Date.now() - streamStartTime) / 1000).toFixed(1)));
      }
    }, 100);

    let accumulatedText = '';
    let isCached = false;

    try {
      const res = await fetchWithAuth('/api/v1/ai/companion/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          book_id: bookId,
          section_title: sectionTitle || `Page ${pageNumber || currentPage}`,
          content: sectionContent,
          action,
          book_title: bookTitle,
          book_author: bookAuthor || 'Author',
          page_number: pageNumber || currentPage || 1,
          is_chapter: isChapter || false,
        }),
      });

      if (!res.ok) {
        let errMsg = 'AI Companion service unavailable.';
        if (res.status === 402) {
          errMsg = 'AI credit limit exceeded. Please contact admin or upgrade.';
        } else if (res.status === 429) {
          errMsg = 'Too many requests. Please wait a moment and try again.';
        } else {
          try {
            const errJson = await res.json();
            if (errJson.message) errMsg = errJson.message;
          } catch {}
        }
        throw new Error(errMsg);
      }

      if (!res.body) throw new Error('Streaming not supported.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let lastRenderTime = 0;
      const THROTTLE_MS = 35;

      while (true) {
        if (abortController.signal.aborted) {
          break;
        }

        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let hasNewContent = false;
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              if (parsed.content) {
                if (parsed.content.startsWith('[ERROR] ')) {
                  throw new Error(parsed.content.slice(8));
                }
                accumulatedText += parsed.content;
                hasNewContent = true;
              }
            } catch (jsonErr: any) {
              if (jsonErr.message && !jsonErr.message.includes('JSON')) {
                throw jsonErr;
              }
            }
          }
        }

        if (hasNewContent) {
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            clearInterval(thinkingTimer);
            const duration = parseFloat(((Date.now() - streamStartTime) / 1000).toFixed(1));
            setThoughtDurationMap(prev => ({ ...prev, [action]: duration }));
          }

          const now = Date.now();
          if (now - lastRenderTime >= THROTTLE_MS) {
            lastRenderTime = now;
            let displayText = accumulatedText;
            if (displayText.startsWith('[CACHED]')) {
              displayText = displayText.slice(8);
              isCached = true;
            }
            setContentMap(prev => ({ ...prev, [action]: displayText }));
            requestAnimationFrame(() => scrollToBottom());
          }
        }
      }

      if (abortController.signal.aborted) {
        return;
      }

      let finalText = accumulatedText.trim();
      if (finalText.startsWith('[CACHED]')) {
        finalText = finalText.slice(8).trim();
        isCached = true;
      }

      if (!finalText) {
        throw new Error('AI returned an empty response. Please verify your OpenAI model name and API key.');
      }

      setContentMap(prev => ({ ...prev, [action]: finalText }));

      if (isCached && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = 0;
      }
    } catch (err: any) {
      clearInterval(thinkingTimer);
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        return;
      }
      setErrorMap(prev => ({
        ...prev,
        [action]: err.message || 'Unable to generate AI content. Please try again.',
      }));
    } finally {
      clearInterval(thinkingTimer);
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      setLoadingMap(prev => ({ ...prev, [action]: false }));
    }

  }, [bookId, sectionTitle, sectionContent, bookTitle, bookAuthor, pageNumber, currentPage, fetchWithAuth, scrollToBottom]);


  // Auto-trigger active tab action if not already loaded and in companion view
  useEffect(() => {
    if (viewMode !== 'companion' || activeTab === 'vocab' || isExtracting) return;
    if (
      sectionContent &&
      sectionContent.trim().length > 0 &&
      !contentMap[activeTab] &&
      !loadingMap[activeTab] &&
      !errorMap[activeTab] &&
      !hasAttemptedRef.current[activeTab]
    ) {
      streamAction(activeTab);
    }
  }, [viewMode, activeTab, sectionContent, contentMap, loadingMap, errorMap, isExtracting, streamAction]);


  const handleCopy = () => {
    const textToCopy = contentMap[activeTab] || '';
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleNodeExpand = (nodePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedNodes(prev => ({ ...prev, [nodePath]: !prev[nodePath] }));
  };

  const handleTOCItemNavigate = (item: any) => {
    onNavigateOutlineItem(item);
  };

  const handleTOCItemSummarize = (item: any) => {
    onSummarizeOutlineItem(item);
    setViewMode('companion');
  };

  // ════════════════════════════════════════════════════════
  // INTERACTIVE QUIZ STATE & HANDLERS
  // ════════════════════════════════════════════════════════

  const parsedQuizQuestions = useMemo(() => {
    if (activeTab !== 'quiz' || !contentMap['quiz']) return [];
    return parseQuizMarkdown(contentMap['quiz']);
  }, [activeTab, contentMap]);

  const handleSelectQuizOption = (questionId: string, optionLetter: string) => {
    setUserAnswers(prev => ({
      ...prev,
      [questionId]: optionLetter,
    }));
    setRevealedExplanations(prev => ({
      ...prev,
      [questionId]: true,
    }));
  };

  const toggleRevealExplanation = (questionId: string) => {
    setRevealedExplanations(prev => ({
      ...prev,
      [questionId]: !prev[questionId],
    }));
  };

  const handleResetQuiz = () => {
    setUserAnswers({});
    setRevealedExplanations({});
  };


  // ════════════════════════════════════════════════════════
  // ENHANCED MARKDOWN PARSER FOR REAL-TIME STREAMING
  // ════════════════════════════════════════════════════════

  interface CodeBlockItem {
    lang: string;
    code: string;
  }

  const renderInline = (text: string) => {
    let toParse = text;
    const boldMatches = toParse.match(/\*\*/g);
    if (boldMatches && boldMatches.length % 2 !== 0) {
      toParse += '**';
    }

    const parts = toParse.split(/(\*\*.*?\*\*|`.*?`)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={idx} className="ai-md-strong">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={idx} className="ai-md-code-inline">{part.slice(1, -1)}</code>;
      }
      return part;
    });
  };

  const renderRichMarkdown = (rawContent: string) => {
    if (!rawContent || !rawContent.trim()) return null;

    let text = rawContent.replace(/\r\n/g, '\n');

    // Protect code blocks with unique tokens
    const codeBlocks: CodeBlockItem[] = [];
    text = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
      const token = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push({ lang: (lang || '').trim(), code });
      return `\n\n${token}\n\n`;
    });

    // Handle unclosed code block during streaming
    const unclosedMatch = text.match(/```([a-zA-Z0-9_-]*)\n?([\s\S]*)$/);
    let streamingCodeBlock: CodeBlockItem | null = null;
    if (unclosedMatch) {
      streamingCodeBlock = {
        lang: (unclosedMatch[1] || '').trim(),
        code: unclosedMatch[2],
      };
      text = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*)$/, '\n\n__STREAMING_CODE_BLOCK__\n\n');
    }

    // Normalize markdown boundaries
    text = text.replace(/([^\n])\s*(#{1,6}\s+)/g, '$1\n\n$2');
    text = text.replace(/([^\n])\s*(>\s+)/g, '$1\n\n$2');
    text = text.replace(/([^\n])\s*(\n\s*[-*]\s+)/g, '$1\n$2');

    const rawBlocks = text.split(/\n{2,}/);

    return rawBlocks.map((block, bIdx) => {
      const trimmed = block.trim();
      if (!trimmed) return null;

      // 1. Full Code Block
      const codeBlockMatch = trimmed.match(/^__CODE_BLOCK_(\d+)__$/);
      if (codeBlockMatch) {
        const item = codeBlocks[parseInt(codeBlockMatch[1], 10)];
        if (item) {
          return (
            <pre key={bIdx} className="ai-md-code-block">
              {item.lang && <div className="ai-code-lang">{item.lang}</div>}
              <code>{item.code}</code>
            </pre>
          );
        }
      }

      // 1b. Active Streaming Code Block
      if (trimmed === '__STREAMING_CODE_BLOCK__' && streamingCodeBlock) {
        return (
          <pre key={bIdx} className="ai-md-code-block">
            {streamingCodeBlock.lang && <div className="ai-code-lang">{streamingCodeBlock.lang}</div>}
            <code>{streamingCodeBlock.code}</code>
          </pre>
        );
      }

      // 2. TL;DR Overview Card
      if (/^#{1,4}\s*TL;?DR/i.test(trimmed)) {
        const content = trimmed.replace(/^#{1,4}\s*TL;?DR[:\s-]*/i, '').trim();
        return (
          <div key={bIdx} className="ai-companion-tldr-card">
            <div className="ai-card-badge tldr-badge">
              <Sparkles size={13} />
              <span>TL;DR Overview</span>
            </div>
            {content && <p className="ai-tldr-text">{renderInline(content)}</p>}
          </div>
        );
      }

      // 3. Main Takeaway Card
      if (/^#{1,4}\s*Main\s+Takeaway/i.test(trimmed) || trimmed.startsWith('>')) {
        const quoteText = trimmed
          .replace(/^#{1,4}\s*Main\s+Takeaway[:\s-]*/i, '')
          .replace(/^>\s*/gm, '')
          .trim();
        if (!quoteText) return null;

        return (
          <div key={bIdx} className="ai-companion-quote-card">
            <div className="ai-quote-tag">
              <Quote size={13} />
              <span>Main Takeaway</span>
            </div>
            <p className="ai-quote-text">{renderInline(quoteText)}</p>
          </div>
        );
      }

      // 4. Key Ideas / Core Concepts Header
      if (/^#{1,4}\s*(Key\s+Ideas|Key\s+Concepts|Core\s+Ideas|Key\s+Mechanisms)/i.test(trimmed)) {
        const headerTitle = trimmed.match(/^#{1,4}\s*(.*)$/)?.[1] || 'Key Ideas';
        const restContent = trimmed.replace(/^#{1,4}\s*(.*?)(\n|$)/, '').trim();
        return (
          <div key={bIdx} className="ai-companion-key-ideas-wrapper">
            <div className="ai-section-heading">
              <Lightbulb size={16} />
              <h4>{headerTitle}</h4>
            </div>
            {restContent && renderRichMarkdown(restContent)}
          </div>
        );
      }

      // 5. Filter out raw HTML details/summary or separators
      if (/^<\/?details[^>]*>/i.test(trimmed) || /^<\/?summary[^>]*>/i.test(trimmed) || trimmed === '---') {
        return null;
      }

      // 6. Generic Headings
      if (trimmed.startsWith('#')) {
        const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (match && match[2].trim()) {
          const level = match[1].length;
          const content = match[2].trim();
          if (level === 1) return <h2 key={bIdx} className="ai-md-h1">{renderInline(content)}</h2>;
          if (level === 2) return <h3 key={bIdx} className="ai-md-h2">{renderInline(content)}</h3>;
          return <h4 key={bIdx} className="ai-md-h3">{renderInline(content)}</h4>;
        }
        return null;
      }

      // 6b. Standalone Title / Heading without hash (e.g. "Partitioning and replication" or "**Partitioning of Key-Value Data**")
      const isStandaloneTitle =
        !trimmed.includes('\n') &&
        trimmed.length <= 70 &&
        !/[.!?;:]$/.test(trimmed) &&
        !trimmed.startsWith('- ') &&
        !trimmed.startsWith('* ') &&
        !/^\d+\./.test(trimmed) &&
        /^[A-Z*]/.test(trimmed);

      if (isStandaloneTitle) {
        let cleanTitle = trimmed;
        if (cleanTitle.startsWith('**') && cleanTitle.endsWith('**')) {
          cleanTitle = cleanTitle.slice(2, -2).trim();
        }
        return <h3 key={bIdx} className="ai-md-h2">{renderInline(cleanTitle)}</h3>;
      }


      // 7. Unordered Lists
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const lines = trimmed.split('\n').filter(l => l.trim().startsWith('- ') || l.trim().startsWith('* '));
        return (
          <ul key={bIdx} className="ai-md-ul">
            {lines.map((line, lIdx) => (
              <li key={lIdx} className="ai-md-li">
                {renderInline(line.replace(/^[-*]\s+/, ''))}
              </li>
            ))}
          </ul>
        );
      }

      // 8. Numbered Lists
      if (/^\d+\.\s+/.test(trimmed)) {
        const lines = trimmed.split('\n').filter(l => /^\d+\.\s+/.test(l.trim()));
        return (
          <ol key={bIdx} className="ai-md-ol">
            {lines.map((line, lIdx) => (
              <li key={lIdx} className="ai-md-li-num">
                {renderInline(line.replace(/^\d+\.\s+/, ''))}
              </li>
            ))}
          </ol>
        );
      }

      // 9. Default Paragraph
      return (
        <p key={bIdx} className="ai-md-p">
          {renderInline(trimmed)}
        </p>
      );
    });
  };


  // ════════════════════════════════════════════════════════
  // TOC TREE RENDERER & ACTIVE ITEM TRACKER

  interface FlattenedTOCNode {
    item: any;
    nodePath: string;
    page: number;
    parentPaths: string[];
  }

  const flattenOutline = (items: any[], path = '', parentPaths: string[] = []): FlattenedTOCNode[] => {
    let result: FlattenedTOCNode[] = [];
    items.forEach((item, idx) => {
      const nodePath = path ? `${path}-${idx}` : `${idx}`;
      const page = typeof item.target === 'number' ? item.target : (parseInt(item.target, 10) || 0);
      result.push({ item, nodePath, page, parentPaths });
      if (item.children && item.children.length > 0) {
        result = result.concat(flattenOutline(item.children, nodePath, [...parentPaths, nodePath]));
      }
    });
    return result;
  };

  // Find the most specific TOC node matching currentPage
  const activeNode = useMemo(() => {
    if (!outline || outline.length === 0 || !currentPage || currentPage <= 0) {
      return null;
    }
    const flat = flattenOutline(outline);
    const validNodes = flat.filter(n => n.page > 0 && n.page <= currentPage);
    if (validNodes.length === 0) return null;
    return validNodes[validNodes.length - 1];
  }, [outline, currentPage]);

  // Auto-expand all parent nodes for the currently active TOC item
  useEffect(() => {
    if (!activeNode || activeNode.parentPaths.length === 0) return;
    setExpandedNodes(prev => {
      let changed = false;
      const next = { ...prev };
      for (const p of activeNode.parentPaths) {
        if (!next[p]) {
          next[p] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeNode]);

  // Smoothly scroll active TOC item into view when opening or browsing TOC
  useEffect(() => {
    if (viewMode === 'toc' && activeNode) {
      const timer = setTimeout(() => {
        const activeEl = document.querySelector('.ai-toc-item-row.active');
        if (activeEl) {
          activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [viewMode, activeNode]);

  const filterOutlineItems = (items: any[], query: string): any[] => {
    if (!query.trim()) return items;
    const lower = query.toLowerCase();

    return items
      .map(item => {
        const titleMatch = (item.title || '').toLowerCase().includes(lower);
        const filteredChildren = item.children ? filterOutlineItems(item.children, query) : [];
        if (titleMatch || filteredChildren.length > 0) {
          return {
            ...item,
            children: filteredChildren,
          };
        }
        return null;
      })
      .filter(Boolean);
  };

  const renderTOCNodes = (items: any[], depth = 0, path = ''): React.ReactNode => {
    return items.map((item, idx) => {
      const nodePath = path ? `${path}-${idx}` : `${idx}`;
      const hasChildren = item.children && item.children.length > 0;
      const isExpanded = tocSearch.trim() ? true : !!expandedNodes[nodePath];
      const isCurrentSection = Boolean(activeNode && activeNode.nodePath === nodePath);

      return (
        <div key={nodePath} className="ai-toc-tree-node">
          <div
            className={`ai-toc-item-row ${isCurrentSection ? 'active' : ''}`}

            style={{ paddingLeft: `${14 + depth * 14}px` }}
            onClick={() => handleTOCItemNavigate(item)}
            title={`${item.title} (Click to jump to page)`}
          >
            {hasChildren ? (
              <button
                className={`ai-toc-expand-btn ${isExpanded ? 'expanded' : ''}`}
                onClick={(e) => toggleNodeExpand(nodePath, e)}
                title={isExpanded ? 'Collapse section' : 'Expand section'}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            ) : (
              <div className="ai-toc-expand-spacer" />
            )}

            <span className="ai-toc-item-title">{item.title}</span>

            {typeof item.target === 'number' && item.target > 0 && (
              <span className="ai-toc-item-page">p. {item.target}</span>
            )}

            <button
              className={`ai-toc-quick-action ${depth === 0 && hasChildren ? 'chapter-action' : ''}`}
              title={depth === 0 && hasChildren ? 'Analyze Chapter Roadmap & Overview' : 'Deep Dive this Section'}
              onClick={(e) => {
                e.stopPropagation();
                handleTOCItemSummarize(item);
              }}
            >
              <Sparkles size={15} />
            </button>
          </div>


          {hasChildren && isExpanded && (
            <div className="ai-toc-children">
              {renderTOCNodes(item.children, depth + 1, nodePath)}
            </div>
          )}
        </div>
      );
    });
  };

  const filteredOutline = filterOutlineItems(outline, tocSearch);
  const currentContent = activeTab !== 'vocab' ? contentMap[activeTab] : '';
  const currentLoading = activeTab !== 'vocab' ? loadingMap[activeTab] : false;
  const currentError = activeTab !== 'vocab' ? errorMap[activeTab] : '';

  return (
    <div className="ai-panel-wrapper">
      {/* ════════════════════════════════════════════
          VIEW MODE 1: TABLE OF CONTENTS LIST
          ════════════════════════════════════════════ */}
      {viewMode === 'toc' ? (
        <>
          {/* TOC Header */}
          <div className="ai-panel-header">
            <div className="ai-panel-header-title">
              <div className="ai-panel-badge">
                <Compass size={13} />
                <span>Document Navigator</span>
              </div>
              <h3 className="ai-panel-section-title">Table of Contents</h3>
              <div className="ai-panel-meta">
                <BookOpen size={12} />
                <span>{bookTitle}</span>
              </div>
            </div>
            <button className="ai-panel-close-btn" onClick={onClose} title="Close Panel">
              <X size={16} />
            </button>
          </div>

          {/* Quick Summarize Current Page Banner */}
          <div className="ai-toc-quick-banner">
            <div className="ai-quick-banner-content">
              <Sparkles size={15} className="ai-banner-icon" />
              <div className="ai-banner-text">
                <span className="ai-banner-title">Current Position: Page {currentPage}</span>
                <span className="ai-banner-sub">Summarize this page directly with AI</span>
              </div>
            </div>
            <button
              className="ai-banner-action-btn"
              onClick={() => {
                handleTOCItemSummarize({ title: `Page ${currentPage}`, target: currentPage });
              }}
            >
              <span>Summarize</span>
              <ChevronRight size={13} />
            </button>
          </div>

          {/* TOC Search Bar */}
          {outline.length > 0 && (
            <div className="ai-toc-search-container">
              <Search size={14} className="ai-toc-search-icon" />
              <input
                type="text"
                placeholder="Search chapters or sections..."
                value={tocSearch}
                onChange={(e) => setTocSearch(e.target.value)}
                className="ai-toc-search-input"
              />
              {tocSearch && (
                <button className="ai-toc-search-clear" onClick={() => setTocSearch('')}>
                  <X size={12} />
                </button>
              )}
            </div>
          )}

          {/* TOC Tree Body */}
          <div className="ai-panel-body ai-toc-body">
            {outline.length === 0 ? (
              <div className="ai-toc-empty-state">
                <div className="ai-empty-icon-box">
                  <List size={28} />
                </div>
                <h4>No Table of Contents</h4>
                <p>This document doesn't contain an embedded outline. You can summarize any page as you read.</p>
                <button
                  className="ai-empty-summarize-btn"
                  onClick={() => {
                    handleTOCItemSummarize({ title: `Page ${currentPage}`, target: currentPage });
                  }}
                >
                  <Sparkles size={14} />
                  <span>Summarize Page {currentPage}</span>
                </button>
              </div>

            ) : filteredOutline.length === 0 ? (
              <div className="ai-toc-empty-state">
                <Search size={24} />
                <p>No chapters match "{tocSearch}"</p>
                <button className="ai-toc-reset-btn" onClick={() => setTocSearch('')}>
                  Clear search
                </button>
              </div>
            ) : (
              <nav className="ai-toc-tree-list">
                {renderTOCNodes(filteredOutline)}
              </nav>
            )}
          </div>
        </>
      ) : (
        /* ════════════════════════════════════════════
            VIEW MODE 2: AI COMPANION INSIGHTS
            ════════════════════════════════════════════ */
        <>
          {/* Companion Header with Back Button */}
          <div className="ai-panel-header companion-header">
            <div className="ai-panel-header-nav">
              <button
                className="ai-panel-back-btn"
                onClick={() => setViewMode('toc')}
                title="Back to Table of Contents"
              >
                <ArrowLeft size={14} />
                <span>Contents</span>
              </button>
              <div className={`ai-panel-badge ${isChapter ? 'chapter-badge' : 'section-badge'}`}>
                <Sparkles size={12} />
                <span>{isChapter ? 'Chapter Roadmap' : 'Section Deep Dive'}</span>
              </div>
            </div>

            <div className="ai-panel-header-title">
              <h3 className="ai-panel-section-title" title={sectionTitle || `Page ${pageNumber || currentPage}`}>
                {sectionTitle || `Page ${pageNumber || currentPage}`}
              </h3>
              <div className="ai-panel-meta">
                <BookOpen size={12} />
                <span>{bookTitle}</span>
                {pageNumber && pageNumber > 0 ? (
                  <span className="ai-panel-page-badge">p. {pageNumber}</span>
                ) : null}
              </div>
            </div>

            <button className="ai-panel-close-btn" onClick={onClose} title="Close Panel">
              <X size={16} />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="ai-panel-tabs">
            <button
              className={`ai-panel-tab ${activeTab === 'summary' ? 'active' : ''}`}
              onClick={() => onTabChange('summary')}
            >
              <FileText size={14} />
              <span>Summary</span>
            </button>
            <button
              className={`ai-panel-tab ${activeTab === 'explain' ? 'active' : ''}`}
              onClick={() => onTabChange('explain')}
            >
              <Lightbulb size={14} />
              <span>Explain</span>
            </button>
            <button
              className={`ai-panel-tab ${activeTab === 'quiz' ? 'active' : ''}`}
              onClick={() => onTabChange('quiz')}
            >
              <HelpCircle size={14} />
              <span>Quiz</span>
            </button>
            <button
              className={`ai-panel-tab ${activeTab === 'vocab' ? 'active' : ''}`}
              onClick={() => onTabChange('vocab')}
            >
              <Bookmark size={14} />
              <span>Saved</span>
              {bookVocab?.length > 0 && (
                <span className="ai-panel-tab-count">{bookVocab.length}</span>
              )}
            </button>
          </div>

          {/* Panel Content Body */}
          <div
            ref={scrollContainerRef}
            className="ai-panel-body"
            onScroll={handleScroll}
          >
            {activeTab === 'vocab' ? (
              bookVocab.length === 0 ? (
                <div className="sidebar-empty">
                  <Bookmark size={28} />
                  <p>No saved words for this book yet. Highlight words to translate and save.</p>
                </div>
              ) : (
                <div className="sidebar-vocab-list">
                  {bookVocab.map(v => (
                    <div key={v.id} className="sidebar-vocab-card">
                      <div className="sidebar-vocab-card-header">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <p className="sidebar-vocab-original" style={{ margin: 0 }}>"{v.original_text}"</p>
                          <div className="sidebar-vocab-meta-row">
                            {v.part_of_speech && <span className="vocab-badge">{v.part_of_speech}</span>}
                            {v.ipa && <span className="sidebar-vocab-ipa">[{v.ipa}]</span>}
                          </div>
                        </div>
                        <button
                          className="sidebar-vocab-delete"
                          onClick={async () => {
                            await fetchWithAuth(`/api/v1/vocabularies/${v.id}`, { method: 'DELETE' });
                            onVocabularySaved();
                          }}
                          title="Remove word"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <p className="sidebar-vocab-translated">{v.translated_text}</p>
                      {v.context_sentence && (
                        <p className="sidebar-vocab-context-text" style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          {v.context_sentence}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="ai-panel-stream-content">
                {/* 1. Extracting state */}
                {isExtracting && (
                  <div className="ai-panel-initial-loading">
                    <Sparkles size={26} className="ai-star-pulse" />
                    <span>Extracting section text from document...</span>
                  </div>
                )}

                {/* 2. Thinking / Reasoning State */}
                {!isExtracting && currentLoading && !currentContent && (
                  <div className="ai-thinking-hud">
                    <div className="ai-thinking-header">
                      <div className="ai-thinking-brain-box">
                        <Brain size={22} className="ai-brain-pulse" />
                      </div>
                      <div className="ai-thinking-meta">
                        <div className="ai-thinking-title-row">
                          <span className="ai-thinking-title">AI is reasoning...</span>
                          <span className="ai-thinking-timer">{thinkingElapsed.toFixed(1)}s</span>
                        </div>
                        <span className="ai-thinking-phase">
                          {thinkingElapsed < 3.5
                            ? 'Analyzing chapter context & concepts...'
                            : thinkingElapsed < 8.0
                            ? 'Reasoning through system mechanics & trade-offs...'
                            : thinkingElapsed < 13.0
                            ? 'Structuring architectural explanation & synthesis...'
                            : 'Finalizing response generation...'}
                        </span>
                      </div>
                    </div>

                    <div className="ai-thinking-shimmer-bar">
                      <div className="ai-thinking-shimmer-progress" />
                    </div>

                    <button
                      type="button"
                      className="ai-panel-stop-pill-btn"
                      onClick={handleCancelStream}
                      title="Cancel generation"
                    >
                      <Square size={11} fill="currentColor" />
                      <span>Cancel</span>
                    </button>
                  </div>
                )}



                {/* 3. Empty text fallback (scanned or image PDF) */}
                {!isExtracting && !sectionContent && !currentLoading && (
                  <div className="ai-companion-info-card">
                    <Lightbulb size={20} />
                    <div className="ai-info-text">
                      <h5>Ready to Explore</h5>
                      <p>Select a section from the Table of Contents or summarize the current page.</p>
                      <button className="ai-info-btn" onClick={() => setViewMode('toc')}>
                        <Compass size={13} />
                        <span>Open Table of Contents</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* 4. Error state */}
                {currentError && (
                  <div className="ai-panel-error-card">
                    <AlertCircle size={18} />
                    <div className="ai-panel-error-text">
                      <p>{currentError}</p>
                      <button
                        className="ai-panel-retry-btn"
                        onClick={() => streamAction(activeTab)}
                      >
                        <RotateCcw size={12} />
                        <span>Retry</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* 5. Streamed / Parsed Interactive Content */}
                {currentContent ? (
                  activeTab === 'quiz' && parsedQuizQuestions.length > 0 ? (
                    <div className="ai-interactive-quiz-container">
                      <div className="ai-quiz-meta-bar">
                        <div className="ai-quiz-meta-info">
                          <HelpCircle size={15} style={{ color: 'var(--accent)' }} />
                          <span>{parsedQuizQuestions.length} Questions</span>
                          {Object.keys(userAnswers).length > 0 && (
                            <span className="ai-quiz-score-badge">
                              <Award size={12} />
                              <span>
                                {parsedQuizQuestions.filter(q => userAnswers[q.id] && userAnswers[q.id].toUpperCase() === q.correctAnswerLetter.toUpperCase()).length}/{parsedQuizQuestions.length} Correct
                              </span>
                            </span>
                          )}
                        </div>
                        {Object.keys(userAnswers).length > 0 && (
                          <button
                            type="button"
                            className="ai-quiz-reset-btn"
                            onClick={handleResetQuiz}
                            title="Reset quiz answers"
                          >
                            <RotateCcw size={12} />
                            <span>Reset</span>
                          </button>
                        )}
                      </div>

                      {parsedQuizQuestions.map(q => {
                        const selectedLetter = userAnswers[q.id];
                        const hasAnswered = !!selectedLetter;
                        const isCorrect = hasAnswered && selectedLetter.toUpperCase() === q.correctAnswerLetter.toUpperCase();

                        return (
                          <div key={q.id} className="ai-interactive-q-card">
                            <div className="ai-interactive-q-header">
                              <div className="ai-interactive-q-badge">
                                <HelpCircle size={14} />
                                <span>Question {q.number}</span>
                              </div>
                              {q.title && <span className="ai-interactive-q-topic">{q.title}</span>}
                            </div>

                            <div className="ai-interactive-q-body">
                              <p className="ai-interactive-q-text">{renderInline(q.question)}</p>
                            </div>

                            <div className="ai-interactive-options-list">
                              {q.options.map(opt => {
                                const isThisSelected = selectedLetter === opt.letter;
                                const isThisCorrect = q.correctAnswerLetter && opt.letter.toUpperCase() === q.correctAnswerLetter.toUpperCase();

                                let optClass = 'ai-interactive-option-btn';
                                if (hasAnswered) {
                                  if (isThisSelected) {
                                    optClass += isThisCorrect ? ' selected-correct' : ' selected-incorrect';
                                  } else if (isThisCorrect) {
                                    optClass += ' reveal-correct';
                                  }
                                }

                                return (
                                  <button
                                    key={opt.letter}
                                    type="button"
                                    className={optClass}
                                    onClick={() => handleSelectQuizOption(q.id, opt.letter)}
                                  >
                                    <div className="ai-option-letter-badge">{opt.letter}</div>
                                    <div className="ai-option-text">{renderInline(opt.text)}</div>
                                    <div className="ai-option-status-icon">
                                      {hasAnswered && isThisSelected && (
                                        isThisCorrect ? (
                                          <CheckCircle2 size={16} style={{ color: '#10b981' }} />
                                        ) : (
                                          <XCircle size={16} style={{ color: '#ef4444' }} />
                                        )
                                      )}
                                      {hasAnswered && !isThisSelected && isThisCorrect && (
                                        <Check size={16} style={{ color: '#10b981' }} />
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>

                            {/* Explanation Card */}
                            {(revealedExplanations[q.id] || hasAnswered) && (q.explanation || q.correctAnswerLetter) && (
                              <div className={`ai-interactive-expl-card ${hasAnswered ? (isCorrect ? 'correct' : 'incorrect') : 'correct'}`}>
                                <div className="ai-interactive-expl-header">
                                  <div className="ai-expl-badge">
                                    {hasAnswered ? (
                                      isCorrect ? (
                                        <>
                                          <CheckCircle2 size={15} />
                                          <span>Correct!</span>
                                        </>
                                      ) : (
                                        <>
                                          <XCircle size={15} />
                                          <span>Incorrect — Correct Answer: ({q.correctAnswerLetter})</span>
                                        </>
                                      )
                                    ) : (
                                      <>
                                        <Lightbulb size={15} />
                                        <span>Answer: ({q.correctAnswerLetter}) {q.correctAnswerText}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                {q.explanation && (
                                  <div className="ai-interactive-expl-body">
                                    <p>{renderInline(q.explanation)}</p>
                                  </div>
                                )}
                              </div>
                            )}

                            {!hasAnswered && !revealedExplanations[q.id] && q.correctAnswerLetter && (
                              <button
                                type="button"
                                className="ai-quiz-reveal-hint-btn"
                                onClick={() => toggleRevealExplanation(q.id)}
                              >
                                <Lightbulb size={13} />
                                <span>Reveal Answer & Explanation</span>
                              </button>
                            )}
                          </div>
                        );
                      })}

                      {currentLoading && (
                        <span className="ai-streaming-star" style={{ marginTop: '8px' }}>
                          <Sparkles size={14} className="ai-star-cursor" />
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="ai-panel-markdown">
                      {thoughtDurationMap[activeTab] !== undefined && thoughtDurationMap[activeTab] > 0 && (
                        <div className="ai-thought-badge">
                          <Brain size={13} className="ai-thought-badge-icon" />
                          <span>Thought for {thoughtDurationMap[activeTab]}s</span>
                        </div>
                      )}
                      {renderRichMarkdown(currentContent)}
                      {currentLoading && (
                        <span className="ai-streaming-star">
                          <Sparkles size={14} className="ai-star-cursor" />
                        </span>
                      )}
                    </div>
                  )

                ) : null}


              </div>
            )}
          </div>

          {/* Panel Footer */}
          {activeTab !== 'vocab' && (currentContent || currentLoading) && (
            <div className="ai-panel-footer">
              {currentLoading ? (
                <>
                  <div className="ai-footer-streaming-indicator">
                    <Sparkles size={13} className="ai-star-pulse" />
                    <span>Generating {activeTab}...</span>
                  </div>
                  <button
                    type="button"
                    className="ai-panel-stop-btn"
                    onClick={handleCancelStream}
                    title="Stop generating"
                  >
                    <Square size={11} fill="currentColor" />
                    <span>Stop Generating</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    className={`ai-panel-copy-btn ${copied ? 'copied' : ''}`}
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <>
                        <Check size={13} />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={13} />
                        <span>Copy {activeTab}</span>
                      </>
                    )}
                  </button>
                  <button
                    className="ai-panel-regen-btn"
                    onClick={() => streamAction(activeTab)}
                    disabled={currentLoading}
                    title="Regenerate"
                  >
                    <RotateCcw size={13} />
                    <span>Regenerate</span>
                  </button>
                </>
              )}
            </div>
          )}

        </>
      )}
    </div>
  );
};
