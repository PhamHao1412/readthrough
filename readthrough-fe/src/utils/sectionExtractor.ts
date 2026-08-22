/**
 * Utility functions for extracting text content from PDF, Markdown, and other document formats
 * for targeted section-level AI analysis (Summary, Explain, Quiz).
 */

export interface TocItemData {
  title: string;
  target?: number | string | null;
  children?: TocItemData[];
  level?: number;
}

export interface SectionRangeResult {
  startPage: number;
  endPage: number;
  targetTitle?: string;
  nextSectionTitle?: string;
}

/**
 * Flattens a nested TOC tree into a flat array of items in sequential order.
 */
export const flattenOutline = (items: TocItemData[]): TocItemData[] => {
  const result: TocItemData[] = [];
  const walk = (nodes: TocItemData[]) => {
    for (const node of nodes) {
      result.push(node);
      if (node.children && node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  walk(items);
  return result;
};

/**
 * Normalizes title string for robust fuzzy matching inside extracted page text.
 * Strips numbering prefixes like "Chapter 4. ", "4.1 ", "Section 1: " etc.
 */
export const normalizeTitleForMatching = (title: string): string => {
  if (!title) return '';
  return title
    .replace(/^(chapter|section|part|appendix)\s+[\w\d.-]+[:.\s-]*/i, '')
    .replace(/^[\d.]+\s*[:.-]?\s*/, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

/**
 * Determines whether a TOC item represents a Chapter or Major Container
 * (which requires a Chapter Overview / Roadmap) versus a specific Section / Subsection (which requires Section Deep Dive).
 */
export const isChapterOrMajorContainer = (item: any, outline: TocItemData[] = []): boolean => {
  if (!item) return false;

  const title = (item.title || '').trim();

  // 1. Explicit title prefix: "Chapter 1...", "Part II...", "Ch. 5...", "Chương 1...", "Phần 1..."
  if (/^(chapter|part|ch\.|chương|phần)\b/i.test(title) || /\b(chapter|part|chương|phần)\s+[\dIVXLCDM]+/i.test(title)) {
    return true;
  }

  // 2. Tree structure: if item has children
  if (item.children && item.children.length > 0) {
    const isRoot = Array.isArray(outline) && outline.some(root => root === item || (root.title === item.title && root.target === item.target));
    if (isRoot) return true;
    const hasGrandchildren = item.children.some((child: any) => child.children && child.children.length > 0);
    if (hasGrandchildren) return true;
  }

  // 3. Flat outline structure with `level`
  if (typeof item.level === 'number' && Array.isArray(outline)) {
    const idx = outline.indexOf(item);
    if (idx !== -1 && idx + 1 < outline.length) {
      const next = outline[idx + 1];
      if (typeof next.level === 'number' && next.level > item.level) {
        return true;
      }
    }
  }

  return false;
};


/**
 * Finds the ending page for a given start page based on subsequent TOC items,

 * and identifies the next section's title for precise page-boundary trimming.
 */
export const findSectionPageRange = (
  startPage: number,
  outline: TocItemData[],
  totalPages: number,
  currentTitle?: string,
  maxPagesSpan = 12
): SectionRangeResult => {
  const flat = flattenOutline(outline);
  if (flat.length === 0) {
    const endPage = Math.min(totalPages, startPage + maxPagesSpan - 1);
    return { startPage, endPage, targetTitle: currentTitle };
  }

  // Find the index of current item in flat outline
  let curIdx = -1;
  if (currentTitle) {
    const normalizedTarget = normalizeTitleForMatching(currentTitle);
    curIdx = flat.findIndex(
      item =>
        item.target === startPage &&
        normalizeTitleForMatching(item.title) === normalizedTarget
    );
    if (curIdx === -1) {
      curIdx = flat.findIndex(item => item.target === startPage);
    }
  } else {
    curIdx = flat.findIndex(item => item.target === startPage);
  }

  let nextSectionTitle: string | undefined;
  let endPage = totalPages;

  if (curIdx !== -1) {
    const currentItem = flat[curIdx];
    const childrenFlat = currentItem && currentItem.children ? flattenOutline(currentItem.children) : [];

    // Find the next item in flat outline that is NOT a child/descendant of current item
    const nextItem = flat.slice(curIdx + 1).find(item => !childrenFlat.includes(item));

    if (nextItem) {
      nextSectionTitle = nextItem.title;
      const nextTargetPage = typeof nextItem.target === 'number' ? nextItem.target : null;

      if (nextTargetPage !== null) {
        if (nextTargetPage > startPage) {
          endPage = Math.max(startPage, nextTargetPage - 1);
        } else if (nextTargetPage === startPage) {
          // Next subsection is on the very same page
          endPage = startPage;
        }
      }
    }
  } else {
    // Search for any subsequent item with target page > startPage
    const subsequent = flat
      .filter(i => typeof i.target === 'number' && (i.target as number) > startPage)
      .sort((a, b) => (a.target as number) - (b.target as number));

    if (subsequent.length > 0) {
      nextSectionTitle = subsequent[0].title;
      endPage = Math.max(startPage, (subsequent[0].target as number) - 1);
    }
  }

  // Cap span to avoid huge context payloads
  const maxEnd = Math.min(totalPages, startPage + maxPagesSpan - 1);
  endPage = Math.min(endPage, maxEnd);
  if (endPage < startPage) endPage = startPage;

  return {
    startPage,
    endPage,
    targetTitle: currentTitle,
    nextSectionTitle,
  };
};

/**
 * Reconstructs lines from raw PDF.js text items by sorting and grouping vertical coordinates.
 * Preserves code snippets, terminal commands, tables, and paragraphs.
 */
const extractCleanLinesFromPdfPage = (textContent: any): string[] => {
  if (!textContent || !Array.isArray(textContent.items) || textContent.items.length === 0) {
    return [];
  }


  interface TextItem {
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }

  const items: TextItem[] = [];
  for (const item of textContent.items) {
    const str = item.str || '';
    if (!str) continue;
    // transform matrix: [scaleX, skewY, skewX, scaleY, transX, transY]
    const x = item.transform ? item.transform[4] : 0;
    const y = item.transform ? item.transform[5] : 0;
    const width = item.width || 0;
    const height = item.height || 0;
    items.push({ str, x, y, width, height });
  }

  if (items.length === 0) return [];

  // Sort items top-to-bottom (y descending in PDF coordinate space), then left-to-right (x ascending)
  items.sort((a, b) => {
    const yDiff = b.y - a.y;
    if (Math.abs(yDiff) > 3) {
      return yDiff;
    }
    return a.x - b.x;
  });

  // Group items into visual lines
  const lines: string[] = [];
  let currentLineY = items[0].y;
  let currentLineItems: TextItem[] = [items[0]];

  for (let i = 1; i < items.length; i++) {
    const item = items[i];
    if (Math.abs(item.y - currentLineY) <= 3.5) {
      currentLineItems.push(item);
    } else {
      // Assemble line
      currentLineItems.sort((a, b) => a.x - b.x);
      const lineStr = currentLineItems.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
      if (lineStr) {
        lines.push(lineStr);
      }
      currentLineY = item.y;
      currentLineItems = [item];
    }
  }

  if (currentLineItems.length > 0) {
    currentLineItems.sort((a, b) => a.x - b.x);
    const lineStr = currentLineItems.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
    if (lineStr) {
      lines.push(lineStr);
    }
  }

  // Filter out repeated running headers and footers (e.g. "52 | Chapter 4...", lone page numbers)
  const filteredLines: string[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const isFirstOrLast = idx === 0 || idx === lines.length - 1;

    if (isFirstOrLast) {
      // Lone page number line like "52"
      if (/^\d{1,4}$/.test(line)) continue;
      // Header/footer pattern with pipe: "52 | Chapter 4: Commands" or "Commands | 52"
      if (/^\d{1,4}\s*\|\s*.*$/.test(line) || /^.*\s*\|\s*\d{1,4}$/.test(line)) continue;
      // Standard publisher watermarks / copyright notice at very bottom
      if (/^(www\.|http|allitebooks|copyright|all rights reserved)/i.test(line)) continue;
    }

    filteredLines.push(line);
  }

  return filteredLines;
};

/**
 * Checks if a line matches a section heading title using normalized substring comparison.
 */
const isLineMatchingTitle = (line: string, title?: string): boolean => {
  if (!title || !line) return false;
  const normTitle = normalizeTitleForMatching(title);
  const normLine = normalizeTitleForMatching(line);
  if (!normTitle || !normLine) return false;

  return normLine === normTitle || normLine.includes(normTitle) || normTitle.includes(normLine);
};

/**
 * Extracts text from a PDF.js PDFDocumentProxy for a page range with precision intra-page trimming.
 */
export const extractPdfSectionText = async (
  pdfDoc: any,
  startPage: number,
  endPage: number,
  targetTitle?: string,
  nextSectionTitle?: string,
  maxCharLimit = 30000
): Promise<string> => {
  if (!pdfDoc) return '';
  const start = Math.max(1, startPage);
  const end = Math.min(pdfDoc.numPages || 1, Math.max(start, endPage));

  const pageTexts: string[] = [];
  let totalChars = 0;
  let isTruncated = false;

  for (let p = start; p <= end; p++) {
    try {
      const page = await pdfDoc.getPage(p);
      const content = await page.getTextContent();
      let lines = extractCleanLinesFromPdfPage(content);

      if (lines.length === 0) continue;

      // 1. On startPage: If targetTitle is present, trim text before the section title
      if (p === start && targetTitle) {
        const titleLineIdx = lines.findIndex(l => isLineMatchingTitle(l, targetTitle));
        if (titleLineIdx !== -1) {
          lines = lines.slice(titleLineIdx);
        }
      }

      // 2. On endPage: If nextSectionTitle is present, trim text starting from the next section title
      if (p === end && nextSectionTitle && nextSectionTitle !== targetTitle) {
        const nextTitleLineIdx = lines.findIndex(l => isLineMatchingTitle(l, nextSectionTitle));
        if (nextTitleLineIdx !== -1) {
          lines = lines.slice(0, nextTitleLineIdx);
        }
      }

      const cleanPageText = lines.join('\n').trim();
      if (cleanPageText) {
        pageTexts.push(`[Page ${p}]\n${cleanPageText}`);
        totalChars += cleanPageText.length;
        if (totalChars >= maxCharLimit) {
          isTruncated = true;
          break;
        }
      }
    } catch (err) {
      console.warn(`[SectionExtractor] Error extracting page ${p}:`, err);
    }
  }

  let result = pageTexts.join('\n\n');
  if (isTruncated) {
    result += '\n\n[Note: Content exceeded character limit and was truncated at this point for AI context safety.]';
  }

  return result;
};

/**
 * Recursively formats a TOC items tree into a text list with page numbers.
 */
export const formatSubtopicsTree = (items: TocItemData[], depth = 0): string[] => {

  const lines: string[] = [];
  for (const item of items) {
    if (!item.title || !item.title.trim()) continue;
    const indent = '  '.repeat(depth);
    const pageStr = typeof item.target === 'number' ? ` (p. ${item.target})` : '';
    lines.push(`${indent}- ${item.title.trim()}${pageStr}`);
    if (item.children && item.children.length > 0) {
      lines.push(...formatSubtopicsTree(item.children, depth + 1));
    }
  }
  return lines;
};

/**
 * Extracts a lightweight, structured Chapter Overview context payload
 * combining: Chapter opening pages + Full subtopics tree + Chapter conclusion/summary.
 */
export const extractPdfChapterOverviewText = async (
  pdfDoc: any,
  chapterItem: TocItemData,
  outline: TocItemData[],
  totalPages: number
): Promise<string> => {
  if (!pdfDoc) return '';
  const startPage = typeof chapterItem.target === 'number' ? Math.max(1, chapterItem.target) : 1;
  const flat = flattenOutline(outline);

  // Find where this chapter ends (before the next top-level or sibling section)
  let endPage = totalPages;
  const rootIdx = outline.findIndex(
    item => item.title === chapterItem.title || (typeof item.target === 'number' && item.target === startPage)
  );

  if (rootIdx !== -1 && rootIdx + 1 < outline.length) {
    const nextRoot = outline[rootIdx + 1];
    if (typeof nextRoot.target === 'number' && nextRoot.target > startPage) {
      endPage = Math.max(startPage, nextRoot.target - 1);
    }
  } else {
    // Search flat outline for any item with target > startPage that is not a child of this chapter
    const chapterChildrenFlat = chapterItem.children ? flattenOutline(chapterItem.children) : [];
    const nonChildItems = flat.filter(
      item => !chapterChildrenFlat.includes(item) && typeof item.target === 'number' && (item.target as number) > startPage
    );
    if (nonChildItems.length > 0) {
      endPage = Math.max(startPage, (nonChildItems[0].target as number) - 1);
    }
  }

  // 1. Format Subtopics Outline Tree
  const subtopicsList = chapterItem.children && chapterItem.children.length > 0
    ? formatSubtopicsTree(chapterItem.children)
    : [];

  // 2. Extract Opening Pages (startPage up to min(startPage + 2, endPage))
  const firstChildPage = chapterItem.children && chapterItem.children.length > 0 && typeof chapterItem.children[0].target === 'number'
    ? chapterItem.children[0].target
    : startPage + 2;
  const openingEndPage = Math.min(Math.max(startPage, firstChildPage), Math.min(startPage + 2, endPage));
  const openingText = await extractPdfSectionText(pdfDoc, startPage, openingEndPage, chapterItem.title);

  // 3. Search for Chapter Summary / Conclusion section
  let summaryText = '';
  const summaryChild = chapterChildrenFlatSearch(chapterItem.children || []);
  if (summaryChild && typeof summaryChild.target === 'number' && summaryChild.target >= startPage && summaryChild.target <= endPage) {
    summaryText = await extractPdfSectionText(pdfDoc, summaryChild.target, endPage, summaryChild.title);
  } else if (endPage > openingEndPage + 1) {
    // If no explicit summary child found in TOC, extract the last 1-2 pages of the chapter
    const closingStart = Math.max(openingEndPage + 1, endPage - 1);
    summaryText = await extractPdfSectionText(pdfDoc, closingStart, endPage);
  }

  // 4. Construct Structured Chapter Overview Payload
  const payloadParts: string[] = [
    `[Chapter Overview Request]`,
    `Chapter: ${chapterItem.title} (Pages ${startPage} - ${endPage})`,
  ];

  if (subtopicsList.length > 0) {
    payloadParts.push(`\n[Chapter Topics & Structure]:\n${subtopicsList.join('\n')}`);
  }

  if (openingText) {
    payloadParts.push(`\n[Chapter Introduction & Core Motivation]:\n${openingText}`);
  }

  if (summaryText) {
    payloadParts.push(`\n[Chapter Summary & Key Conclusions]:\n${summaryText}`);
  }

  return payloadParts.join('\n\n');
};

/**
 * Finds a summary or conclusion subtopic inside a children tree.
 */
const chapterChildrenFlatSearch = (items: TocItemData[]): TocItemData | null => {
  for (const item of items) {
    if (/summary|conclusion|recap|wrapping up/i.test(item.title || '')) {
      return item;
    }
    if (item.children && item.children.length > 0) {
      const found = chapterChildrenFlatSearch(item.children);
      if (found) return found;
    }
  }
  return null;
};


/**
 * Extracts section text from a raw Markdown string given a target heading title or ID.
 */
export const extractMarkdownSectionText = (
  rawMarkdown: string,
  sectionTitle: string,
  targetHeadingId?: string
): string => {
  if (!rawMarkdown) return '';
  const lines = rawMarkdown.split(/\r?\n/);
  let capturing = false;
  let currentLevel = 1;
  const capturedLines: string[] = [];
  let headingCounter = 0;
  const normalizedTarget = normalizeTitleForMatching(sectionTitle);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);

    if (headingMatch) {
      headingCounter++;
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      const currentHeadingId = `md-h-${headingCounter}`;

      const isMatch =
        (targetHeadingId && targetHeadingId === currentHeadingId) ||
        normalizeTitleForMatching(title) === normalizedTarget ||
        title.toLowerCase() === sectionTitle.trim().toLowerCase();

      if (capturing) {
        // If we were already capturing and hit a heading of equal or higher level, end the section
        if (level <= currentLevel) {
          break;
        }
      }

      if (isMatch) {
        capturing = true;
        currentLevel = level;
        capturedLines.push(line);
        continue;
      }
    }

    if (capturing) {
      capturedLines.push(line);
    }
  }

  if (capturedLines.length === 0) {
    // If not found by heading match, fallback to the full or truncated document
    return rawMarkdown.slice(0, 20000);
  }

  return capturedLines.join('\n').trim();
};
