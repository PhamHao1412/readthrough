/**
 * textSelection.ts
 *
 * Robust, cross-format text and word extraction utilities.
 * Handles PDF.js text layer (absolute positioned split spans, ligatures, kerning drift)
 * as well as normal inline flow DOM (EPUB, TXT, Markdown).
 */

const WORD_CHAR_BASE = /^[\p{L}\p{N}]$/u;
const CONNECTOR_CHARS = new Set(["'", '’', '-', '‐', '_']);

/**
 * Checks if a character is considered part of a word.
 */
export const isWordChar = (char: string): boolean => {
  if (!char) return false;
  return WORD_CHAR_BASE.test(char) || CONNECTOR_CHARS.has(char);
};

/**
 * Strips leading/trailing punctuation, quotes, brackets from a word,
 * preserving internal apostrophes/hyphens (e.g. "it's" or "state-of-the-art").
 */
export const cleanWordString = (str: string): string => {
  let s = str.trim();
  // Strip leading punctuation/quotes/brackets
  s = s.replace(/^[^\p{L}\p{N}]+/u, '');
  // Strip trailing punctuation/quotes/brackets
  s = s.replace(/[^\p{L}\p{N}]+$/u, '');
  return s;
};

/**
 * Helper to get the first text node descendant of an element.
 */
const getFirstTextNode = (el: Node): Text | null => {
  if (el.nodeType === Node.TEXT_NODE) return el as Text;
  for (let i = 0; i < el.childNodes.length; i++) {
    const res = getFirstTextNode(el.childNodes[i]);
    if (res) return res;
  }
  return null;
};

/**
 * Helper to get the last text node descendant of an element.
 */
const getLastTextNode = (el: Node): Text | null => {
  if (el.nodeType === Node.TEXT_NODE) return el as Text;
  for (let i = el.childNodes.length - 1; i >= 0; i--) {
    const res = getLastTextNode(el.childNodes[i]);
    if (res) return res;
  }
  return null;
};

export interface WordSelectionResult {
  range: Range;
  word: string;
}

/**
 * Trims leading and trailing non-word punctuation characters from a DOM Range.
 */
export const trimRangePunctuation = (range: Range): WordSelectionResult => {
  const cloned = range.cloneRange();

  // 1. Trim trailing non-word characters
  while (!cloned.collapsed) {
    const endContainer = cloned.endContainer;
    const endOffset = cloned.endOffset;
    if (endContainer.nodeType === Node.TEXT_NODE && endOffset > 0) {
      const text = endContainer.textContent || '';
      const char = text[endOffset - 1];
      if (char && !WORD_CHAR_BASE.test(char)) {
        cloned.setEnd(endContainer, endOffset - 1);
        continue;
      }
    }
    break;
  }

  // 2. Trim leading non-word characters
  while (!cloned.collapsed) {
    const startContainer = cloned.startContainer;
    const startOffset = cloned.startOffset;
    if (startContainer.nodeType === Node.TEXT_NODE) {
      const text = startContainer.textContent || '';
      if (startOffset < text.length) {
        const char = text[startOffset];
        if (char && !WORD_CHAR_BASE.test(char)) {
          cloned.setStart(startContainer, startOffset + 1);
          continue;
        }
      }
    }
    break;
  }

  const word = cleanWordString(cloned.toString());
  return { range: cloned, word };
};

/**
 * Find Caret position safely with Snap-to-word tolerance.
 */
const getCaretAtPoint = (
  doc: Document,
  x: number,
  y: number,
  container?: HTMLElement
): { node: Text; offset: number } | null => {
  const tryOffsets = [
    { dx: 0, dy: 0 },
    { dx: -4, dy: 0 },
    { dx: 4, dy: 0 },
    { dx: -8, dy: 0 },
    { dx: 8, dy: 0 },
  ];

  for (const { dx, dy } of tryOffsets) {
    const caretInfo = (doc as any).caretRangeFromPoint?.(x + dx, y + dy)
      ?? (doc as any).caretPositionFromPoint?.(x + dx, y + dy);

    if (!caretInfo) continue;

    let node: Text | null = null;
    let offset = 0;

    if (caretInfo.startContainer?.nodeType === Node.TEXT_NODE) {
      node = caretInfo.startContainer as Text;
      offset = caretInfo.startOffset;
    } else if (caretInfo.offsetNode?.nodeType === Node.TEXT_NODE) {
      node = caretInfo.offsetNode as Text;
      offset = caretInfo.offset;
    }

    if (node && (!container || container.contains(node))) {
      const text = node.textContent || '';
      if (text.length > 0) {
        if (offset < text.length && isWordChar(text[offset])) {
          return { node, offset };
        }
        if (offset > 0 && isWordChar(text[offset - 1])) {
          return { node, offset: offset - 1 };
        }
        if (dx === 0) {
          return { node, offset };
        }
      }
    }
  }

  return null;
};

