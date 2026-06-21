import React, { useEffect, useState, useRef } from 'react';
import { Copy, Check, X, AlertTriangle, Volume2 } from 'lucide-react';

interface TranslationTooltipProps {
  text: string;
  x: number;
  y: number;
  onClose: () => void;
  contextSentence?: string;
  bookTitle?: string;
  bookAuthor?: string;
  pageNumber?: number;
}

interface DefinitionInfo {
  definition: string;
  example?: string;
}

interface PartOfSpeechInfo {
  partOfSpeech: string;
  definitions: DefinitionInfo[];
}

interface AutoScrollContainerProps {
  content: string;
  renderMarkdown: (md: string) => React.ReactNode;
  isCached?: boolean;
}

const AutoScrollContainer: React.FC<AutoScrollContainerProps> = ({ content, renderMarkdown, isCached }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      if (isCached) {
        containerRef.current.scrollTop = 0;
      } else {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    }
  }, [content, isCached]);

  return (
    <div
      ref={containerRef}
      className="explain-container"
    >
      {content ? renderMarkdown(content) : "No explanation available."}
    </div>
  );
};

export const TranslationTooltip: React.FC<TranslationTooltipProps> = ({
  text,
  x,
  y,
  onClose,
  contextSentence,
  bookTitle,
  bookAuthor,
  pageNumber,
}) => {
  const [activeTab, setActiveTab] = useState<'translate' | 'explain'>('translate');
  
  // Translate Tab state
  const [translatedData, setTranslatedData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  
  // Explain Tab state
  const [explanation, setExplanation] = useState<string>('');
  const [explainLoading, setExplainLoading] = useState<boolean>(false);
  const [explainError, setExplainError] = useState<string>('');
  const [isCached, setIsCached] = useState<boolean>(false);

  const tooltipRef = useRef<HTMLDivElement>(null);

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

        const res = await fetch('/api/v1/translate', {
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

  // Fetch explanation when tab switches
  useEffect(() => {
    if (activeTab === 'explain' && !explanation && !explainLoading) {
      const explain = async () => {
        setExplainLoading(true);
        setExplainError('');
        try {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json'
          };
          const token = localStorage.getItem('readthrough_access_token');
          if (token) {
            headers['Authorization'] = `Bearer ${token}`;
          }

          const res = await fetch('/api/v1/explain', {
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

          setExplanation('');
          setIsCached(false);
          setExplainLoading(false);

          const reader = res.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let accumulatedText = '';
          let buffer = '';

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('data:')) {
                const dataStr = trimmed.slice(5).trim();
                try {
                  const parsed = JSON.parse(dataStr);
                  if (parsed.content) {
                    accumulatedText += parsed.content;
                    if (accumulatedText.startsWith('[CACHED]')) {
                      setIsCached(true);
                      setExplanation(accumulatedText.slice(8));
                    } else {
                      setExplanation(accumulatedText);
                    }
                  }
                } catch (e) {
                  console.warn('Failed to parse SSE JSON chunk:', e, dataStr);
                }
              }
            }
          }

          if (buffer.trim().startsWith('data:')) {
            const dataStr = buffer.trim().slice(5).trim();
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.content) {
                accumulatedText += parsed.content;
                if (accumulatedText.startsWith('[CACHED]')) {
                  setIsCached(true);
                  setExplanation(accumulatedText.slice(8));
                } else {
                  setExplanation(accumulatedText);
                }
              }
            } catch (e) {
              console.warn('Failed to parse SSE JSON chunk:', e, dataStr);
            }
          }
        } catch (e: any) {
          setExplainError(e.message || 'AI service error.');
        } finally {
          setExplainLoading(false);
        }
      };
      explain();
    }
  }, [activeTab, text, explanation, explainLoading]);

  // Click outside to close
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) onClose();
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handleOutside), 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleOutside);
    };
  }, [onClose]);

  const getPosition = (): React.CSSProperties => {
    const width = 340;
    const estHeight = activeTab === 'explain' ? 340 : 250;
    let left = x - width / 2;
    let top = y + 12;
    if (left < 10) left = 10;
    if (left + width > window.innerWidth - 10) left = window.innerWidth - width - 10;
    if (top + estHeight > window.innerHeight - 10) top = y - estHeight - 12;
    return { left: `${left}px`, top: `${top}px` };
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

  // Light weight Markdown parser
  const renderMarkdown = (md: string) => {
    if (!md) return null;
    const paragraphs = md.split(/\n\n+/);
    return paragraphs.map((p, pIdx) => {
      const trimmed = p.trim();
      if (!trimmed) return null;

      // Headers
      if (trimmed.startsWith('#')) {
        const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (match) {
          const level = match[1].length;
          const content = match[2];
          if (level === 1) return <h1 key={pIdx} className="md-h1">{renderInlineMarkdown(content)}</h1>;
          if (level === 2) return <h2 key={pIdx} className="md-h2">{renderInlineMarkdown(content)}</h2>;
          return <h3 key={pIdx} className="md-h3">{renderInlineMarkdown(content)}</h3>;
        }
      }

      // Bullet lists
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const lines = trimmed.split('\n')
          .map(l => l.trim())
          .filter(l => l.replace(/^[-*]\s*/, '').trim() !== '');
        if (lines.length === 0) return null;
        return (
          <ul key={pIdx} className="md-ul">
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
          <ol key={pIdx} className="md-ol">
            {lines.map((l, lIdx) => (
              <li key={lIdx}>{renderInlineMarkdown(l.replace(/^\d+\.\s+/, ''))}</li>
            ))}
          </ol>
        );
      }

      return <p key={pIdx} className="md-p">{renderInlineMarkdown(trimmed)}</p>;
    });
  };

  const renderInlineMarkdown = (inlineText: string) => {
    const parts = inlineText.split(/(\*\*.*?\*\*)/g);
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
      <div className="tooltip-header">
        <span className="tooltip-title">✦ Readthrough Assistant</span>
        <button className="tooltip-close" onClick={onClose}>
          <X size={14} />
        </button>
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
      <div className="tooltip-body">
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
            {explainLoading && (
              <div className="tooltip-loading">
                <div className="spinner-sm" />
                <span>Analyzing grammar with AI...</span>
              </div>
            )}

            {explainError && (
              <div className="tooltip-error">
                <AlertTriangle size={16} />
                <span>{explainError}</span>
              </div>
            )}

            {!explainLoading && !explainError && (
              <AutoScrollContainer
                content={explanation || ''}
                renderMarkdown={renderMarkdown}
                isCached={isCached}
              />
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
        {activeTab === 'explain' && !explainLoading && !explainError && explanation && (
          <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={() => handleCopy(explanation)}>
            {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
          </button>
        )}
      </div>
    </div>
  );
};
