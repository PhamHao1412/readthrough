import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check, X, Moon, Sun, Palette, Sparkles } from 'lucide-react';
import {
  ThemeId,
  ThemeCategory,
  DARK_THEMES,
  LIGHT_THEMES,
  getThemeById,
} from '../utils/themes';

interface ThemeSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: ThemeId;
  onSelectTheme: (themeId: ThemeId) => void;
}

export const ThemeSelectorModal: React.FC<ThemeSelectorModalProps> = ({
  isOpen,
  onClose,
  currentTheme,
  onSelectTheme,
}) => {
  const activePreset = getThemeById(currentTheme);
  const [activeCategory, setActiveCategory] = useState<ThemeCategory>(activePreset.category);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modalCardRef = useRef<HTMLDivElement>(null);

  // Sync category when current theme changes
  useEffect(() => {
    setActiveCategory(activePreset.category);
  }, [activePreset.category]);

  // Click outside to close dropdown & modal
  useEffect(() => {
    if (!isOpen) {
      setIsDropdownOpen(false);
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Close dropdown if clicking outside dropdown
      if (
        isDropdownOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsDropdownOpen(false);
      }

      // Close modal if clicking outside modal card
      if (
        modalCardRef.current &&
        !modalCardRef.current.contains(target) &&
        !target.closest('.theme-btn') &&
        !target.closest('.icon-btn')
      ) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDropdownOpen) {
          setIsDropdownOpen(false);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isDropdownOpen, onClose]);

  if (!isOpen) return null;

  const currentThemeList = activeCategory === 'dark' ? DARK_THEMES : LIGHT_THEMES;

  const handleSelect = (id: ThemeId) => {
    onSelectTheme(id);
    setIsDropdownOpen(false);
  };

  return (
    <div className="theme-modal-backdrop">
      <div className="theme-selector-card" ref={modalCardRef}>
        {/* Header */}
        <div className="theme-selector-header">
          <h3 className="theme-selector-title">
            <Palette size={18} style={{ color: 'var(--accent)' }} />
            <span>{activeCategory === 'dark' ? 'Dark Theme' : 'Light Theme'}</span>
          </h3>
          <button
            className="theme-selector-close-btn"
            onClick={onClose}
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Category Switcher Tabs */}
        <div className="theme-category-tabs">
          <button
            className={`theme-category-tab ${activeCategory === 'dark' ? 'active' : ''}`}
            onClick={() => {
              setActiveCategory('dark');
              if (activePreset.category !== 'dark') {
                onSelectTheme(DARK_THEMES[0].id);
              }
            }}
          >
            <Moon size={14} />
            <span>Dark Presets</span>
          </button>
          <button
            className={`theme-category-tab ${activeCategory === 'light' ? 'active' : ''}`}
            onClick={() => {
              setActiveCategory('light');
              if (activePreset.category !== 'light') {
                onSelectTheme(LIGHT_THEMES[0].id);
              }
            }}
          >
            <Sun size={14} />
            <span>Light & Eye-care</span>
          </button>
        </div>

        {/* Live Theme Preview Banner */}
        <div
          className="theme-live-preview-banner"
          style={{
            background: activePreset.surface,
            borderColor: activePreset.border,
            color: activePreset.foreground,
          }}
        >
          <div className="theme-preview-header">
            <div className="theme-preview-dots">
              <span style={{ backgroundColor: '#ff5f56' }} />
              <span style={{ backgroundColor: '#ffbd2e' }} />
              <span style={{ backgroundColor: '#27c93f' }} />
            </div>
            <span className="theme-preview-badge" style={{ color: activePreset.accent, backgroundColor: activePreset.accentLight }}>
              {activePreset.name}
            </span>
          </div>
          <div className="theme-preview-content">
            <div className="theme-preview-title" style={{ color: activePreset.accent }}>
              <Sparkles size={14} />
              <span>ReadThrough Smart Reader</span>
            </div>
            <p className="theme-preview-text" style={{ color: activePreset.textSecondary }}>
              Experience smooth, immersive reading with perfectly balanced typography and colors.
            </p>
          </div>
        </div>

        {/* Properties Container (Matching Screenshot) */}
        <div className="theme-properties-container">
          {/* Row 1: Preset */}
          <div className="theme-prop-row">
            <span className="theme-prop-label">Preset</span>
            <div className="theme-preset-dropdown-wrapper" ref={dropdownRef}>
              <button
                type="button"
                className="theme-preset-trigger-btn"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="theme-item-color-dots">
                    <span style={{ backgroundColor: activePreset.background }} />
                    <span style={{ backgroundColor: activePreset.foreground }} />
                    <span style={{ backgroundColor: activePreset.accent }} />
                  </div>
                  <span>{activePreset.name}</span>
                </div>
                <ChevronDown
                  size={14}
                  style={{
                    transform: isDropdownOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.18s ease',
                  }}
                />
              </button>

              {isDropdownOpen && (
                <div className="theme-preset-dropdown-menu">
                  <div className="theme-preset-dropdown-group-title">
                    {activeCategory === 'dark' ? 'Dark Themes' : 'Light Themes'}
                  </div>
                  {currentThemeList.map((preset) => {
                    const isSelected = preset.id === activePreset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={`theme-preset-dropdown-item ${isSelected ? 'active' : ''}`}
                        onClick={() => handleSelect(preset.id)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <div className="theme-item-color-dots">
                            <span style={{ backgroundColor: preset.background }} />
                            <span style={{ backgroundColor: preset.foreground }} />
                            <span style={{ backgroundColor: preset.accent }} />
                          </div>
                          <span>{preset.name}</span>
                        </div>
                        {isSelected && <Check size={16} className="theme-preset-check-icon" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Row 2: Background */}
          <div className="theme-prop-row">
            <span className="theme-prop-label">Background</span>
            <div className="theme-color-badge">
              <span
                className="theme-color-swatch"
                style={{ backgroundColor: activePreset.background }}
              />
              <span># {activePreset.background.replace('#', '').toUpperCase()}</span>
            </div>
          </div>

          {/* Row 3: Foreground */}
          <div className="theme-prop-row">
            <span className="theme-prop-label">Foreground</span>
            <div className="theme-color-badge">
              <span
                className="theme-color-swatch"
                style={{ backgroundColor: activePreset.foreground }}
              />
              <span># {activePreset.foreground.replace('#', '').toUpperCase()}</span>
            </div>
          </div>

          {/* Row 4: Accent */}
          <div className="theme-prop-row">
            <span className="theme-prop-label">Accent</span>
            <div className="theme-color-badge">
              <span
                className="theme-color-swatch"
                style={{ backgroundColor: activePreset.accent }}
              />
              <span># {activePreset.accent.replace('#', '').toUpperCase()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