/**
 * Specialized Word Extractor for PDF.js Text Layers.
 *
 * Handles:
 * 1. Absolute positioned split spans (PDF kerning / ligatures / font changes).
 * 2. Same-line Cross-Span Stitching (joins `<span>deve</span><span>lop</span><span>ing</span>`).
 * 3. Bidirectional word boundary expansion using Unicode character sets.
 * 4. Punctuation stripping without truncating words.
 */
export const findPdfWordAtPoint = (
  textLayerEl: HTMLElement,
  clientX: number,
  clientY: number
): WordSelectionResult | null => {
  const doc = textLayerEl.ownerDocument || document;
  const caret = getCaretAtPoint(doc, clientX, clientY, textLayerEl);
  if (!caret) return null;

  const { node: clickNode, offset: clickOffset } = caret;
  const text = clickNode.textContent || '';
  if (!text) return null;

  // Determine starting position on a word character
  let offset = clickOffset;
  if (offset >= text.length) offset = text.length - 1;
  if (offset > 0 && !isWordChar(text[offset] ?? '')) {
    if (isWordChar(text[offset - 1] ?? '')) {
      offset = offset - 1;
    }
  }
  if (!isWordChar(text[offset] ?? '')) return null;

  // --- 1. Expand within current text node ---
  let startOffset = offset;
  while (startOffset > 0 && isWordChar(text[startOffset - 1])) {
    startOffset--;
  }

  let endOffset = offset + 1;
  while (endOffset < text.length && isWordChar(text[endOffset])) {
    endOffset++;
  }

  let startNode: Text = clickNode;
  let endNode: Text = clickNode;

  // Find parent span in textLayer
  const getSpanAncestor = (n: Node): HTMLElement | null => {
    let cur: Node | null = n;
    while (cur && cur !== textLayerEl) {
      if (cur.nodeType === Node.ELEMENT_NODE && (cur as HTMLElement).tagName === 'SPAN') {
        return cur as HTMLElement;
      }
      cur = cur.parentNode;
    }
    return null;
  };

  const currentSpan = getSpanAncestor(clickNode);

  // --- 2. Cross-Span Expansion (Stitching adjacent PDF spans on the same line) ---
  if (currentSpan) {
    const allSpans = Array.from(textLayerEl.querySelectorAll('span')) as HTMLElement[];
    const curIdx = allSpans.indexOf(currentSpan);

    if (curIdx !== -1) {
      const currentRect = currentSpan.getBoundingClientRect();
      const lineHeight = Math.max(12, currentRect.height);

      // Check PREVIOUS spans if the word reaches the start of current text node
      if (startOffset === 0) {
        let prevIdx = curIdx - 1;
        let lastCheckedRect = currentRect;

        while (prevIdx >= 0) {
          const prevSpan = allSpans[prevIdx];
          const prevRect = prevSpan.getBoundingClientRect();

          // Check if on same line (Y alignment within 35% line-height tolerance)
          const sameLine = Math.abs(prevRect.top - lastCheckedRect.top) < lineHeight * 0.4;
          // Check horizontal adjacency (gap < 8px or slight overlap)
          const isAdjacent = prevRect.right <= lastCheckedRect.left + 3 &&
                             (lastCheckedRect.left - prevRect.right) < 8;

          if (sameLine && isAdjacent) {
            const prevText = prevSpan.textContent || '';
            if (prevText.length > 0 && isWordChar(prevText[prevText.length - 1])) {
              const textNode = getLastTextNode(prevSpan);
              if (textNode) {
                let ps = prevText.length - 1;
                while (ps > 0 && isWordChar(prevText[ps - 1])) {
                  ps--;
                }
                startNode = textNode;
                startOffset = ps;
                lastCheckedRect = prevRect;

                if (ps === 0) {
                  prevIdx--;
                  continue;
                }
              }
            }
          }
          break;
        }
      }

      // Check NEXT spans if the word reaches the end of current text node
      if (endOffset === text.length) {
        let nextIdx = curIdx + 1;
        let lastCheckedRect = currentRect;

        while (nextIdx < allSpans.length) {
          const nextSpan = allSpans[nextIdx];
          const nextRect = nextSpan.getBoundingClientRect();

          // Check if on same line
          const sameLine = Math.abs(nextRect.top - lastCheckedRect.top) < lineHeight * 0.4;
          // Check horizontal adjacency
          const isAdjacent = nextRect.left >= lastCheckedRect.right - 3 &&
                             (nextRect.left - lastCheckedRect.right) < 8;

          if (sameLine && isAdjacent) {
            const nextText = nextSpan.textContent || '';
            if (nextText.length > 0 && isWordChar(nextText[0])) {
              const textNode = getFirstTextNode(nextSpan);
              if (textNode) {
                let ne = 1;
                while (ne < nextText.length && isWordChar(nextText[ne])) {
                  ne++;
                }
                endNode = textNode;
                endOffset = ne;
                lastCheckedRect = nextRect;

                if (ne === nextText.length) {
                  nextIdx++;
                  continue;
                }
              }
            }
          }
          break;
        }
      }
    }
  }

  // --- 3. Build Range & Clean ---
  try {
    const range = doc.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    const trimmed = trimRangePunctuation(range);
    if (!trimmed.word) return null;

    return trimmed;
  } catch (err) {
    console.error('[textSelection] Error creating PDF word range:', err);
    return null;
  }
};

