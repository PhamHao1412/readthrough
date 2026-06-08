import React, { useEffect, useState, useRef } from 'react';
import { Copy, Check, X, AlertTriangle } from 'lucide-react';

interface TranslationTooltipProps {
  text: string;
  x: number;
  y: number;
  onClose: () => void;
}

export const TranslationTooltip: React.FC<TranslationTooltipProps> = ({ text, x, y, onClose }) => {
  const [translatedText, setTranslatedText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const translate = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/v1/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error('Translation failed. Please try again.');
        const json = await res.json();
        if (json.succeeded && json.data?.translatedText) {
          setTranslatedText(json.data.translatedText);
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
    const width = 330;
    const estHeight = 230;
    let left = x - width / 2;
    let top = y + 12;
    if (left < 10) left = 10;
    if (left + width > window.innerWidth - 10) left = window.innerWidth - width - 10;
    if (top + estHeight > window.innerHeight - 10) top = y - estHeight - 12;
    return { left: `${left}px`, top: `${top}px` };
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div ref={tooltipRef} className="translation-tooltip" style={getPosition()}>
      {/* Header */}
      <div className="tooltip-header">
        <span className="tooltip-title">✦ Vietnamese Translation</span>
        <button className="tooltip-close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div className="tooltip-body">
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

        {!loading && !error && (
          <>
            <p className="tooltip-original">"{text}"</p>
            <p className="tooltip-translated">{translatedText}</p>
          </>
        )}
      </div>

      {/* Footer */}
      {!loading && !error && (
        <div className="tooltip-footer">
          <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy}>
            {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
          </button>
        </div>
      )}
    </div>
  );
};
