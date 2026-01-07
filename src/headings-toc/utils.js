/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Utility functions for headings audit
 */

/**
 * Extract heading level from tag name
 * @param {string} tagName - The heading tag name (e.g., 'H1', 'H2')
 * @returns {number} The heading level (1-6)
 */
export function getHeadingLevel(tagName) {
  return Number(tagName.charAt(1));
}

/**
 * Get surrounding text content before and after a heading
 * @param {Element} heading - The heading element (Cheerio element)
 * @param {CheerioAPI} $ - The Cheerio instance
 * @param {number} charLimit - Maximum characters to extract in each direction
 * @returns {Object} Object with before and after text
 */
export function getSurroundingText(heading, $, charLimit = 150) {
  // Text AFTER the heading
  let afterText = '';
  let [nextSibling] = $(heading).next();

  while (nextSibling && afterText.length < charLimit) {
    const text = $(nextSibling).text().trim();
    if (text) {
      afterText += `${text} `;
      if (afterText.length >= charLimit) break;
    }
    [nextSibling] = $(nextSibling).next();
  }

  // Text BEFORE the heading
  let beforeText = '';
  let [prevSibling] = $(heading).prev();

  while (prevSibling && beforeText.length < charLimit) {
    const text = $(prevSibling).text().trim();
    if (text) {
      beforeText = `${text} ${beforeText}`;
      if (beforeText.length >= charLimit) break;
    }
    [prevSibling] = $(prevSibling).prev();
  }

  return {
    before: beforeText.trim().slice(-charLimit), // Last N chars
    after: afterText.trim().slice(0, charLimit), // First N chars
  };
}

/**
 * Get information about the content structure that follows a heading
 * @param {Element} heading - The heading element (Cheerio element)
 * @param {CheerioAPI} $ - The Cheerio instance
 * @returns {Object} Information about following content
 */
export function getFollowingStructure(heading, $) {
  const [nextElement] = $(heading).next();

  if (!nextElement) {
    return {
      isEmpty: true,
      firstElement: null,
      firstText: '',
    };
  }

  const tagName = nextElement.name.toLowerCase();

  return {
    isEmpty: false,
    firstElement: tagName,
    hasImages: $(nextElement).find('img').length > 0,
    hasLinks: $(nextElement).find('a').length > 0,
    isList: ['ul', 'ol'].includes(tagName),
    firstText: $(nextElement).text().trim().slice(0, 100),
  };
}

/**
 * Find the nearest semantic parent element and preceding heading for context
 * @param {Element} heading - The heading element (Cheerio element)
 * @param {CheerioAPI} $ - The Cheerio instance
 * @param {Array<Element>} allHeadings - Array of all heading elements on the page
 * @param {number} currentIndex - Index of the current heading in allHeadings array
 * @returns {Object} Parent section context with semantic tag info and preceding heading
 */
export function getParentSectionContext(heading, $, allHeadings, currentIndex) {
  const semanticTags = ['article', 'section', 'aside', 'nav', 'main', 'header', 'footer'];
  const currentLevel = getHeadingLevel(heading.name);
  let current = heading.parent;
  let parentContext = null;
  let precedingHeading = null;

  // Find nearest semantic parent
  while (current && current.name && current.name.toLowerCase() !== 'body') {
    const tagName = current.name.toLowerCase();

    if (semanticTags.includes(tagName) && !parentContext) {
      const className = current.attribs?.class;
      parentContext = {
        parentTag: tagName,
        parentClasses: className
          ? className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
          : [],
        parentId: current.attribs?.id || null,
      };
    }

    current = current.parent;
  }

  // Find preceding higher-level heading (walk backwards using provided array)
  for (let i = currentIndex - 1; i >= 0; i -= 1) {
    const prevHeading = allHeadings[i];
    const level = getHeadingLevel(prevHeading.name);

    if (level < currentLevel) {
      const text = $(prevHeading).text().trim();
      if (text) {
        precedingHeading = {
          level: prevHeading.name.toLowerCase(),
          text: text.slice(0, 100), // Limit to 100 chars
        };
        break;
      }
    }
  }

  // Fallback if no semantic parent found
  if (!parentContext && heading.parent) {
    const className = heading.parent.attribs?.class;
    parentContext = {
      parentTag: heading.parent.name.toLowerCase(),
      parentClasses: className
        ? className.trim().split(/\s+/).filter(Boolean).slice(0, 2)
        : [],
      parentId: heading.parent.attribs?.id || null,
    };
  }

  return {
    ...parentContext,
    precedingHeading,
  };
}