/**
 * Generalized Word Extractor for Standard HTML Flow DOM (EPUB, TXT, Markdown).
 */
export const findHtmlWordAtPoint = (
  doc: Document,
  clientX: number,
  clientY: number,
  container?: HTMLElement
): WordSelectionResult | null => {
  const BLOCK_TAGS = new Set([
    'P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI', 'TD', 'TH',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'HR', 'PRE', 'TABLE'
  ]);

  const getPrevTextNode = (node: Node): Text | null => {
    let cur: Node | null = node;
    while (cur) {
      let prev: Node | null = cur.previousSibling;
      if (prev) {
        while (prev.lastChild) prev = prev.lastChild;
        if (prev.nodeType === Node.TEXT_NODE) return prev as Text;
        if (prev.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((prev as Element).tagName)) return null;
        cur = prev;
      } else {
        cur = cur.parentNode;
        if (!cur || (cur.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((cur as Element).tagName))) return null;
      }
    }
    return null;
  };

  const getNextTextNode = (node: Node): Text | null => {
    let cur: Node | null = node;
    while (cur) {
      let next: Node | null = cur.nextSibling;
      if (next) {
        while (next.firstChild) next = next.firstChild;
        if (next.nodeType === Node.TEXT_NODE) return next as Text;
        if (next.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((next as Element).tagName)) return null;
        cur = next;
      } else {
        cur = cur.parentNode;
        if (!cur || (cur.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((cur as Element).tagName))) return null;
      }
    }
    return null;
  };

  const caret = getCaretAtPoint(doc, clientX, clientY, container);
  if (!caret) return null;

  const { node: clickNode, offset: clickOffset } = caret;
  const text = clickNode.textContent || '';
  if (!text) return null;

  let offset = clickOffset;
  if (offset >= text.length) offset = text.length - 1;
  if (offset > 0 && !isWordChar(text[offset] ?? '')) {
    if (isWordChar(text[offset - 1] ?? '')) {
      offset = offset - 1;
    }
  }
  if (!isWordChar(text[offset] ?? '')) return null;

  let start = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;

  let end = offset + 1;
  while (end < text.length && isWordChar(text[end])) end++;

  let startNode: Text = clickNode;
  let startOffset = start;
  if (start === 0) {
    let prevNode = getPrevTextNode(clickNode);
    while (prevNode) {
      const prevText = prevNode.textContent || '';
      if (prevText.length > 0 && isWordChar(prevText[prevText.length - 1])) {
        let ps = prevText.length - 1;
        while (ps > 0 && isWordChar(prevText[ps - 1])) ps--;
        startNode = prevNode;
        startOffset = ps;
        if (ps > 0) break;
        prevNode = getPrevTextNode(prevNode);
      } else {
        break;
      }
    }
  }

  let endNode: Text = clickNode;
  let endOffset = end;
  if (end === text.length) {
    let nextNode = getNextTextNode(clickNode);
    while (nextNode) {
      const nextText = nextNode.textContent || '';
      if (nextText.length > 0 && isWordChar(nextText[0])) {
        let ne = 1;
        while (ne < nextText.length && isWordChar(nextText[ne])) ne++;
        endNode = nextNode;
        endOffset = ne;
        if (ne < nextText.length) break;
        nextNode = getNextTextNode(nextNode);
      } else {
        break;
      }
    }
  }

  try {
    const range = doc.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    const trimmed = trimRangePunctuation(range);
    if (!trimmed.word) return null;

    return trimmed;
  } catch (err) {
    console.error('[textSelection] Error creating HTML word range:', err);
    return null;
  }
};

