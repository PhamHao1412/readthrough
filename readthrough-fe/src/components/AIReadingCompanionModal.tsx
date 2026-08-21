import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Sparkles,
  BookOpen,
  CheckCircle2,
  XCircle,
  HelpCircle,
  RotateCcw,
  Loader2,
  FileText,
  Lightbulb,
  ArrowRight,
  AlertCircle,
  Layers
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export interface SectionSummaryData {
  tldr: string;
  key_ideas: string[];
  main_takeaway: string;
}

export interface SectionExplainData {
  overview: string;
  why_it_exists: string;
  technical_reasoning: string;
  backend_applications: string;
  tradeoffs: string;
  markdown_content: string;
}

export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface SectionQuizData {
  questions: QuizQuestion[];
}

export interface ReadingCompanionResponse {
  action: 'summary' | 'explain' | 'quiz';
  section_title: string;
  summary?: SectionSummaryData;
  explain?: SectionExplainData;
  quiz?: SectionQuizData;
  is_cached?: boolean;
}

export interface AIReadingCompanionModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookId: string;
  bookTitle: string;
  bookAuthor?: string;
  sectionTitle: string;
  pageNumber?: number;
  sectionContent: string;
  initialTab?: 'summary' | 'explain' | 'quiz';
}

// Markdown renderer for rich explanation
const renderCompanionMarkdown = (md: string) => {
  if (!md) return null;
  const paragraphs = md.split(/\n\n+/);
  return paragraphs.map((p, pIdx) => {
    const trimmed = p.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('#')) {
      const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const content = match[2];
        if (level === 1) return <h2 key={pIdx} className="ai-md-h1">{renderInline(content)}</h2>;
        if (level === 2) return <h3 key={pIdx} className="ai-md-h2">{renderInline(content)}</h3>;
        return <h4 key={pIdx} className="ai-md-h3">{renderInline(content)}</h4>;
      }
    }

    if (trimmed.startsWith('```')) {
      const lines = trimmed.split('\n');
      const code = lines.slice(1, lines.length - 1).join('\n');
      return (
        <pre key={pIdx} className="ai-md-code-block">
          <code>{code || trimmed.replace(/```[a-z]*/g, '')}</code>
        </pre>
      );
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const lines = trimmed
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.replace(/^[-*]\s*/, '').trim() !== '');
      if (lines.length === 0) return null;
      return (
        <ul key={pIdx} className="ai-md-ul">
          {lines.map((l, lIdx) => (
            <li key={lIdx}>{renderInline(l.replace(/^[-*]\s+/, ''))}</li>
          ))}
        </ul>
      );
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const lines = trimmed
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.replace(/^\d+\.\s*/, '').trim() !== '');
      if (lines.length === 0) return null;
      return (
        <ol key={pIdx} className="ai-md-ol">
          {lines.map((l, lIdx) => (
            <li key={lIdx}>{renderInline(l.replace(/^\d+\.\s+/, ''))}</li>
          ))}
        </ol>
      );
    }

    return (
      <p key={pIdx} className="ai-md-p">
        {renderInline(trimmed)}
      </p>
    );
  });
};

const renderInline = (text: string) => {
  let toParse = text;
  const boldMatches = toParse.match(/\*\*/g);
  if (boldMatches && boldMatches.length % 2 !== 0) {
    toParse += '**';
  }

  const parts = toParse.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={idx} className="ai-md-inline-code">{part.slice(1, -1)}</code>;
    }
    return part;
  });
};

export const AIReadingCompanionModal: React.FC<AIReadingCompanionModalProps> = ({
  isOpen,
  onClose,
  bookId,
  bookTitle,
  bookAuthor,
  sectionTitle,
  pageNumber,
  sectionContent,
  initialTab = 'summary',
}) => {
  const { fetchWithAuth } = useAuth();
  const [activeTab, setActiveTab] = useState<'summary' | 'explain' | 'quiz'>(initialTab);

  // Per-action state
  const [summaryData, setSummaryData] = useState<SectionSummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState<boolean>(false);
  const [summaryError, setSummaryError] = useState<string>('');

  const [explainData, setExplainData] = useState<SectionExplainData | null>(null);
  const [explainLoading, setExplainLoading] = useState<boolean>(false);
  const [explainError, setExplainError] = useState<string>('');

  const [quizData, setQuizData] = useState<SectionQuizData | null>(null);
  const [quizLoading, setQuizLoading] = useState<boolean>(false);
  const [quizError, setQuizError] = useState<string>('');

  // Quiz user interaction state: question index -> selected option index
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});

  // Reset or initialize state when section or book changes
  const prevSectionKeyRef = useRef<string>('');
  const currentSectionKey = `${bookId}:${sectionTitle}`;

  useEffect(() => {
    if (prevSectionKeyRef.current !== currentSectionKey) {
      prevSectionKeyRef.current = currentSectionKey;
      setSummaryData(null);
      setSummaryLoading(false);
      setSummaryError('');
      setExplainData(null);
      setExplainLoading(false);
      setExplainError('');
      setQuizData(null);
      setQuizLoading(false);
      setQuizError('');
      setSelectedAnswers({});
      setActiveTab(initialTab);
    }
  }, [currentSectionKey, initialTab]);

  // Keyboard shortcut: Escape -> Close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Action dispatcher
  const fetchAction = useCallback(async (action: 'summary' | 'explain' | 'quiz') => {
    if (!sectionContent || !sectionContent.trim()) {
      const errMsg = 'No extracted text found for this section. Please ensure the document is loaded.';
      if (action === 'summary') setSummaryError(errMsg);
      if (action === 'explain') setExplainError(errMsg);
      if (action === 'quiz') setQuizError(errMsg);
      return;
    }

    if (action === 'summary') {
      if (summaryLoading || summaryData) return;
      setSummaryLoading(true);
      setSummaryError('');
    } else if (action === 'explain') {
      if (explainLoading || explainData) return;
      setExplainLoading(true);
      setExplainError('');
    } else if (action === 'quiz') {
      if (quizLoading || quizData) return;
      setQuizLoading(true);
      setQuizError('');
    }

    try {
      const payload = {
        book_id: bookId,
        section_title: sectionTitle || 'Current Section',
        content: sectionContent,
        action,
        book_title: bookTitle,
        book_author: bookAuthor || 'Author',
        page_number: pageNumber || 1,
      };

      const res = await fetchWithAuth('/api/v1/ai/companion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let errMessage = 'AI Companion service temporarily unavailable.';
        try {
          const errJson = await res.json();
          if (errJson.message) errMessage = errJson.message;
        } catch {
          // ignore
        }
        throw new Error(errMessage);
      }

      const json = await res.json();
      const data: ReadingCompanionResponse = json.data;

      if (action === 'summary' && data.summary) {
        setSummaryData(data.summary);
      } else if (action === 'explain' && data.explain) {
        setExplainData(data.explain);
      } else if (action === 'quiz' && data.quiz) {
        setQuizData(data.quiz);
        setSelectedAnswers({});
      }
    } catch (err: any) {
      const msg = err.message || 'Failed to complete AI action';
      if (action === 'summary') setSummaryError(msg);
      if (action === 'explain') setExplainError(msg);
      if (action === 'quiz') setQuizError(msg);
    } finally {
      if (action === 'summary') setSummaryLoading(false);
      if (action === 'explain') setExplainLoading(false);
      if (action === 'quiz') setQuizLoading(false);
    }
  }, [bookId, sectionTitle, sectionContent, bookTitle, bookAuthor, pageNumber, fetchWithAuth, summaryLoading, summaryData, explainLoading, explainData, quizLoading, quizData]);

  // Auto-fetch on opening tab if not already loaded and not loading
  useEffect(() => {
    if (!isOpen) return;
    if (activeTab === 'summary' && !summaryData && !summaryLoading && !summaryError) {
      fetchAction('summary');
    } else if (activeTab === 'explain' && !explainData && !explainLoading && !explainError) {
      fetchAction('explain');
    } else if (activeTab === 'quiz' && !quizData && !quizLoading && !quizError) {
      fetchAction('quiz');
    }
  }, [isOpen, activeTab, summaryData, summaryLoading, summaryError, explainData, explainLoading, explainError, quizData, quizLoading, quizError, fetchAction]);

  if (!isOpen) return null;

  // Answer selection handler for quiz
  const handleSelectOption = (qIdx: number, optionIdx: number) => {
    // Only allow answering once per question
    if (selectedAnswers[qIdx] !== undefined) return;
    setSelectedAnswers(prev => ({
      ...prev,
      [qIdx]: optionIdx,
    }));
  };

  const handleRetakeQuiz = () => {
    setSelectedAnswers({});
  };

  // Compute quiz score
  const totalQuestions = quizData?.questions?.length || 0;
  const answeredCount = Object.keys(selectedAnswers).length;
  const correctCount = quizData?.questions
    ? quizData.questions.reduce((acc, q, idx) => {
        return selectedAnswers[idx] === q.correct_index ? acc + 1 : acc;
      }, 0)
    : 0;

  return (
    <div className="ai-companion-overlay" onClick={onClose}>
      <div className="ai-companion-modal" onClick={e => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="ai-companion-header">
          <div className="ai-companion-header-left">
            <div className="ai-companion-badge">
              <Sparkles size={14} />
              <span>AI Reading Companion</span>
            </div>
            <div className="ai-companion-section-info">
              <h2 className="ai-companion-title" title={sectionTitle || 'Section'}>
                {sectionTitle || 'Current Section'}
              </h2>
              <div className="ai-companion-meta">
                <BookOpen size={13} />
                <span>{bookTitle}</span>
                {pageNumber && pageNumber > 0 ? (
                  <span className="ai-companion-page-pill">Page {pageNumber}</span>
                ) : null}
              </div>
            </div>
          </div>
          <button className="ai-companion-close-btn" onClick={onClose} title="Close (Esc)">
            <X size={18} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="ai-companion-nav">
          <button
            className={`ai-companion-tab ${activeTab === 'summary' ? 'active' : ''}`}
            onClick={() => setActiveTab('summary')}
          >
            <FileText size={15} />
            <span>Summary</span>
          </button>
          <button
            className={`ai-companion-tab ${activeTab === 'explain' ? 'active' : ''}`}
            onClick={() => setActiveTab('explain')}
          >
            <Lightbulb size={15} />
            <span>Explain in Detail</span>
          </button>
          <button
            className={`ai-companion-tab ${activeTab === 'quiz' ? 'active' : ''}`}
            onClick={() => setActiveTab('quiz')}
          >
            <HelpCircle size={15} />
            <span>Quiz Me</span>
            {quizData && (
              <span className="ai-companion-tab-badge">
                {answeredCount}/{totalQuestions}
              </span>
            )}
          </button>
        </div>

        {/* Content Body */}
        <div className="ai-companion-body">
          {/* ═════════════════ TAB 1: SUMMARY ═════════════════ */}
          {activeTab === 'summary' && (
            <div className="ai-companion-tab-content">
              {summaryLoading && (
                <div className="ai-companion-loading-state">
                  <Loader2 size={32} className="ai-spinner" />
                  <p className="ai-loading-title">Synthesizing Section Summary...</p>
                  <span className="ai-loading-sub">
                    Extracting key ideas, TL;DR, and core architectural takeaways from source text.
                  </span>
                </div>
              )}

              {summaryError && !summaryLoading && (
                <div className="ai-companion-error-card">
                  <AlertCircle size={24} className="ai-error-icon" />
                  <div className="ai-error-content">
                    <h4>Failed to generate summary</h4>
                    <p>{summaryError}</p>
                    <button
                      className="ai-retry-btn"
                      onClick={() => fetchAction('summary')}
                    >
                      <RotateCcw size={14} />
                      <span>Retry</span>
                    </button>
                  </div>
                </div>
              )}

              {summaryData && !summaryLoading && (
                <div className="ai-summary-view">
                  {/* TL;DR Box */}
                  <div className="ai-tldr-card">
                    <div className="ai-card-tag">
                      <Sparkles size={13} />
                      <span>TL;DR</span>
                    </div>
                    <p className="ai-tldr-text">{summaryData.tldr}</p>
                  </div>

                  {/* Key Ideas List */}
                  <div className="ai-key-ideas-section">
                    <h3 className="ai-section-label">
                      <Layers size={16} />
                      <span>Key Ideas ({summaryData.key_ideas?.length || 0})</span>
                    </h3>
                    <div className="ai-key-ideas-list">
                      {summaryData.key_ideas?.map((idea, idx) => (
                        <div key={idx} className="ai-key-idea-item">
                          <div className="ai-idea-num">{idx + 1}</div>
                          <div className="ai-idea-text">{renderInline(idea)}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Main Takeaway */}
                  <div className="ai-takeaway-card">
                    <div className="ai-card-tag takeaway">
                      <Lightbulb size={13} />
                      <span>Main Takeaway to Remember</span>
                    </div>
                    <p className="ai-takeaway-text">{renderInline(summaryData.main_takeaway)}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═════════════════ TAB 2: EXPLAIN IN DETAIL ═════════════════ */}
          {activeTab === 'explain' && (
            <div className="ai-companion-tab-content">
              {explainLoading && (
                <div className="ai-companion-loading-state">
                  <Loader2 size={32} className="ai-spinner" />
                  <p className="ai-loading-title">Analyzing Technical Architecture...</p>
                  <span className="ai-loading-sub">
                    Deconstructing concepts, invariants, trade-offs, and real-world backend applications.
                  </span>
                </div>
              )}

              {explainError && !explainLoading && (
                <div className="ai-companion-error-card">
                  <AlertCircle size={24} className="ai-error-icon" />
                  <div className="ai-error-content">
                    <h4>Failed to explain section</h4>
                    <p>{explainError}</p>
                    <button
                      className="ai-retry-btn"
                      onClick={() => fetchAction('explain')}
                    >
                      <RotateCcw size={14} />
                      <span>Retry</span>
                    </button>
                  </div>
                </div>
              )}

              {explainData && !explainLoading && (
                <div className="ai-explain-view">
                  {explainData.markdown_content ? (
                    <div className="ai-explain-markdown">
                      {renderCompanionMarkdown(explainData.markdown_content)}
                    </div>
                  ) : (
                    <div className="ai-explain-fallback">
                      {explainData.overview && (
                        <div className="ai-explain-block">
                          <h3 className="ai-block-title">Overview</h3>
                          <p>{renderInline(explainData.overview)}</p>
                        </div>
                      )}
                      {explainData.why_it_exists && (
                        <div className="ai-explain-block">
                          <h3 className="ai-block-title">Why It Exists</h3>
                          <p>{renderInline(explainData.why_it_exists)}</p>
                        </div>
                      )}
                      {explainData.technical_reasoning && (
                        <div className="ai-explain-block">
                          <h3 className="ai-block-title">Technical Reasoning & Mechanics</h3>
                          <p>{renderInline(explainData.technical_reasoning)}</p>
                        </div>
                      )}
                      {explainData.backend_applications && (
                        <div className="ai-explain-block">
                          <h3 className="ai-block-title">Real-World Backend Applications</h3>
                          <p>{renderInline(explainData.backend_applications)}</p>
                        </div>
                      )}
                      {explainData.tradeoffs && (
                        <div className="ai-explain-block">
                          <h3 className="ai-block-title">Trade-offs & Failure Modes</h3>
                          <p>{renderInline(explainData.tradeoffs)}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ═════════════════ TAB 3: QUIZ ME ═════════════════ */}
          {activeTab === 'quiz' && (
            <div className="ai-companion-tab-content">
              {quizLoading && (
                <div className="ai-companion-loading-state">
                  <Loader2 size={32} className="ai-spinner" />
                  <p className="ai-loading-title">Crafting Conceptual Quiz...</p>
                  <span className="ai-loading-sub">
                    Designing scenario questions to test conceptual understanding, invariants, and trade-offs.
                  </span>
                </div>
              )}

              {quizError && !quizLoading && (
                <div className="ai-companion-error-card">
                  <AlertCircle size={24} className="ai-error-icon" />
                  <div className="ai-error-content">
                    <h4>Failed to generate quiz</h4>
                    <p>{quizError}</p>
                    <button
                      className="ai-retry-btn"
                      onClick={() => fetchAction('quiz')}
                    >
                      <RotateCcw size={14} />
                      <span>Retry</span>
                    </button>
                  </div>
                </div>
              )}

              {quizData && !quizLoading && (
                <div className="ai-quiz-view">
                  {/* Quiz Top Status Bar */}
                  <div className="ai-quiz-status-bar">
                    <div className="ai-quiz-progress-text">
                      Answered <strong>{answeredCount}</strong> of <strong>{totalQuestions}</strong> questions
                    </div>
                    {answeredCount === totalQuestions && (
                      <div className="ai-quiz-score-badge">
                        <span>Score: <strong>{correctCount} / {totalQuestions}</strong></span>
                        {correctCount === totalQuestions ? ' 🎉 Excellent!' : ' 👍 Good effort!'}
                      </div>
                    )}
                    {answeredCount > 0 && (
                      <button className="ai-quiz-retake-btn" onClick={handleRetakeQuiz}>
                        <RotateCcw size={13} />
                        <span>Retake Quiz</span>
                      </button>
                    )}
                  </div>

                  {/* Question Cards */}
                  <div className="ai-quiz-questions-list">
                    {quizData.questions.map((q, qIdx) => {
                      const hasAnswered = selectedAnswers[qIdx] !== undefined;
                      const selectedIdx = selectedAnswers[qIdx];
                      const isCorrect = selectedIdx === q.correct_index;

                      return (
                        <div key={q.id || qIdx} className={`ai-quiz-card ${hasAnswered ? (isCorrect ? 'is-correct' : 'is-wrong') : ''}`}>
                          <div className="ai-quiz-card-header">
                            <span className="ai-quiz-q-num">Question {qIdx + 1}</span>
                            {hasAnswered && (
                              <div className={`ai-quiz-result-pill ${isCorrect ? 'correct' : 'wrong'}`}>
                                {isCorrect ? (
                                  <>
                                    <CheckCircle2 size={13} />
                                    <span>Correct</span>
                                  </>
                                ) : (
                                  <>
                                    <XCircle size={13} />
                                    <span>Incorrect</span>
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                          <h4 className="ai-quiz-question-text">{q.question}</h4>

                          <div className="ai-quiz-options">
                            {q.options.map((opt, optIdx) => {
                              const isSelected = selectedIdx === optIdx;
                              const isThisOptionCorrect = optIdx === q.correct_index;

                              let optStateClass = '';
                              if (hasAnswered) {
                                if (isThisOptionCorrect) {
                                  optStateClass = 'correct-opt';
                                } else if (isSelected && !isThisOptionCorrect) {
                                  optStateClass = 'wrong-opt';
                                } else {
                                  optStateClass = 'disabled-opt';
                                }
                              }

                              return (
                                <button
                                  key={optIdx}
                                  className={`ai-quiz-opt-btn ${isSelected ? 'selected' : ''} ${optStateClass}`}
                                  onClick={() => handleSelectOption(qIdx, optIdx)}
                                  disabled={hasAnswered}
                                >
                                  <div className="ai-opt-letter">
                                    {String.fromCharCode(65 + optIdx)}
                                  </div>
                                  <span className="ai-opt-text">{renderInline(opt)}</span>
                                  {hasAnswered && isThisOptionCorrect && (
                                    <CheckCircle2 size={16} className="ai-opt-icon correct" />
                                  )}
                                  {hasAnswered && isSelected && !isThisOptionCorrect && (
                                    <XCircle size={16} className="ai-opt-icon wrong" />
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          {/* Explanation reveal after answering */}
                          {hasAnswered && (
                            <div className="ai-quiz-explanation-box">
                              <div className="ai-explanation-header">
                                <Lightbulb size={14} />
                                <span>Explanation</span>
                              </div>
                              <p className="ai-explanation-text">
                                {renderInline(q.explanation)}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="ai-companion-footer">
          <span className="ai-companion-footer-hint">
            The book content is the primary source of truth.
          </span>
          <button className="ai-companion-continue-btn" onClick={onClose}>
            <span>Continue Reading</span>
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
};
