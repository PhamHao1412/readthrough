import React, { useState, useEffect } from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { parseMarkdownText, MarkdownBlock } from './MdViewer';

interface PasteMarkdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (content: string, title: string, author: string) => Promise<void>;
}

export const PasteMarkdownModal: React.FC<PasteMarkdownModalProps> = ({
  isOpen,
  onClose,
  onSave
}) => {
  const [title, setTitle] = useState<string>('');
  const [author, setAuthor] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write');
  const [saving, setSaving] = useState<boolean>(false);
  const [previewBlocks, setPreviewBlocks] = useState<MarkdownBlock[]>([]);

  // Parse markdown for preview when switching to the preview tab
  useEffect(() => {
    if (activeTab === 'preview') {
      const { parsedBlocks } = parseMarkdownText(content || '*No content to preview*');
      setPreviewBlocks(parsedBlocks);
    }
  }, [activeTab, content]);

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const cleanTitle = title.trim() || 'Pasted Markdown';
      const cleanAuthor = author.trim() || 'My Snippets';
      await onSave(content, cleanTitle, cleanAuthor);
      // Reset
      setTitle('');
      setAuthor('');
      setContent('');
      setActiveTab('write');
      onClose();
    } catch (err) {
      console.error(err);
      alert('Failed to save Markdown document.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  // Simplified inline formatter for preview
  const renderInlineMarkdown = (text: string): React.ReactNode[] => {
    const tokenRegex = /(\[.*?\]\(.*?\))|(\*\*.*?\*\*)|(\*.*?\*)|(`.*?`)/g;
    const parts = text.split(tokenRegex);

    return parts.map((part, idx) => {
      if (!part) return null;

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

  const renderPreviewBlocks = () => {
    return previewBlocks.map((block) => {
      switch (block.type) {
        case 'h1':
          return <h1 key={block.id} className="md-view-h1">{renderInlineMarkdown(block.content || '')}</h1>;
        case 'h2':
          return <h2 key={block.id} className="md-view-h2">{renderInlineMarkdown(block.content || '')}</h2>;
        case 'h3':
          return <h3 key={block.id} className="md-view-h3">{renderInlineMarkdown(block.content || '')}</h3>;
        case 'h4':
          return <h4 key={block.id} className="md-view-h4">{renderInlineMarkdown(block.content || '')}</h4>;
        case 'h5':
          return <h5 key={block.id} className="md-view-h5">{renderInlineMarkdown(block.content || '')}</h5>;
        case 'h6':
          return <h6 key={block.id} className="md-view-h6">{renderInlineMarkdown(block.content || '')}</h6>;
        case 'paragraph':
          return <p key={block.id} className="md-view-p">{renderInlineMarkdown(block.content || '')}</p>;
        case 'blockquote':
          return (
            <blockquote key={block.id} className="md-view-blockquote">
              {block.content?.split('\n').map((l, idx) => (
                <p key={idx} style={{ margin: 0 }}>{renderInlineMarkdown(l)}</p>
              ))}
            </blockquote>
          );
        case 'hr':
          return <hr key={block.id} className="md-view-hr" />;
        case 'code':
          return (
            <div key={block.id} className="md-view-code-block">
              <div className="md-view-code-header">
                <span className="md-view-code-lang">{block.lang}</span>
              </div>
              <pre className="md-view-code-pre">
                <code>{block.content}</code>
              </pre>
            </div>
          );
        case 'table':
          return (
            <div key={block.id} className="md-view-table-wrapper">
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
            <div key={block.id} style={{ marginBottom: '1.2em' }}>
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

  return (
    <div className="paste-modal-backdrop" onClick={onClose}>
      <div className="paste-modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="paste-modal-header">
          <h3>
            <Sparkles size={18} style={{ color: '#a855f7' }} />
            Paste Markdown Document
          </h3>
          <button className="paste-modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="paste-modal-body">
          {/* Title & Author Inputs */}
          <div className="paste-field-group">
            <div className="paste-field">
              <label>Title</label>
              <input
                type="text"
                className="paste-input"
                placeholder="e.g. Markdown Cheat Sheet"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="paste-field">
              <label>Author</label>
              <input
                type="text"
                className="paste-input"
                placeholder="e.g. John Doe"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>
          </div>

          {/* Edit/Preview Tabs */}
          <div className="paste-editor-tabs">
            <button
              className={`paste-tab-btn ${activeTab === 'write' ? 'active' : ''}`}
              onClick={() => setActiveTab('write')}
            >
              Write
            </button>
            <button
              className={`paste-tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
              onClick={() => setActiveTab('preview')}
            >
              Preview
            </button>
          </div>

          {/* Text Area or Preview Window */}
          {activeTab === 'write' ? (
            <div className="paste-textarea-wrapper">
              <textarea
                className="paste-textarea"
                placeholder="Paste or write your Markdown content here...&#10;&#10;# Title&#10;Write descriptions. Use **bold** text or `code` tags.&#10;&#10;## Bullet list&#10;- Bullet 1&#10;- Bullet 2&#10;&#10;```javascript&#10;console.log('Code blocks are supported');&#10;```"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
          ) : (
            <div className="paste-preview-area md-content">
              {renderPreviewBlocks()}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="paste-modal-footer">
          <button className="paste-modal-btn cancel" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="paste-modal-btn save"
            onClick={handleSave}
            disabled={saving || !content.trim()}
          >
            {saving ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Loader2 size={14} style={{ animation: 'spin 0.7s linear infinite' }} />
                Saving...
              </span>
            ) : (
              'Save to Library'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