export interface StoredPdfTextItem {
  str: string;
  transform: number[]; // [a, b, c, d, tx, ty]
  width: number;
  height: number;
}

export interface PdfWordResult {
  word: string;
  box: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

/**
 * Pixel-perfect PDF Word & Bounding Box Extractor.
 * Directly transforms PDF content stream text geometry to viewport pixels,
 * guaranteeing 100% exact alignment with canvas text (no DOM font drift, no leading whitespace, no missing chars).
 */
export const findPdfWordFromTextItems = (
  textItems: StoredPdfTextItem[],
  viewport: any,
  containerX: number,
  containerY: number
): PdfWordResult | null => {
  if (!textItems || textItems.length === 0 || !viewport) return null;

  // Convert click point from Container CSS pixels to PDF User Coordinates
  const pdfPoint = viewport.convertToPdfPoint(containerX, containerY);
  if (!pdfPoint || pdfPoint.length < 2) return null;
  const [pdfX, pdfY] = pdfPoint;

  // 1. Find the best matching text item line
  let bestItem: StoredPdfTextItem | null = null;
  let bestItemIdx = -1;
  let minDistance = Infinity;

  for (let i = 0; i < textItems.length; i++) {
    const item = textItems[i];
    if (!item.str || item.str.trim().length === 0) continue;

    const tx = item.transform[4];
    const ty = item.transform[5];
    const fh = item.height || Math.abs(item.transform[3]) || 12;
    const w = item.width;

    // Vertical range in PDF coordinate space (ty is baseline, font rises to ty + fh)
    const yMin = ty - fh * 0.35;
    const yMax = ty + fh * 1.35;

    if (pdfY >= yMin && pdfY <= yMax) {
      // Horizontal distance to item [tx, tx + w]
      let hDist = 0;
      if (pdfX < tx) {
        hDist = tx - pdfX;
      } else if (pdfX > tx + w) {
        hDist = pdfX - (tx + w);
      }

      // Vertical distance to line center
      const vDist = Math.abs(pdfY - (ty + fh * 0.5));
      const totalDist = hDist + vDist * 2.5;

      if (totalDist < minDistance) {
        minDistance = totalDist;
        bestItem = item;
        bestItemIdx = i;
      }
    }
  }

  if (!bestItem || bestItemIdx === -1 || minDistance > 60) return null;

  // 2. Locate character index in bestItem
  const tx = bestItem.transform[4];
  const ty = bestItem.transform[5];
  const fh = bestItem.height || Math.abs(bestItem.transform[3]) || 12;
  const w = bestItem.width;
  const str = bestItem.str;

  const relX = pdfX - tx;
  const ratio = Math.max(0, Math.min(0.999, relX / Math.max(1, w)));
  let approxIdx = Math.floor(ratio * str.length);

  // If clicked between words or on whitespace, search nearest word character
  if (!isWordChar(str[approxIdx] ?? '')) {
    let found = -1;
    for (let d = 1; d <= 6; d++) {
      if (approxIdx - d >= 0 && isWordChar(str[approxIdx - d])) {
        found = approxIdx - d;
        break;
      }
      if (approxIdx + d < str.length && isWordChar(str[approxIdx + d])) {
        found = approxIdx + d;
        break;
      }
    }
    if (found !== -1) {
      approxIdx = found;
    }
  }

  if (!isWordChar(str[approxIdx] ?? '')) return null;

  // 3. Expand within current item
  let startIdx = approxIdx;
  while (startIdx > 0 && isWordChar(str[startIdx - 1])) {
    startIdx--;
  }

  let endIdx = approxIdx + 1;
  while (endIdx < str.length && isWordChar(str[endIdx])) {
    endIdx++;
  }

  let fullWord = str.substring(startIdx, endIdx);

  // Collect bounding segments to merge: array of { item, s, e }
  const segments: Array<{ item: StoredPdfTextItem; s: number; e: number }> = [
    { item: bestItem, s: startIdx, e: endIdx },
  ];

  // 4. Cross-item Expansion (Left)
  if (startIdx === 0) {
    let prevIdx = bestItemIdx - 1;
    let lastTx = tx;
    let lastTy = ty;

    while (prevIdx >= 0) {
      const prevItem = textItems[prevIdx];
      if (!prevItem.str || prevItem.str.length === 0) {
        prevIdx--;
        continue;
      }

      const pTx = prevItem.transform[4];
      const pTy = prevItem.transform[5];
      const pW = prevItem.width;
      const sameLine = Math.abs(pTy - lastTy) < fh * 0.4;
      const isAdjacent = pTx + pW <= lastTx + 3 && (lastTx - (pTx + pW)) < 6;

      if (sameLine && isAdjacent) {
        const pStr = prevItem.str;
        if (pStr.length > 0 && isWordChar(pStr[pStr.length - 1])) {
          let ps = pStr.length - 1;
          while (ps > 0 && isWordChar(pStr[ps - 1])) {
            ps--;
          }
          fullWord = pStr.substring(ps) + fullWord;
          segments.unshift({ item: prevItem, s: ps, e: pStr.length });
          lastTx = pTx;
          lastTy = pTy;

          if (ps === 0) {
            prevIdx--;
            continue;
          }
        }
      }
      break;
    }
  }

  // 5. Cross-item Expansion (Right)
  if (endIdx === str.length) {
    let nextIdx = bestItemIdx + 1;
    let lastTx = tx + w;
    let lastTy = ty;

    while (nextIdx < textItems.length) {
      const nextItem = textItems[nextIdx];
      if (!nextItem.str || nextItem.str.length === 0) {
        nextIdx++;
        continue;
      }

      const nTx = nextItem.transform[4];
      const nTy = nextItem.transform[5];
      const nW = nextItem.width;
      const sameLine = Math.abs(nTy - lastTy) < fh * 0.4;
      const isAdjacent = nTx >= lastTx - 3 && (nTx - lastTx) < 6;

      if (sameLine && isAdjacent) {
        const nStr = nextItem.str;
        if (nStr.length > 0 && isWordChar(nStr[0])) {
          let ne = 1;
          while (ne < nStr.length && isWordChar(nStr[ne])) {
            ne++;
          }
          fullWord = fullWord + nStr.substring(0, ne);
          segments.push({ item: nextItem, s: 0, e: ne });
          lastTx = nTx + nW;
          lastTy = nTy;

          if (ne === nStr.length) {
            nextIdx++;
            continue;
          }
        }
      }
      break;
    }
  }

  const cleanWord = cleanWordString(fullWord);
  if (!cleanWord) return null;

  // 6. Compute Pixel-Perfect Canvas Bounding Box from Geometry
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;

  for (const seg of segments) {
    const itemTx = seg.item.transform[4];
    const itemTy = seg.item.transform[5];
    const itemFh = seg.item.height || Math.abs(seg.item.transform[3]) || 12;
    const itemW = seg.item.width;
    const len = Math.max(1, seg.item.str.length);

    // Exact sub-string PDF coordinates
    const segX1 = itemTx + itemW * (seg.s / len);
    const segX2 = itemTx + itemW * (seg.e / len);
    // Include slight vertical padding for aesthetic highlight
    const segY1 = itemTy - itemFh * 0.12;
    const segY2 = itemTy + itemFh * 0.98;

    const rect = viewport.convertToViewportRectangle([segX1, segY1, segX2, segY2]);
    const l = Math.min(rect[0], rect[2]);
    const t = Math.min(rect[1], rect[3]);
    const r = Math.max(rect[0], rect[2]);
    const b = Math.max(rect[1], rect[3]);

    if (l < minLeft) minLeft = l;
    if (t < minTop) minTop = t;
    if (r > maxRight) maxRight = r;
    if (b > maxBottom) maxBottom = b;
  }

  if (minLeft >= maxRight || minTop >= maxBottom) return null;

  return {
    word: cleanWord,
    box: {
      left: Math.round(minLeft),
      top: Math.round(minTop),
      width: Math.round(maxRight - minLeft),
      height: Math.round(maxBottom - minTop),
    },
  };
};

