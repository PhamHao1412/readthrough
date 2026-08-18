import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Copy, Check, X, AlertTriangle, Volume2, Star } from 'lucide-react';
import { formatUrl } from '../context/AuthContext';

interface TranslationTooltipProps {
  text: string;
  x: number;
  y: number;
  onClose: () => void;
  contextSentence?: string;
  bookId?: string;
  bookTitle?: string;
  bookAuthor?: string;
  pageNumber?: number;
  bookVocab?: any[];
  onVocabularySaved?: () => void;
}

interface DefinitionInfo {
  definition: string;
  example?: string;
}

interface PartOfSpeechInfo {
  partOfSpeech: string;
  definitions: DefinitionInfo[];
}

// Streaming states:
// 'idle'      → not started yet
// 'loading'   → waiting for first response (spinner shown)
// 'streaming' → SSE chunks arriving (plain text shown, no DOM churn)
// 'done'      → stream finished (markdown rendered once)
// 'error'     → failed
type ExplainState = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

export const TranslationTooltip: React.FC<TranslationTooltipProps> = ({
  text,
  x,
  y,
  onClose,
  contextSentence,
  bookId,
  bookTitle,
  bookAuthor,
  pageNumber,
  bookVocab,
  onVocabularySaved,
}) => {
  const [activeTab, setActiveTab] = useState<'translate' | 'explain'>('translate');

  // Translate Tab state
  const [translatedData, setTranslatedData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  // Saved Vocabulary state
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  // Sync savedId from bookVocab or reset when text changes
  useEffect(() => {
    if (bookVocab && text) {
      const match = bookVocab.find(
        v => v.original_text?.trim().toLowerCase() === text.trim().toLowerCase()
      );
      setSavedId(match ? match.id : null);
    } else {
      setSavedId(null);
    }
  }, [text, bookVocab]);

  // Explain Tab state — single state machine
  const [explainState, setExplainState] = useState<ExplainState>('idle');
  const [explanation, setExplanation] = useState<string>('');
  const [explainError, setExplainError] = useState<string>('');

  // Dragging state
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; initialX: number; initialY: number }>({
    mouseX: 0,
    mouseY: 0,
    initialX: 0,
    initialY: 0,
  });

  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipBodyRef = useRef<HTMLDivElement>(null);
  // Track whether user has scrolled up so we don't force-scroll them down
  const userScrolledUpRef = useRef<boolean>(false);
  // Guard ref: prevents double-fetching without putting explainState in dep array
  const explainStartedRef = useRef<boolean>(false);

  // Auto-scroll to bottom during streaming — directly set scrollTop, no layout reflow
  const scrollToBottom = useCallback(() => {
    const el = tooltipBodyRef.current;
    if (!el || userScrolledUpRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const handleBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const threshold = 40;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    userScrolledUpRef.current = !isNearBottom;
  };

  // Reset explain state when selected word changes
  useEffect(() => {
    explainStartedRef.current = false;
    setExplainState('idle');
    setExplanation('');
    setExplainError('');
  }, [text]);

  // Reset drag position when selection point changes
  useEffect(() => {
    setDragPos(null);
  }, [text, x, y]);

  // Window drag listeners
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      setDragPos({
        x: dragStartRef.current.initialX + dx,
        y: dragStartRef.current.initialY + dy,
      });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.tooltip-close')) return;
    e.preventDefault();
    isDraggingRef.current = true;

    const currentStyle = getPosition();
    const curX = parseFloat((currentStyle.left as string) || '0');
    const curY = parseFloat((currentStyle.top as string) || '0');

    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialX: curX,
      initialY: curY,
    };
  };

  // Fetch translation on text change
  useEffect(() => {
    const translate = async () => {
      setLoading(true);
      setError('');
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };
        const token = localStorage.getItem('readthrough_access_token');
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(formatUrl('/api/v1/translate'), {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error('Translation failed. Please try again.');
        const json = await res.json();
        if (json.succeeded && json.data) {
          setTranslatedData(json.data);
        } else {
          throw new Error(json.message || 'Translation not found.');
        }
      } catch (e: any) {
        setError(e.message || 'Server connection error.');
      } finally {
        setLoading(false);
      }
    };

    if (text.trim()) translate();
  }, [text]);

  // Fetch explanation when switching to explain tab (only once per word)
  useEffect(() => {
    if (activeTab !== 'explain' || explainStartedRef.current) return;
    explainStartedRef.current = true;

    let cancelled = false;

    const explain = async () => {
      setExplainState('loading');
      setExplainError('');
      setExplanation('');

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };
        const token = localStorage.getItem('readthrough_access_token');
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const res = await fetch(formatUrl('/api/v1/explain'), {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            text,
            context_sentence: contextSentence || '',
            book_title: bookTitle || '',
            book_author: bookAuthor || '',
            page_number: pageNumber || 1,
          }),
        });

        if (!res.ok) {
          let errMsg = 'Unable to get AI explanation. Please try again later.';
          if (res.status === 402) {
            errMsg = 'You have exceeded the trial limit for AI Explanation. Please upgrade your account or contact the administrator.';
          } else if (res.status === 429) {
            errMsg = 'Too many requests. Please wait a few minutes and try again.';
          } else {
            try {
              const errJson = await res.json();
              if (errJson.message) errMsg = errJson.message;
            } catch {}
          }
          throw new Error(errMsg);
        }

        if (!res.body) throw new Error('ReadableStream is not supported by your browser.');

        if (cancelled) return;

        // Switch to streaming mode — hide spinner, show plain text area
        setExplainState('streaming');
        userScrolledUpRef.current = false;

        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let accumulatedText = '';
        let buffer = '';
        let lastRenderTime = 0;
        // Throttled render: max once per 50ms to reduce React re-renders
        const THROTTLE_MS = 50;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (cancelled) {
            reader.cancel();
            return;
          }

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
                if (parsed.content) {
                  accumulatedText += parsed.content;
                  hasNewContent = true;
                }
              } catch (e) {
                // ignore malformed chunks
              }
            }
          }

          if (hasNewContent) {
            const now = Date.now();
            if (now - lastRenderTime >= THROTTLE_MS) {
              lastRenderTime = now;
              // Strip [CACHED] prefix but don't set isCached during stream — do it at end
              const displayText = accumulatedText.startsWith('[CACHED]')
                ? accumulatedText.slice(8)
                : accumulatedText;
              setExplanation(displayText);
              // Scroll after state update settles — use rAF to avoid layout thrashing
              requestAnimationFrame(() => scrollToBottom());
            }
          }
        }

        if (cancelled) return;

        // Stream done — flush final text and switch to markdown rendering
        const finalText = accumulatedText.startsWith('[CACHED]')
          ? accumulatedText.slice(8)
          : accumulatedText;

        setExplanation(finalText || '');
        setExplainState('done');

        // Scroll to top for cached results, stay at bottom for streamed
        requestAnimationFrame(() => {
          const el = tooltipBodyRef.current;
          if (!el) return;
          if (accumulatedText.startsWith('[CACHED]')) {
            el.scrollTop = 0;
          } else {
            scrollToBottom();
          }
        });

      } catch (e: any) {
        if (!cancelled) {
          setExplainError(e.message || 'AI service error.');
          setExplainState('error');
        }
      }
    };

    explain();
    return () => {
      cancelled = true;
    };
  }, [activeTab, text, contextSentence, bookTitle, bookAuthor, pageNumber, scrollToBottom]);

  const handleClose = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    window.dispatchEvent(new CustomEvent('readthrough-clear-selection'));
    onClose();
  }, [onClose]);

  const handleToggleSave = async () => {
    if (!translatedData || !bookId || saving) return;
    setSaving(true);
    try {
      const token = localStorage.getItem('readthrough_access_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      if (savedId) {
        // Delete from notebook
        const res = await fetch(formatUrl(`/api/v1/vocabularies/${savedId}`), {
          method: 'DELETE',
          headers,
        });
        if (res.ok) {
          setSavedId(null);
          onVocabularySaved?.();
        } else {
          alert('Failed to remove vocabulary.');
        }
      } else {
        // Save to notebook
        const res = await fetch(formatUrl('/api/v1/vocabularies'), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            book_id: bookId,
            original_text: text.trim(),
            translated_text: translatedData.translatedText,
            ipa: translatedData.phonetic || '',
            part_of_speech: translatedData.partsOfSpeech?.[0]?.partOfSpeech || '',
            context_sentence: contextSentence || '',
            audio_url: translatedData.audioUrl || '',
          }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.succeeded && json.data?.id) {
            setSavedId(json.data.id);
            onVocabularySaved?.();
          } else {
            throw new Error(json.message);
          }
        } else {
          throw new Error('Failed to save vocabulary');
        }
      }
    } catch (err) {
      console.error(err);
      alert('Failed to update vocabulary.');
    } finally {
      setSaving(false);
    }
  };

  // Click outside to close
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handleOutside), 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleOutside);
    };
  }, [handleClose]);

  const getPosition = (): React.CSSProperties => {
    const width = Math.min(400, window.innerWidth - 32);

    // GAP = breathing room between word edge and popup edge
    const GAP = 10;
    const WORD_HEIGHT = 28;

    // y prop = bottom of selected word (rect.bottom from click event)
    const wordBottom = y;
    const wordTop = y - WORD_HEIGHT;

    const minLeft = 16;
    const maxLeft = Math.max(minLeft, window.innerWidth - width - 16);
    const minTop = 64;  // stay below navbar

    let finalLeft: number;
    let finalTop: number;
    let finalMaxHeight: number;

    if (dragPos) {
      finalLeft = Math.max(minLeft, Math.min(dragPos.x, maxLeft));
      finalTop = Math.max(minTop, Math.min(dragPos.y, window.innerHeight - 200 - 8));
      finalMaxHeight = Math.min(500, window.innerHeight - finalTop - 8);
    } else {
      const calcLeft = x - width / 2;
      finalLeft = Math.max(minLeft, Math.min(calcLeft, maxLeft));

      // Space available above the word (between navbar bottom and word top)
      const spaceAbove = wordTop - GAP - minTop;
      // Space available below the word (between word bottom and viewport bottom)
      const spaceBelow = window.innerHeight - wordBottom - GAP - 8;

      // Minimum usable height for the popup (header + tabs + some content)
      const MIN_USEFUL_HEIGHT = 220;
      const MAX_HEIGHT = 500;

      if (spaceAbove >= MIN_USEFUL_HEIGHT) {
        // Preferred: place ABOVE the word — popup bottom = wordTop - GAP
        finalMaxHeight = Math.min(MAX_HEIGHT, spaceAbove);
        finalTop = wordTop - GAP - finalMaxHeight;
        // clamp so we don't go above navbar
        if (finalTop < minTop) {
          finalTop = minTop;
          finalMaxHeight = wordTop - GAP - minTop;
        }
      } else if (spaceBelow >= MIN_USEFUL_HEIGHT) {
        // Fallback: place BELOW the word
        finalTop = wordBottom + GAP;
        finalMaxHeight = Math.min(MAX_HEIGHT, spaceBelow);
      } else {
        // Neither side has enough room — pick the side with more space
        if (spaceAbove >= spaceBelow) {
          finalMaxHeight = Math.max(spaceAbove, MIN_USEFUL_HEIGHT);
          finalTop = Math.max(minTop, wordTop - GAP - finalMaxHeight);
        } else {
          finalTop = wordBottom + GAP;
          finalMaxHeight = Math.max(spaceBelow, MIN_USEFUL_HEIGHT);
        }
      }
    }

    return {
      position: 'fixed',
      left: `${finalLeft}px`,
      top: `${finalTop}px`,
      width: `${width}px`,
      maxHeight: `${finalMaxHeight}px`,
      zIndex: 2000,
    };
  };

  const handleCopy = (txtToCopy: string) => {
    navigator.clipboard.writeText(txtToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const playAudio = (audioUrl: string) => {
    if (!audioUrl) return;
    const audio = new Audio(audioUrl);
    audio.play().catch(e => console.error('Audio play error:', e));
  };

  /**
   * Render a single markdown block with a given key.
   * The key is kept external so callers can assign a fixed key to the in-progress block.
   */
  const renderBlock = (blockKey: string, trimmed: string, isInProgress = false) => {
    const cls = isInProgress ? ' explain-inprogress' : '';

    // Headers
    if (trimmed.startsWith('#')) {
      const match = trimmed.match(/^(#{1,6})\s+([\s\S]*)$/);
      if (match) {
        const level = match[1].length;
        const content = match[2];
        if (level === 1) return <h1 key={blockKey} className={`md-h1${cls}`}>{renderInlineMarkdown(content)}</h1>;
        if (level === 2) return <h2 key={blockKey} className={`md-h2${cls}`}>{renderInlineMarkdown(content)}</h2>;
        return <h3 key={blockKey} className={`md-h3${cls}`}>{renderInlineMarkdown(content)}</h3>;
      }
    }

    // Bullet lists
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const lines = trimmed.split('\n')
        .map(l => l.trim())
        .filter(l => l.replace(/^[-*]\s*/, '').trim() !== '');
      if (lines.length === 0) return null;
      return (
        <ul key={blockKey} className={`md-ul${cls}`}>
          {lines.map((l, lIdx) => (
            <li key={lIdx}>{renderInlineMarkdown(l.replace(/^[-*]\s+/, ''))}</li>
          ))}
        </ul>
      );
    }

    // Numbered lists
    if (/^\d+\.\s+/.test(trimmed)) {
      const lines = trimmed.split('\n')
        .map(l => l.trim())
        .filter(l => l.replace(/^\d+\.\s*/, '').trim() !== '');
      if (lines.length === 0) return null;
      return (
        <ol key={blockKey} className={`md-ol${cls}`}>
          {lines.map((l, lIdx) => (
            <li key={lIdx}>{renderInlineMarkdown(l.replace(/^\d+\.\s+/, ''))}</li>
          ))}
        </ol>
      );
    }

    return <p key={blockKey} className={`md-p${cls}`}>{renderInlineMarkdown(trimmed)}</p>;
  };

  /**
   * Render completed markdown blocks.
   * Keys are content-based so they stay stable when new blocks are appended at the bottom.
   */
  const renderMarkdown = (md: string) => {
    if (!md) return null;
    return md.split(/\n\n+/).map((p) => {
      const trimmed = p.trim();
      if (!trimmed) return null;
      const blockKey = `md-blk-${trimmed.slice(0, 24).replace(/\s+/g, '-')}`;
      return renderBlock(blockKey, trimmed);
    });
  };

  /**
   * Render during streaming:
   * - Completed blocks (before last \n\n) → stable content-based keys → no DOM remount
   * - Last in-progress block → fixed key 'inprogress' → React reuses same node,
   *   updates content in-place → real-time markdown formatting without jitter
   */
  const renderStreamingContent = (text: string) => {
    if (!text) return null;

    const lastDoubleNL = text.lastIndexOf('\n\n');

    if (lastDoubleNL === -1) {
      // Nothing completed yet — render entire text as in-progress block
      const trimmed = text.trim();
      return trimmed ? renderBlock('inprogress', trimmed, true) : null;
    }

    const completedText = text.slice(0, lastDoubleNL);
    const inProgressText = text.slice(lastDoubleNL + 2).trim();

    return (
      <>
        {renderMarkdown(completedText)}
        {inProgressText && renderBlock('inprogress', inProgressText, true)}
      </>
    );
  };

  const renderInlineMarkdown = (inlineText: string) => {
    let textToParse = inlineText;
    const boldMatches = textToParse.match(/\*\*/g);
    if (boldMatches && boldMatches.length % 2 !== 0) {
      textToParse += '**';
    }

    const parts = textToParse.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={idx}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };




  return (
    <div ref={tooltipRef} className="translation-tooltip" style={getPosition()}>
      {/* Header */}
      <div className="tooltip-header" onMouseDown={handleHeaderMouseDown}>
        <span className="tooltip-title">✦ Readthrough Assistant</span>
        <div className="tooltip-header-actions">
          {bookId && translatedData && !loading && !error && activeTab === 'translate' && (
            <button
              className={`tooltip-save-btn ${savedId ? 'saved' : ''} ${saving ? 'saving' : ''}`}
              onClick={handleToggleSave}
              disabled={saving}
              title={savedId ? "Remove from vocabulary notebook" : "Save to vocabulary notebook"}
            >
              <Star size={15} fill={savedId ? "currentColor" : "none"} />
            </button>
          )}
          <button className="tooltip-close" onClick={handleClose} title="Close">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tooltip-tabs">
        <button
          className={`tooltip-tab ${activeTab === 'translate' ? 'active' : ''}`}
          onClick={() => setActiveTab('translate')}
        >
          Translate
        </button>
        <button
          className={`tooltip-tab ${activeTab === 'explain' ? 'active' : ''}`}
          onClick={() => setActiveTab('explain')}
        >
          AI Explain
        </button>
      </div>

      {/* Body */}
      <div ref={tooltipBodyRef} className="tooltip-body" onScroll={handleBodyScroll}>
        {activeTab === 'translate' ? (
          <>
            {loading && (
              <div className="tooltip-loading">
                <div className="spinner-sm" />
                <span>Translating...</span>
              </div>
            )}

            {error && (
              <div className="tooltip-error">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}

            {!loading && !error && translatedData && (
              <div className="dict-word-container">
                <p className="tooltip-original">"{text}"</p>
                <p className="tooltip-translated">{translatedData.translatedText}</p>

                {/* Dictionary Details */}
                {translatedData.isWord && (
                  <>
                    {(translatedData.phonetic || translatedData.audioUrl) && (
                      <div className="dict-phonetic-row">
                        {translatedData.phonetic && (
                          <span className="dict-phonetic-text">{translatedData.phonetic}</span>
                        )}
                        {translatedData.audioUrl && (
                          <button
                            className="dict-audio-btn"
                            onClick={() => playAudio(translatedData.audioUrl)}
                            title="Listen pronunciation"
                          >
                            <Volume2 size={12} />
                          </button>
                        )}
                      </div>
                    )}

                    {translatedData.partsOfSpeech && translatedData.partsOfSpeech.map((pos: PartOfSpeechInfo, posIdx: number) => (
                      <div key={posIdx} className="dict-pos-section">
                        <span className="dict-pos-badge">{pos.partOfSpeech}</span>
                        <ul className="dict-definition-list">
                          {pos.definitions && pos.definitions.map((def, defIdx) => (
                            <li key={defIdx} className="dict-definition-item">
                              • {def.definition}
                              {def.example && (
                                <span className="dict-example">Example: "{def.example}"</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {/* State: loading — waiting for first byte */}
            {explainState === 'loading' && (
              <div className="tooltip-loading">
                <div className="spinner-sm" />
                <span>Analyzing with AI...</span>
              </div>
            )}

            {/* State: error */}
            {explainState === 'error' && (
              <div className="tooltip-error">
                <AlertTriangle size={16} />
                <span>{explainError}</span>
              </div>
            )}

            {/* State: streaming — completed blocks as markdown + in-progress as plain text */}
            {explainState === 'streaming' && (
              <div className="explain-container">
                {renderStreamingContent(explanation)}
              </div>
            )}

            {/* State: done — render markdown once */}
            {explainState === 'done' && (
              <div className="explain-container">
                {explanation ? renderMarkdown(explanation) : 'No explanation available.'}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="tooltip-footer">
        {activeTab === 'translate' && !loading && !error && translatedData && (
          <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={() => handleCopy(translatedData.translatedText)}>
            {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
          </button>
        )}
        {activeTab === 'explain' && (explainState === 'streaming' || explainState === 'done') && explanation && (
          <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={() => handleCopy(explanation)}>
            {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
          </button>
        )}
      </div>
    </div>
  );
};
