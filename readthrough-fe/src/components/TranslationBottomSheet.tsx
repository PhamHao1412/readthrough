import React, { useEffect, useState, useRef } from 'react';
import { Copy, Check, X, AlertTriangle, Volume2, Sparkles } from 'lucide-react';

interface TranslationBottomSheetProps {
  text: string;
  onClose: () => void;
  contextSentence?: string;
  bookTitle?: string;
  bookAuthor?: string;
  pageNumber?: number;
}

export const TranslationBottomSheet: React.FC<TranslationBottomSheetProps> = ({
  text,
  onClose,
  contextSentence,
  bookTitle,
  bookAuthor,
  pageNumber,
}) => {
  const [activeTab, setActiveTab] = useState<'translate' | 'explain'>('translate');
  const [translatedData, setTranslatedData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  const [explainState, setExplainState] = useState<'idle' | 'loading' | 'streaming' | 'done' | 'error'>('idle');
  const [explanation, setExplanation] = useState<string>('');
  const [explainError, setExplainError] = useState<string>('');
  const explainStartedRef = useRef<boolean>(false);

  // Translate API
  useEffect(() => {
    const translate = async () => {
      setLoading(true);
      setError('');
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = localStorage.getItem('readthrough_access_token');
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/v1/translate', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error('Translation failed.');
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

  // Explain API
  useEffect(() => {
    if (activeTab !== 'explain' || explainStartedRef.current) return;
    explainStartedRef.current = true;

    const explain = async () => {
      setExplainState('loading');
      setExplainError('');
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = localStorage.getItem('readthrough_access_token');
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/v1/explain', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            text,
            context_sentence: contextSentence || '',
            book_title: bookTitle || '',
            book_author: bookAuthor || '',
            page_number: pageNumber || 1,
          }),
        });

        if (!res.ok) throw new Error('AI Explain service unavailable.');
        if (!res.body) throw new Error('No response stream.');

        setExplainState('streaming');
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let accumulated = '';
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
              try {
                const parsed = JSON.parse(trimmed.slice(5).trim());
                if (parsed.content) {
                  accumulated += parsed.content;
                  setExplanation(accumulated.startsWith('[CACHED]') ? accumulated.slice(8) : accumulated);
                }
              } catch (e) {}
            }
          }
        }
        setExplainState('done');
      } catch (e: any) {
        setExplainError(e.message || 'Error executing AI explain.');
        setExplainState('error');
      }
    };
    explain();
  }, [activeTab, text, contextSentence, bookTitle, bookAuthor, pageNumber]);

  const handleCopy = (str: string) => {
    navigator.clipboard.writeText(str);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const playAudio = (audioUrl: string) => {
    if (!audioUrl) return;
    new Audio(audioUrl).play().catch(e => console.error('Audio play error:', e));
  };

  return (
    <div className="mobile-bottom-sheet-backdrop" onClick={onClose}>
      <div className="mobile-bottom-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mobile-sheet-drag-handle" />

        <div className="mobile-sheet-header">
          <div className="mobile-sheet-title">
            <Sparkles size={18} style={{ color: 'var(--accent)' }} />
            <span>AI Assistant</span>
          </div>
          <button className="mobile-sheet-close-btn" onClick={onClose}>
            <X size={18} />
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

        {/* Content */}
        <div className="tooltip-body" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
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
                            >
                              <Volume2 size={12} />
                            </button>
                          )}
                        </div>
                      )}
                      {translatedData.partsOfSpeech?.map((pos: any, idx: number) => (
                        <div key={idx} className="dict-pos-section">
                          <span className="dict-pos-badge">{pos.partOfSpeech}</span>
                          <ul className="dict-definition-list">
                            {pos.definitions?.map((def: any, dIdx: number) => (
                              <li key={dIdx} className="dict-definition-item">
                                • {def.definition}
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
              {explainState === 'loading' && (
                <div className="tooltip-loading">
                  <div className="spinner-sm" />
                  <span>Analyzing with AI...</span>
                </div>
              )}
              {explainState === 'error' && (
                <div className="tooltip-error">
                  <AlertTriangle size={16} />
                  <span>{explainError}</span>
                </div>
              )}
              {(explainState === 'streaming' || explainState === 'done') && (
                <div className="explain-container">
                  <p style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{explanation}</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="tooltip-footer">
          {activeTab === 'translate' && translatedData && (
            <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={() => handleCopy(translatedData.translatedText)}>
              {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
            </button>
          )}
          {activeTab === 'explain' && explanation && (
            <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={() => handleCopy(explanation)}>
              {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