/**
 * Get comprehensive context for a heading element to enable better AI suggestions
 * Includes surrounding text, following structure, and parent section context
 * @param {Element} heading - The heading element (Cheerio element)
 * @param {CheerioAPI} $ - The Cheerio instance
 * @param {Array<Element>} allHeadings - Array of all heading elements on the page
 * @param {number} currentIndex - Index of the current heading in allHeadings array
 * @returns {Object} Complete heading context
 */
export function getHeadingContext(heading, $, allHeadings, currentIndex) {
  return {
    // Tier 1: Essential context
    surroundingText: getSurroundingText(heading, $, 150),
    followingStructure: getFollowingStructure(heading, $),

    // Tier 2: Valuable context
    parentSection: getParentSectionContext(heading, $, allHeadings, currentIndex),
  };
}

/**
 * Construct S3 path for scrape JSON
 * @param {string} url - The page URL
 * @param {string} siteId - The site ID
 * @returns {string} S3 path to scrape.json
 */
export function getScrapeJsonPath(url, siteId) {
  const pathname = new URL(url).pathname.replace(/\/$/, '');
  return `scrapes/${siteId}${pathname}/scrape.json`;
}

/**
 * Extract TOC data from document headings
 * @param {CheerioAPI} $ - The Cheerio instance
 * @param {Function} getHeadingSelectorFn - Function to get heading selector
 * @returns {Array<Object>} Array of TOC items with text, level, and selector
 */
export function extractTocData($, getHeadingSelectorFn) {
  const headings = $('h1, h2').toArray();

  return headings.map((h) => {
    const text = $(h).text().trim();
    const level = getHeadingLevel(h.name);
    const selector = getHeadingSelectorFn(h);
    return { text, level, selector };
  });
}

/**
 * Convert TOC array to HAST (Hypertext Abstract Syntax Tree) structure
 * @param {Array<Object>} tocData - Array of TOC items
 * @returns {Object} HAST representation of TOC
 */
export function tocArrayToHast(tocData) {
  // children for <ul>
  const liNodes = tocData.map((item) => {
    const isSub = Number(item.level) === 2;

    return {
      type: 'element',
      tagName: 'li',
      properties: isSub ? { className: ['toc-sub'] } : {},
      children: [
        {
          type: 'element',
          tagName: 'a',
          properties: {
            href: '#',
            'data-selector': item.selector,
          },
          children: [{ type: 'text', value: item.text }],
        },
      ],
    };
  });

  const ul = {
    type: 'element',
    tagName: 'ul',
    properties: {},
    children: liNodes,
  };

  const nav = {
    type: 'element',
    tagName: 'nav',
    properties: { className: ['toc'] },
    children: [ul],
  };

  return {
    type: 'root',
    children: [nav],
  };
}

/**
 * Determine optimal placement for a Table of Contents based on page structure
 * @param {CheerioAPI} $ - The Cheerio instance
 * @param {Function} getHeadingSelectorFn - Function to get heading selector
 * @returns {Object} Object with action, selector, and reasoning for TOC placement
 */
export function determineTocPlacement($, getHeadingSelectorFn) {
  const h1Element = $('h1')[0];
  const mainElement = $('body > main')[0];

  // Strategy 1: After H1 if present
  if (h1Element) {
    return {
      action: 'insertAfter',
      selector: getHeadingSelectorFn(h1Element),
      placement: 'after-h1',
      reasoning: 'TOC placed immediately after H1 heading',
    };
  }

  // Strategy 2: At the beginning of main content area (direct child of body)
  if (mainElement) {
    return {
      action: 'insertBefore',
      selector: 'body > main > :first-child',
      placement: 'main-start',
      reasoning: 'TOC placed at the start of main content area',
    };
  }

  // Fallback: Beginning of body content
  return {
    action: 'insertBefore',
    selector: 'body > :first-child',
    placement: 'body-start',
    reasoning: 'TOC placed at the beginning of body (fallback)',
  };
}
